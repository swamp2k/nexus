import { useEffect, useState } from "react";

type CacheEntry<T> = {
  data?: T;
  error?: Error;
  expiresAt: number;
  promise?: Promise<T>;
};

const cache = new Map<string, CacheEntry<unknown>>();

async function loadJson<T>(url: string, ttlMs: number): Promise<T> {
  const now = Date.now();
  const existing = cache.get(url) as CacheEntry<T> | undefined;
  if (existing?.data !== undefined && existing.expiresAt > now) return existing.data;
  if (existing?.promise) return existing.promise;

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

export function useCachedJson<T>(url: string, ttlMs = 60_000): {
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
    setLoading(cache.get(url)?.data === undefined);
    void loadJson<T>(url, ttlMs)
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
    return () => { active = false; };
  }, [url, ttlMs]);

  return { data, loading, error };
}
