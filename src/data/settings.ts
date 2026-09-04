import { invalidateQuery, useCachedJson } from "./queryCache";
import type { SettingsResponse } from "./api-types";

export const SETTINGS_URL = "/api/settings";

/**
 * One cache TTL for /api/settings everywhere. The query cache is keyed by URL
 * only, so mixing TTLs across callers made the effective TTL whichever caller
 * rendered last. Settings pages call `invalidateSettings()` after saving.
 */
export const SETTINGS_TTL_MS = 5 * 60_000;

export function useSettings() {
  return useCachedJson<SettingsResponse>(SETTINGS_URL, SETTINGS_TTL_MS);
}

export function invalidateSettings(): void {
  invalidateQuery(SETTINGS_URL);
}
