import { getAuthenticatedUser } from '../auth/session';
import { hasPcWatchAccess } from './access';
import { CONTRACT_VERSION } from './contract';
import { pcWatch } from './transport';

export type PcWatchEnv = Env & { NEXUS_PCWATCH_TOKEN?: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function pcWatchOverview(env: PcWatchEnv) {
  const token = env.NEXUS_PCWATCH_TOKEN;
  if (!token || !env.PCWATCH) throw new Error('pcwatch_not_configured');
  const overview = await pcWatch(env).getOverview(token);
  if (overview.contractVersion !== CONTRACT_VERSION) throw new Error('pcwatch_contract_mismatch');
  return overview;
}

export async function handlePcWatchRoute(request: Request, env: PcWatchEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/pcwatch/overview') return null;
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!await hasPcWatchAccess(env.DB, user.id, user.role)) return json({ error: 'forbidden' }, 403);
  try {
    return json(await pcWatchOverview(env));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'pcwatch_unavailable';
    if (message === 'pcwatch_not_configured') return json({ error: message }, 503);
    if (message === 'pcwatch_contract_mismatch') return json({ error: message }, 502);
    if (message === 'unauthorized') return json({ error: 'pcwatch_unauthorized' }, 502);
    return json({ error: 'pcwatch_unavailable' }, 502);
  }
}
