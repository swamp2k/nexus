import { useCachedJson } from "./queryCache";

type SettingsResponse = { settings: { dashboardRefreshSeconds?: number | null } };

const DEFAULT_REFRESH_SECONDS = 300;

export function useDashboardRefreshMs(): number {
  const { data } = useCachedJson<SettingsResponse>("/api/settings", 5 * 60_000);
  const seconds = Number(data?.settings.dashboardRefreshSeconds ?? DEFAULT_REFRESH_SECONDS);
  const safe = Number.isFinite(seconds) && seconds >= 30 && seconds <= 3600 ? seconds : DEFAULT_REFRESH_SECONDS;
  return Math.round(safe * 1000);
}

export function useDashboardJson<T>(url: string, ttlMs?: number) {
  const refreshMs = useDashboardRefreshMs();
  return useCachedJson<T>(url, ttlMs ?? refreshMs, refreshMs);
}
