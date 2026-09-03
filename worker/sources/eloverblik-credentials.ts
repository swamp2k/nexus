export type EloverblikCredentials = {
  refreshToken: string;
  meteringPoint: string;
};

type CredentialRow = {
  refresh_token: string;
  metering_point: string;
};

export async function getEloverblikCredentials(db: D1Database, userId: string): Promise<EloverblikCredentials | null> {
  const row = await db
    .prepare(`SELECT refresh_token, metering_point FROM eloverblik_credentials WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<CredentialRow>();

  if (!row) return null;
  return { refreshToken: row.refresh_token, meteringPoint: row.metering_point };
}

export async function setEloverblikCredentials(db: D1Database, userId: string, credentials: EloverblikCredentials): Promise<void> {
  await db
    .prepare(`
      INSERT INTO eloverblik_credentials (user_id, refresh_token, metering_point, created_at, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        refresh_token = excluded.refresh_token,
        metering_point = excluded.metering_point,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(userId, credentials.refreshToken, credentials.meteringPoint)
    .run();
}

export async function clearEloverblikCredentials(db: D1Database, userId: string): Promise<void> {
  await db.prepare(`DELETE FROM eloverblik_credentials WHERE user_id = ?`).bind(userId).run();
}
