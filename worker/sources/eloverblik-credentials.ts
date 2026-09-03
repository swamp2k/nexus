const encoder = new TextEncoder();
const decoder = new TextDecoder();

type EloverblikCredentialsEnv = Env & { ELOVERBLIK_CREDENTIALS_KEY?: string };

type CredentialRow = {
  refresh_token_ciphertext: string;
  refresh_token_iv: string;
  metering_point: string;
};

export type EloverblikCredentials = {
  refreshToken: string;
  meteringPoint: string;
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function importKey(env: EloverblikCredentialsEnv): Promise<CryptoKey> {
  const raw = env.ELOVERBLIK_CREDENTIALS_KEY?.trim();
  if (!raw) throw new Error("eloverblik_credentials_key_not_configured");
  const bytes = base64ToBytes(raw);
  if (bytes.byteLength !== 32) throw new Error("eloverblik_credentials_key_invalid");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptValue(env: EloverblikCredentialsEnv, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(env), encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptValue(env: EloverblikCredentialsEnv, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await importKey(env),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}

async function clearUsageCache(env: EloverblikCredentialsEnv, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM source_cache WHERE source_key = ?`).bind(`energy:usage:${userId}`).run();
}

export async function getEloverblikCredentials(env: EloverblikCredentialsEnv, userId: string): Promise<EloverblikCredentials | null> {
  const row = await env.DB
    .prepare(`SELECT refresh_token_ciphertext, refresh_token_iv, metering_point FROM eloverblik_credentials WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<CredentialRow>();

  if (!row) return null;
  return {
    refreshToken: await decryptValue(env, row.refresh_token_ciphertext, row.refresh_token_iv),
    meteringPoint: row.metering_point,
  };
}

export async function getEloverblikCredentialStatus(env: EloverblikCredentialsEnv, userId: string) {
  const row = await env.DB
    .prepare(`SELECT metering_point FROM eloverblik_credentials WHERE user_id = ? LIMIT 1`)
    .bind(userId)
    .first<{ metering_point: string }>();
  return row ? { configured: true, meteringPoint: row.metering_point } : { configured: false, meteringPoint: "" };
}

export async function setEloverblikCredentials(env: EloverblikCredentialsEnv, userId: string, credentials: EloverblikCredentials): Promise<void> {
  const encrypted = await encryptValue(env, credentials.refreshToken);
  await env.DB
    .prepare(`
      INSERT INTO eloverblik_credentials (user_id, refresh_token_ciphertext, refresh_token_iv, metering_point, created_at, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id) DO UPDATE SET
        refresh_token_ciphertext = excluded.refresh_token_ciphertext,
        refresh_token_iv = excluded.refresh_token_iv,
        metering_point = excluded.metering_point,
        updated_at = CURRENT_TIMESTAMP
    `)
    .bind(userId, encrypted.ciphertext, encrypted.iv, credentials.meteringPoint)
    .run();
  await clearUsageCache(env, userId);
}

export async function clearEloverblikCredentials(env: EloverblikCredentialsEnv, userId: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM eloverblik_credentials WHERE user_id = ?`).bind(userId).run();
  await clearUsageCache(env, userId);
}
