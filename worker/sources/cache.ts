type CacheRow = {
  payload_json: string;
  fetched_at: string;
  expires_at: string;
  last_error_at: string | null;
  last_error_message: string | null;
};

export type CachedSource<T> = {
  data: T;
  fetchedAt: string;
  expiresAt: string;
  stale: boolean;
  lastErrorAt: string | null;
  lastErrorMessage: string | null;
};

export async function readSourceCache<T>(db: D1Database, key: string): Promise<CachedSource<T> | null> {
  const row = await db
    .prepare(
      `SELECT payload_json, fetched_at, expires_at, last_error_at, last_error_message
       FROM source_cache
       WHERE source_key = ?
       LIMIT 1`,
    )
    .bind(key)
    .first<CacheRow>();

  if (!row) return null;

  try {
    return {
      data: JSON.parse(row.payload_json) as T,
      fetchedAt: row.fetched_at,
      expiresAt: row.expires_at,
      stale: Date.parse(row.expires_at) <= Date.now(),
      lastErrorAt: row.last_error_at,
      lastErrorMessage: row.last_error_message,
    };
  } catch {
    return null;
  }
}

export async function writeSourceCache<T>(
  db: D1Database,
  key: string,
  data: T,
  ttlMs: number,
): Promise<CachedSource<T>> {
  const fetchedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const payload = JSON.stringify(data);

  await db
    .prepare(
      `INSERT INTO source_cache (
         source_key, payload_json, fetched_at, expires_at, last_error_at, last_error_message
       ) VALUES (?, ?, ?, ?, NULL, NULL)
       ON CONFLICT(source_key) DO UPDATE SET
         payload_json = excluded.payload_json,
         fetched_at = excluded.fetched_at,
         expires_at = excluded.expires_at,
         last_error_at = NULL,
         last_error_message = NULL`,
    )
    .bind(key, payload, fetchedAt, expiresAt)
    .run();

  return {
    data,
    fetchedAt,
    expiresAt,
    stale: false,
    lastErrorAt: null,
    lastErrorMessage: null,
  };
}

export async function recordSourceError(db: D1Database, key: string, message: string): Promise<void> {
  await db
    .prepare(
      `UPDATE source_cache
       SET last_error_at = ?, last_error_message = ?
       WHERE source_key = ?`,
    )
    .bind(new Date().toISOString(), message.slice(0, 500), key)
    .run();
}
