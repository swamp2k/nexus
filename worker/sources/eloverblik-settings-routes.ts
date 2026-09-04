import { getAuthenticatedUser } from "../auth/session";
import { clearEloverblikCredentials, getEloverblikCredentialStatus, setEloverblikCredentials } from "./eloverblik-credentials";

type EloverblikSettingsEnv = Env & { ELOVERBLIK_CREDENTIALS_KEY?: string };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

export async function handleEloverblikSettingsRoute(request: Request, env: EloverblikSettingsEnv): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/settings/eloverblik") return null;

  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: "unauthorized" }, { status: 401 });

  if (request.method === "GET") {
    const status = await getEloverblikCredentialStatus(env, user.id);
    return json({
      configured: status.configured,
      meteringPoint: status.meteringPoint,
      refreshTokenConfigured: status.configured,
    });
  }

  if (request.method === "DELETE") {
    await clearEloverblikCredentials(env, user.id);
    return json({ ok: true });
  }

  if (request.method === "PUT") {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, { status: 400 });
    }

    if (typeof body !== "object" || body === null) return json({ error: "invalid_body" }, { status: 400 });
    const refreshToken = String((body as { refreshToken?: unknown }).refreshToken ?? "").trim();
    const meteringPoint = String((body as { meteringPoint?: unknown }).meteringPoint ?? "").trim();

    if (refreshToken.length < 20) return json({ error: "invalid_refresh_token" }, { status: 400 });
    if (!/^\d{10,30}$/.test(meteringPoint)) return json({ error: "invalid_metering_point" }, { status: 400 });

    await setEloverblikCredentials(env, user.id, { refreshToken, meteringPoint });
    return json({ ok: true, configured: true, meteringPoint });
  }

  return json({ error: "method_not_allowed" }, { status: 405 });
}
