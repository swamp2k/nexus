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
  roomTemperatureZone1: number | null;
  setTemperatureZone1: number | null;
  zone1Name: string | null;
  zone1InHeatMode: boolean | null;
  zone1InRoomMode: boolean | null;
  idleZone1: boolean | null;
  outdoorTemperature: number | null;
  flowTemperature: number | null;
  returnTemperature: number | null;
  tankTemperature: number | null;
  setTankTemperature: number | null;
  heatPumpFrequency: number | null;
  waterPump1Status: boolean | null;
  ecoHotWater: boolean | null;
  forcedHotWaterMode: boolean | null;
  holidayMode: boolean | null;
  boosterHeater1Status: boolean | null;
  boosterHeater2Status: boolean | null;
  immersionHeaterStatus: boolean | null;
  dailyHeatingEnergyConsumed: number | null;
  dailyHeatingEnergyProduced: number | null;
  dailyHotWaterEnergyConsumed: number | null;
  dailyHotWaterEnergyProduced: number | null;
  wifiSignalStrength: number | null;
  hasError: boolean | null;
  errorCode2Digit: number | null;
  errorMessages: string | null;
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
    const roomZone1 = numberValue(device.RoomTemperatureZone1);
    const setZone1 = numberValue(device.SetTemperatureZone1);
    result.push({
      id,
      name: stringValue(row.DeviceName) ?? `MELCloud ${id}`,
      deviceType: numberValue(row.DeviceType),
      power: boolValue(device.Power),
      offline: boolValue(row.Offline) ?? boolValue(device.Offline),
      roomTemperature: numberValue(device.RoomTemperature) ?? roomZone1,
      setTemperature: numberValue(device.SetTemperature) ?? setZone1,
      roomTemperatureZone1: roomZone1,
      setTemperatureZone1: setZone1,
      zone1Name: stringValue(device.Zone1Name),
      zone1InHeatMode: boolValue(device.Zone1InHeatMode),
      zone1InRoomMode: boolValue(device.Zone1InRoomMode),
      idleZone1: boolValue(device.IdleZone1),
      outdoorTemperature: numberValue(device.OutdoorTemperature),
      flowTemperature: numberValue(device.FlowTemperature),
      returnTemperature: numberValue(device.ReturnTemperature),
      tankTemperature: numberValue(device.TankWaterTemperature),
      setTankTemperature: numberValue(device.SetTankWaterTemperature),
      heatPumpFrequency: numberValue(device.HeatPumpFrequency),
      waterPump1Status: boolValue(device.WaterPump1Status),
      ecoHotWater: boolValue(device.EcoHotWater),
      forcedHotWaterMode: boolValue(device.ForcedHotWaterMode),
      holidayMode: boolValue(device.HolidayMode),
      boosterHeater1Status: boolValue(device.BoosterHeater1Status),
      boosterHeater2Status: boolValue(device.BoosterHeater2Status),
      immersionHeaterStatus: boolValue(device.ImmersionHeaterStatus),
      dailyHeatingEnergyConsumed: numberValue(device.DailyHeatingEnergyConsumed),
      dailyHeatingEnergyProduced: numberValue(device.DailyHeatingEnergyProduced),
      dailyHotWaterEnergyConsumed: numberValue(device.DailyHotWaterEnergyConsumed),
      dailyHotWaterEnergyProduced: numberValue(device.DailyHotWaterEnergyProduced),
      wifiSignalStrength: numberValue(device.WifiSignalStrength),
      hasError: boolValue(device.HasError),
      errorCode2Digit: numberValue(device.ErrorCode2Digit),
      errorMessages: stringValue(device.ErrorMessages),
      operationMode: numberValue(device.OperationMode),
      lastCommunication: stringValue(row.LastCommunication) ?? stringValue(device.LastCommunication) ?? stringValue(device.LastTimeStamp),
    });
  }
  return result;
}

const SENSITIVE_FIELD = /(password|email|context|token|secret|credential|session|cookie)/i;
const ATW_FIELD = /(temperature|flow|return|tank|zone|operation|power|mode|holiday|heat|cool|dhw|water|weather|compressor|energy|signal|offline|communication|prohibit|demand|pump|legionella|boost)/i;

function diagnosticValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return `[${value.length} items]`;
  const row = object(value);
  return row ? `{${Object.keys(row).length} fields}` : String(value);
}

export type MelCloudDiagnosticDevice = {
  id: number;
  name: string;
  deviceType: number | null;
  atwFields: Record<string, string | number | boolean | null>;
  allPrimitiveFields: Record<string, string | number | boolean | null>;
};

export function inspectClassicDevices(buildings: unknown[]): MelCloudDiagnosticDevice[] {
  const rows: JsonObject[] = [];
  collectDevices(buildings, rows);
  const seen = new Set<number>();
  const output: MelCloudDiagnosticDevice[] = [];

  for (const row of rows) {
    const id = numberValue(row.DeviceID);
    if (id === null || seen.has(id)) continue;
    seen.add(id);
    const device = object(row.Device) ?? row;
    const merged: Record<string, unknown> = { ...row, ...device };
    const primitive: Record<string, string | number | boolean | null> = {};
    const atw: Record<string, string | number | boolean | null> = {};

    for (const key of Object.keys(merged).sort((a, b) => a.localeCompare(b))) {
      if (SENSITIVE_FIELD.test(key)) continue;
      const value = merged[key];
      if (typeof value === "object" && value !== null) continue;
      primitive[key] = diagnosticValue(value);
      if (ATW_FIELD.test(key)) atw[key] = diagnosticValue(value);
    }

    output.push({
      id,
      name: stringValue(row.DeviceName) ?? `MELCloud ${id}`,
      deviceType: numberValue(row.DeviceType),
      atwFields: atw,
      allPrimitiveFields: primitive,
    });
  }
  return output;
}
