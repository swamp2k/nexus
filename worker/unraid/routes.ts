import { getAuthenticatedUser } from "../auth/session";
import { decryptUnraidValue, encryptUnraidValue } from "./credentials";
import type { IntegrationErrorCode } from "./contract";
import { IntegrationFailure, assertContractVersion, callIntegration, unraidWatch, type UnraidWatchEnv } from "./transport";

/**
 * Nexus's Unraid module.
 *
 * Nexus holds no Unraid GraphQL knowledge, no Unraid API key and no direct
 * connection to the Unraid server. It stores one thing — an UnraidWatch
 * integration token — and reads normalized data through the integration
 * contract. UnraidWatch remains the single source of truth.
 *
 * These routes exist so the browser stays same-origin and never sees the token.
 */

type IntegrationRow = {
  label: string;
  tokenCiphertext: string;
  tokenIv: string;
  verifiedAt: string | null;
  updatedAt: string;
};

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function readIntegration(env: UnraidWatchEnv, userId: string): Promise<IntegrationRow | null> {
  return env.DB.prepare(
    `SELECT label, token_ciphertext AS tokenCiphertext, token_iv AS tokenIv,
            verified_at AS verifiedAt, updated_at AS updatedAt
     FROM unraidwatch_integrations WHERE user_id = ?`,
  ).bind(userId).first<IntegrationRow>();
}

/**
 * Nexus-local conditions, distinct from any contract failure. Kept separate so
 * the UI can tell "Nexus has no token yet" apart from "UnraidWatch has no
 * Unraid server saved" — both are setup states, but with different fixes.
 */
const NOT_CONNECTED = "unraidwatch_not_connected";
const BINDING_MISSING = "unraidwatch_binding_missing";
/** Prefix of the message set by assertContractVersion; carries the two versions. */
const CONTRACT_MISMATCH = "unraidwatch_contract_mismatch";

/** Verify the contract version on every versioned response before trusting it. */
async function identify(env: UnraidWatchEnv, token: string) {
  const identity = await callIntegration(() => unraidWatch(env).identify(token));
  assertContractVersion(identity.contractVersion);
  return identity;
}

/** Decrypt the stored token. The raw value never leaves the Worker. */
async function tokenFor(env: UnraidWatchEnv, userId: string): Promise<string> {
  const row = await readIntegration(env, userId);
  if (!row) throw new IntegrationFailure("internal", NOT_CONNECTED);
  return decryptUnraidValue(env, row.tokenCiphertext, row.tokenIv);
}

/** Contract failure codes mapped to what the browser sees. */
const CONTRACT_RESPONSE: Record<IntegrationErrorCode, { status: number; error: string }> = {
  unauthorized: { status: 401, error: "unraidwatch_unauthorized" },
  not_configured: { status: 409, error: "unraidwatch_server_not_configured" },
  upstream_unavailable: { status: 502, error: "unraidwatch_upstream_unavailable" },
  internal: { status: 502, error: "unraidwatch_internal" },
};

function errorResponse(error: unknown): Response {
  if (error instanceof IntegrationFailure) {
    if (error.message === NOT_CONNECTED) return json({ error: NOT_CONNECTED }, { status: 409 });
    if (error.message === BINDING_MISSING) return json({ error: BINDING_MISSING }, { status: 503 });
    if (error.message.startsWith(CONTRACT_MISMATCH)) {
      const [, received, expected] = error.message.split(":");
      return json({ error: CONTRACT_MISMATCH, received, expected }, { status: 502 });
    }
    const mapped = CONTRACT_RESPONSE[error.code];
    return json({ error: mapped.error }, { status: mapped.status });
  }
  const message = error instanceof Error ? error.message : "unraid_fetch_failed";
  if (message.startsWith("unraid_credentials_key")) return json({ error: message }, { status: 503 });
  return json({ error: "unraid_fetch_failed" }, { status: 502 });
}

