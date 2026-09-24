import type { PcWatchIntegration } from './contract';

/** Wrangler exposes a bare Service; this is the only PC Watch transport cast. */
export function pcWatch(env: Env): PcWatchIntegration {
  return env.PCWATCH as unknown as PcWatchIntegration;
}
