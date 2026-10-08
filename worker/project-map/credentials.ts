const encoder = new TextEncoder();
const decoder = new TextDecoder();

type CredentialEnv = Env & { ELOVERBLIK_CREDENTIALS_KEY?: string };

type CredentialRow = {
  github_token_ciphertext: string;
  github_token_iv: string;
  cloudflare_token_ciphertext: string;
  cloudflare_token_iv: string;
  cloudflare_account_id: string;
};

export type ProjectMapCredentials = {
  githubToken: string;
  cloudflareToken: string;
  cloudflareAccountId: string;
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

async function importProjectMapKey(env: CredentialEnv): Promise<CryptoKey> {
  const raw = env.ELOVERBLIK_CREDENTIALS_KEY?.trim();
  if (!raw) throw new Error("credential_encryption_key_not_configured");
  const masterBytes = base64ToBytes(raw);
  if (masterBytes.byteLength !== 32) throw new Error("credential_encryption_key_invalid");

  const master = await crypto.subtle.importKey("raw", masterBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encoder.encode("nexus-project-map"),
      info: encoder.encode("project-map-credentials-v1"),
    },
    master,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptValue(env: CredentialEnv, value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importProjectMapKey(env),
    encoder.encode(value),
  );
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

async function decryptValue(env: CredentialEnv, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await importProjectMapKey(env),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}

export async function getProjectMapCredentials(env: CredentialEnv): Promise<ProjectMapCredentials | null> {
  const row = await env.DB.prepare(
    `SELECT github_token_ciphertext, github_token_iv,
            cloudflare_token_ciphertext, cloudflare_token_iv, cloudflare_account_id
     FROM project_map_credentials WHERE id = 1`,
  ).first<CredentialRow>();

  if (!row) return null;
  return {
    githubToken: await decryptValue(env, row.github_token_ciphertext, row.github_token_iv),
    cloudflareToken: await decryptValue(env, row.cloudflare_token_ciphertext, row.cloudflare_token_iv),
    cloudflareAccountId: row.cloudflare_account_id,
  };
}

export async function getProjectMapCredentialStatus(env: CredentialEnv) {
  const row = await env.DB.prepare(
    `SELECT cloudflare_account_id AS cloudflareAccountId, updated_at AS updatedAt
     FROM project_map_credentials WHERE id = 1`,
  ).first<{ cloudflareAccountId: string; updatedAt: string }>();

  return row
    ? { configured: true, githubConfigured: true, cloudflareConfigured: true, cloudflareAccountId: row.cloudflareAccountId, updatedAt: row.updatedAt }
    : { configured: false, githubConfigured: false, cloudflareConfigured: false, cloudflareAccountId: "", updatedAt: null };
}

export async function setProjectMapCredentials(
  env: CredentialEnv,
  userId: string,
  input: { githubToken?: string; cloudflareToken?: string; cloudflareAccountId?: string },
): Promise<ProjectMapCredentials> {
  const current = await getProjectMapCredentials(env);
  const githubToken = input.githubToken?.trim() || current?.githubToken || "";
  const cloudflareToken = input.cloudflareToken?.trim() || current?.cloudflareToken || "";
  const cloudflareAccountId = input.cloudflareAccountId?.trim() || current?.cloudflareAccountId || "";

  if (!githubToken || !cloudflareToken || !cloudflareAccountId) throw new Error("credentials_incomplete");

  const [github, cloudflare] = await Promise.all([
    encryptValue(env, githubToken),
    encryptValue(env, cloudflareToken),
  ]);

  await env.DB.prepare(
    `INSERT INTO project_map_credentials (
       id, github_token_ciphertext, github_token_iv,
       cloudflare_token_ciphertext, cloudflare_token_iv,
       cloudflare_account_id, updated_by_user_id, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO UPDATE SET
       github_token_ciphertext = excluded.github_token_ciphertext,
       github_token_iv = excluded.github_token_iv,
       cloudflare_token_ciphertext = excluded.cloudflare_token_ciphertext,
       cloudflare_token_iv = excluded.cloudflare_token_iv,
       cloudflare_account_id = excluded.cloudflare_account_id,
       updated_by_user_id = excluded.updated_by_user_id,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    github.ciphertext,
    github.iv,
    cloudflare.ciphertext,
    cloudflare.iv,
    cloudflareAccountId,
    userId,
  ).run();

  return { githubToken, cloudflareToken, cloudflareAccountId };
}

export async function clearProjectMapCredentials(env: CredentialEnv): Promise<void> {
  await env.DB.prepare("DELETE FROM project_map_credentials WHERE id = 1").run();
}
