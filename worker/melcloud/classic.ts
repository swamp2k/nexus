const BASE = "https://app.melcloud.com/Mitsubishi.Wifi.Client";
const APP_VERSION = "1.38.4.0";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonObject : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw new Error(`melcloud_http_${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function loginClassic(username: string, password: string): Promise<string> {
  const payload = await fetchJson(`${BASE}/Login/ClientLogin3`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ AppVersion: APP_VERSION, Email: username, Language: 0, Password: password, Persist: true }),
  });
  const root = object(payload);
  const loginData = object(root?.LoginData);
  const contextKey = stringValue(loginData?.ContextKey);
  const errorId = numberValue(root?.ErrorId);
  if (!contextKey) {
    if (errorId === 6) throw new Error("melcloud_login_throttled");
    throw new Error("melcloud_invalid_credentials");
  }
  return contextKey;
}

export async function listClassic(username: string, password: string): Promise<unknown[]> {
  const contextKey = await loginClassic(username, password);
  const payload = await fetchJson(`${BASE}/User/ListDevices`, {
    method: "GET",
    headers: { Accept: "application/json", "X-MitsContextKey": contextKey },
  });
  return Array.isArray(payload) ? payload : [];
}

function collectDevices(value: unknown, output: JsonObject[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectDevices(item, output);
    return;
  }
  const row = object(value);
  if (!row) return;
  if (numberValue(row.DeviceID) !== null && (row.Device !== undefined || row.DeviceName !== undefined)) output.push(row);
  for (const child of Object.values(row)) {
    if (Array.isArray(child) || object(child)) collectDevices(child, output);
  }
}

export type MelCloudDevice = {
  id: number;
  name: string;
  deviceType: number | null;
  power: boolean | null;
  offline: boolean | null;
  roomTemperature: number | null;
  setTemperature: number | null;
  outdoorTemperature: number | null;
  tankTemperature: number | null;
  setTankTemperature: number | null;
  operationMode: number | null;
  lastCommunication: string | null;
};

export function normalizeClassicDevices(buildings: unknown[]): MelCloudDevice[] {
  const rows: JsonObject[] = [];
  collectDevices(buildings, rows);
  const seen = new Set<number>();
  const result: MelCloudDevice[] = [];
  for (const row of rows) {
    const id = numberValue(row.DeviceID);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const device = object(row.Device) ?? row;
    result.push({
      id,
      name: stringValue(row.DeviceName) ?? `MELCloud ${id}`,
      deviceType: numberValue(row.DeviceType),
      power: boolValue(device.Power),
      offline: boolValue(row.Offline) ?? boolValue(device.Offline),
      roomTemperature: numberValue(device.RoomTemperature),
      setTemperature: numberValue(device.SetTemperature),
      outdoorTemperature: numberValue(device.OutdoorTemperature),
      tankTemperature: numberValue(device.TankWaterTemperature),
      setTankTemperature: numberValue(device.SetTankWaterTemperature),
      operationMode: numberValue(device.OperationMode),
      lastCommunication: stringValue(row.LastCommunication) ?? stringValue(device.LastCommunication),
    });
  }
  return result;
}
