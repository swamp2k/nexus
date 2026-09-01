import { useEffect, useState } from "react";

type CacheEntry<T> = {
  data?: T;
  error?: Error;
  expiresAt: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

async function loadJson<T>(url: string, ttlMs: number, force = false): Promise<T> {
  const now = Date.now();
  const existing = cache.get(url) as CacheEntry<T> | undefined;
  if (existing?.promise) return existing.promise;
  if (!force && existing?.data !== undefined && existing.expiresAt > now) return existing.data;

  const promise = fetch(url, { credentials: "same-origin", cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<T>;
    })
    .then((data) => {
      cache.set(url, { data, expiresAt: Date.now() + ttlMs });
      return data;
    })
    .catch((error: unknown) => {
      const normalized = error instanceof Error ? error : new Error("request_failed");
      cache.set(url, { error: normalized, expiresAt: Date.now() + Math.min(ttlMs, 30_000) });
      throw normalized;
    });

  cache.set(url, { ...existing, promise, expiresAt: now + ttlMs });
  return promise;
}

export function invalidateQuery(url: string): void {
  cache.delete(url);
}

export function useCachedJson<T>(url: string, ttlMs = 60_000, pollMs = 0): {
  data: T | null;
  loading: boolean;
  error: Error | null;
} {
  const initial = cache.get(url) as CacheEntry<T> | undefined;
  const [data, setData] = useState<T | null>(initial?.data ?? null);
  const [loading, setLoading] = useState(initial?.data === undefined);
  const [error, setError] = useState<Error | null>(initial?.error ?? null);

  useEffect(() => {
    let active = true;

    const apply = (force = false) => {
      if (!active) return;
      void loadJson<T>(url, ttlMs, force)
        .then((value) => {
          if (!active) return;
          setData(value);
          setError(null);
        })
        .catch((value: Error) => {
          if (!active) return;
          setError(value);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    setLoading(cache.get(url)?.data === undefined);
    apply(false);

    const interval = pollMs > 0 ? window.setInterval(() => {
      if (document.visibilityState === "visible") apply(true);
    }, pollMs) : null;

    const onVisibilityChange = () => {
      if (pollMs > 0 && document.visibilityState === "visible") apply(true);
    };
    if (pollMs > 0) document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      active = false;
      if (interval !== null) window.clearInterval(interval);
      if (pollMs > 0) document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url, ttlMs, pollMs]);

  return { data, loading, error };
}
