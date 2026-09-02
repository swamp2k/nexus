const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encryption for the stored UnraidWatch integration token.
 *
 * Nexus stores no Unraid API key — only this token, which UnraidWatch can
 * revoke at any time. Follows the same key-with-fallback pattern as the Garmin
 * and MelCloud modules, so no new Worker secret is required.
 */
type UnraidCredentialsEnv = Env & {
  UNRAIDWATCH_CREDENTIALS_KEY?: string;
  UNRAID_CREDENTIALS_KEY?: string;
  GARMIN_CREDENTIALS_KEY?: string;
};

type EncryptedValue = { ciphertext: string; iv: string };

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

async function importKey(env: UnraidCredentialsEnv): Promise<CryptoKey> {
  const raw = env.UNRAIDWATCH_CREDENTIALS_KEY?.trim()
    || env.UNRAID_CREDENTIALS_KEY?.trim()
    || env.GARMIN_CREDENTIALS_KEY?.trim();
  if (!raw) throw new Error("unraid_credentials_key_not_configured");
  const bytes = base64ToBytes(raw);
  if (bytes.byteLength !== 32) throw new Error("unraid_credentials_key_invalid");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptUnraidValue(env: UnraidCredentialsEnv, value: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(env), encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptUnraidValue(env: UnraidCredentialsEnv, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await importKey(env),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}
