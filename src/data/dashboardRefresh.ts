import { createContext, createElement, useContext } from "react";
import type { PropsWithChildren } from "react";
import { useCachedJson } from "./queryCache";

export type RefreshClass = "live" | "standard" | "slow" | "event";

export const REFRESH_CLASS_SECONDS: Record<RefreshClass, number> = {
  live: 60,
  standard: 300,
  slow: 1800,
  event: 0,
};

export const REFRESH_CLASS_LABELS: Record<RefreshClass, string> = {
  live: "Live · 1 min",
  standard: "Normal · 5 min",
  slow: "Langsom · 30 min",
  event: "Ved åbning / event",
};

export const DEFAULT_WIDGET_REFRESH_CLASSES: Record<string, RefreshClass> = {
  Garmin: "event",
  Strøm: "standard",
  Vejr: "standard",
  Kalender: "slow",
  MELCloud: "live",
  Unraid: "live",
  Velbefindende: "event",
};

export type DashboardRefreshSettingsResponse = {
  settings: {
    dashboardRefreshClasses?: Record<string, RefreshClass> | null;
  };
};

const RefreshClassContext = createContext<RefreshClass>("standard");

export function DashboardRefreshScope({ refreshClass, children }: PropsWithChildren<{ refreshClass: RefreshClass }>) {
  return createElement(RefreshClassContext.Provider, { value: refreshClass }, children);
}

export function isRefreshClass(value: unknown): value is RefreshClass {
  return value === "live" || value === "standard" || value === "slow" || value === "event";
}

export function defaultRefreshClassForGroup(group: string): RefreshClass {
  return DEFAULT_WIDGET_REFRESH_CLASSES[group] ?? "standard";
}

export function resolveDashboardRefreshClass(
  group: string,
  settings: DashboardRefreshSettingsResponse | null,
): RefreshClass {
  const configured = settings?.settings.dashboardRefreshClasses?.[group];
  return isRefreshClass(configured) ? configured : defaultRefreshClassForGroup(group);
}

export function useDashboardJson<T>(url: string, ttlMs?: number) {
  const refreshClass = useContext(RefreshClassContext);
  const seconds = REFRESH_CLASS_SECONDS[refreshClass];
  const pollMs = seconds > 0 ? seconds * 1000 : 0;
  const cacheTtl = ttlMs ?? (pollMs > 0 ? pollMs : 30_000);
  return useCachedJson<T>(url, cacheTtl, pollMs);
}
