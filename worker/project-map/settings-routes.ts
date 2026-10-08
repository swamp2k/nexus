import { getAuthenticatedUser } from "../auth/session";
import { listCloudflareInventory, listGithubRepos } from "./client";
import {
  clearProjectMapCredentials,
  getProjectMapCredentials,
  getProjectMapCredentialStatus,
  setProjectMapCredentials,
} from "./credentials";

type ProjectMapSettingsEnv = Env & { ELOVERBLIK_CREDENTIALS_KEY?: string };

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}

async function requireAdmin(request: Request, env: ProjectMapSettingsEnv) {
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return { response: json({ error: "unauthorized" }, { status: 401 }) };
  if (user.role !== "admin") return { response: json({ error: "forbidden" }, { status: 403 }) };
  return { user };
}

export async function handleProjectMapSettingsRoute(
  request: Request,
  env: ProjectMapSettingsEnv,
): Promise<Response | null> {
  const pathname = new URL(request.url).pathname;
  if (pathname !== "/api/project-map/settings") return null;

  const auth = await requireAdmin(request, env);
  if (auth.response) return auth.response;

  if (request.method === "GET") {
    return json(await getProjectMapCredentialStatus(env));
  }

  if (request.method === "DELETE") {
    await clearProjectMapCredentials(env);
    return json({ ok: true });
  }

  if (request.method !== "PUT") {
    return json({ error: "method_not_allowed" }, { status: 405 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_json" }, { status: 400 });
  }

  const existing = await getProjectMapCredentials(env);
  const githubToken = typeof body.githubToken === "string" && body.githubToken.trim()
    ? body.githubToken.trim()
    : existing?.githubToken ?? "";
  const cloudflareToken = typeof body.cloudflareToken === "string" && body.cloudflareToken.trim()
    ? body.cloudflareToken.trim()
    : existing?.cloudflareToken ?? "";
  const cloudflareAccountId = typeof body.cloudflareAccountId === "string" && body.cloudflareAccountId.trim()
    ? body.cloudflareAccountId.trim()
    : existing?.cloudflareAccountId ?? "";

  if (githubToken.length < 20) return json({ error: "github_token_required" }, { status: 400 });
  if (cloudflareToken.length < 20) return json({ error: "cloudflare_token_required" }, { status: 400 });
  if (!/^[a-f0-9]{32}$/i.test(cloudflareAccountId)) {
    return json({ error: "invalid_cloudflare_account_id" }, { status: 400 });
  }

  try {
    await listGithubRepos(githubToken);
  } catch {
    return json({ error: "github_validation_failed" }, { status: 400 });
  }

  try {
    await listCloudflareInventory(cloudflareToken, cloudflareAccountId);
  } catch {
    return json({ error: "cloudflare_validation_failed" }, { status: 400 });
  }

  await setProjectMapCredentials(env, auth.user.id, {
    githubToken,
    cloudflareToken,
    cloudflareAccountId,
  });

  return json({ ok: true, ...(await getProjectMapCredentialStatus(env)) });
}
