const encoder = new TextEncoder();
const decoder = new TextDecoder();

type MelCloudCredentialsEnv = Env & {
  MELCLOUD_CREDENTIALS_KEY?: string;
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

async function importKey(env: MelCloudCredentialsEnv): Promise<CryptoKey> {
  const raw = env.MELCLOUD_CREDENTIALS_KEY?.trim() || env.GARMIN_CREDENTIALS_KEY?.trim();
  if (!raw) throw new Error("melcloud_credentials_key_not_configured");
  const bytes = base64ToBytes(raw);
  if (bytes.byteLength !== 32) throw new Error("melcloud_credentials_key_invalid");
  return crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptMelCloudValue(env: MelCloudCredentialsEnv, value: string): Promise<EncryptedValue> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await importKey(env), encoder.encode(value));
  return { ciphertext: bytesToBase64(new Uint8Array(encrypted)), iv: bytesToBase64(iv) };
}

export async function decryptMelCloudValue(env: MelCloudCredentialsEnv, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    await importKey(env),
    base64ToBytes(ciphertext),
  );
  return decoder.decode(decrypted);
}