export async function handleUnraidRoute(request: Request, env: UnraidWatchEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/unraid/")) return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (pathname === "/api/unraid/integration" && request.method === "GET") {
    try {
      const row = await readIntegration(env, user.id);
      return json(row
        ? { configured: true, integration: { label: row.label, verifiedAt: row.verifiedAt, updatedAt: row.updatedAt } }
        : { configured: false, integration: null });
    } catch { return json({ error: "unraidwatch_config_unavailable" }, { status: 503 }); }
  }

  if (pathname === "/api/unraid/integration" && request.method === "PUT") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    let body: { label?: unknown; token?: unknown };
    try { body = await request.json(); } catch { return json({ error: "invalid_json" }, { status: 400 }); }
    const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 80) : "UnraidWatch";
    const supplied = typeof body.token === "string" ? body.token.trim() : "";
    if (supplied.length > 500) return json({ error: "invalid_integration_token" }, { status: 400 });
    try {
      const existing = await readIntegration(env, user.id);
      const token = supplied || (existing ? await decryptUnraidValue(env, existing.tokenCiphertext, existing.tokenIv) : "");
      if (!token) return json({ error: "invalid_integration_token" }, { status: 400 });

      // Prove the token works, and that both sides speak the same contract
      // version, before persisting anything.
      const identity = await identify(env, token);

      const encrypted = supplied || !existing
        ? await encryptUnraidValue(env, token)
        : { ciphertext: existing.tokenCiphertext, iv: existing.tokenIv };
      const now = new Date().toISOString();
      await env.DB.prepare(
        `INSERT INTO unraidwatch_integrations (user_id,label,token_ciphertext,token_iv,verified_at,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET label=excluded.label,
           token_ciphertext=excluded.token_ciphertext,token_iv=excluded.token_iv,
           verified_at=excluded.verified_at,updated_at=excluded.updated_at`,
      ).bind(user.id, label, encrypted.ciphertext, encrypted.iv, now, now, now).run();

      return json({
        configured: true,
        integration: { label, verifiedAt: now, updatedAt: now },
        server: { label: identity.serverLabel, configured: identity.serverConfigured },
      });
    } catch (error) { return errorResponse(error); }
  }

  if (pathname === "/api/unraid/integration" && request.method === "DELETE") {
    if (user.role === "viewer") return json({ error: "forbidden" }, { status: 403 });
    await env.DB.prepare("DELETE FROM unraidwatch_integrations WHERE user_id = ?").bind(user.id).run();
    return json({ ok: true });
  }

  if (pathname === "/api/unraid/test" && request.method === "POST") {
    try {
      const token = await tokenFor(env, user.id);
      const identity = await identify(env, token);
      const now = new Date().toISOString();
      await env.DB.prepare("UPDATE unraidwatch_integrations SET verified_at = ?, updated_at = ? WHERE user_id = ?")
        .bind(now, now, user.id).run();
      return json({ ok: true, verifiedAt: now, server: { label: identity.serverLabel, configured: identity.serverConfigured } });
    } catch (error) { return errorResponse(error); }
  }

  if (request.method === "GET") {
    try {
      const token = await tokenFor(env, user.id);
      const uw = unraidWatch(env);
      const at = () => new Date().toISOString();
      if (pathname === "/api/unraid/overview") {
        const overview = await callIntegration(() => uw.getOverview(token));
        assertContractVersion(overview.contractVersion);
        return json(overview);
      }
      if (pathname === "/api/unraid/stats") return json({ data: await callIntegration(() => uw.getStats(token)), fetchedAt: at() });
      if (pathname === "/api/unraid/array") return json({ data: await callIntegration(() => uw.getArray(token)), fetchedAt: at() });
      if (pathname === "/api/unraid/docker") return json({ data: await callIntegration(() => uw.getDocker(token)), fetchedAt: at() });
      if (pathname === "/api/unraid/vms") return json({ data: await callIntegration(() => uw.getVMs(token)), fetchedAt: at() });
      if (pathname === "/api/unraid/shares") return json({ data: await callIntegration(() => uw.getShares(token)), fetchedAt: at() });
      if (pathname === "/api/unraid/ups") return json({ data: await callIntegration(() => uw.getUPS(token)), fetchedAt: at() });
    } catch (error) { return errorResponse(error); }
  }

  return null;
}
