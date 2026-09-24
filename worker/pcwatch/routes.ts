import { getAuthenticatedUser } from '../auth/session';
import { hasPcWatchAccess } from './access';
import { CONTRACT_VERSION } from './contract';
import { pcWatch } from './transport';

type PcWatchEnv = Env & { NEXUS_PCWATCH_TOKEN?: string };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function handlePcWatchRoute(request: Request, env: PcWatchEnv): Promise<Response | null> {
  if (new URL(request.url).pathname !== '/api/pcwatch/overview') return null;
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
  const user = await getAuthenticatedUser(request, env.DB);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!await hasPcWatchAccess(env.DB, user.id, user.role)) return json({ error: 'forbidden' }, 403);
  const token = env.NEXUS_PCWATCH_TOKEN;
  if (!token || !env.PCWATCH) return json({ error: 'pcwatch_not_configured' }, 503);
  try {
    const pcwatch = pcWatch(env);
    const overview = await pcwatch.getOverview(token);
    if (overview.contractVersion !== CONTRACT_VERSION) return json({ error: 'pcwatch_contract_mismatch' }, 502);
    return json(overview);
  } catch (error) {
    if (error instanceof Error && error.message === 'unauthorized') return json({ error: 'pcwatch_unauthorized' }, 502);
    return json({ error: 'pcwatch_unavailable' }, 502);
  }
}
