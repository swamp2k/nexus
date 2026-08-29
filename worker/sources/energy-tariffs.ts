import { readSourceCache, recordSourceError, writeSourceCache } from "./cache";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TIME_ZONE = "Europe/Copenhagen";

export const GRID_PROVIDERS = {
  Konstant: { label: "Konstant", gln: "5790000704842", chargeTypeCode: "C_FBTNTR_B" },
  N1: { label: "N1", gln: "5790001089030", chargeTypeCode: "CD" },
  Radius: { label: "Radius", gln: "5790000705689", chargeTypeCode: "DT_C_01" },
  Cerius: { label: "Cerius", gln: "5790000705184", chargeTypeCode: "30TR_C_ET" },
  Dinel: { label: "Dinel", gln: "5790000610099", chargeTypeCode: "TCL<100_52" },
  TREFOR: { label: "TREFOR El-net", gln: "5790000392261", chargeTypeCode: "C" },
  VoresElnet: { label: "Vores Elnet", gln: "5790000610976", chargeTypeCode: "TNT1009" },
  RAH: { label: "RAH Net", gln: "5790000681327", chargeTypeCode: "RAH-C" },
} as const;

export type GridProviderKey = keyof typeof GRID_PROVIDERS;

type DatahubResponse = { records?: unknown };
type DatahubRecord = Record<string, unknown> & {
  ValidFrom?: unknown;
  ValidTo?: unknown;
  ChargeOwner?: unknown;
  ChargeTypeCode?: unknown;
};

export type GridTariff = {
  providerKey: GridProviderKey;
  providerLabel: string;
  chargeOwner: string | null;
  chargeTypeCode: string;
  validFrom: string | null;
  validTo: string | null;
  hourlyExVatDkkPerKwh: number[];
};

function toNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeGridProvider(value: string | null | undefined): GridProviderKey | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return Object.prototype.hasOwnProperty.call(GRID_PROVIDERS, raw) ? raw as GridProviderKey : null;
}

function cacheKey(providerKey: GridProviderKey): string {
  return `energy:grid-tariff:${providerKey}`;
}

function parseRecord(providerKey: GridProviderKey, value: unknown): GridTariff | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as DatahubRecord;
  const hourly: number[] = [];
  for (let hour = 1; hour <= 24; hour += 1) {
    const price = toNumber(record[`Price${hour}`]);
    if (price === null) return null;
    hourly.push(price);
  }

  const preset = GRID_PROVIDERS[providerKey];
  return {
    providerKey,
    providerLabel: preset.label,
    chargeOwner: typeof record.ChargeOwner === "string" ? record.ChargeOwner : null,
    chargeTypeCode: typeof record.ChargeTypeCode === "string" ? record.ChargeTypeCode : preset.chargeTypeCode,
    validFrom: typeof record.ValidFrom === "string" ? record.ValidFrom : null,
    validTo: typeof record.ValidTo === "string" ? record.ValidTo : null,
    hourlyExVatDkkPerKwh: hourly,
  };
}

async function fetchGridTariff(providerKey: GridProviderKey): Promise<GridTariff> {
  const preset = GRID_PROVIDERS[providerKey];
  const url = new URL("https://api.energidataservice.dk/dataset/DatahubPricelist");
  url.searchParams.set("end", "now");
  url.searchParams.set("filter", JSON.stringify({
    GLN_Number: [preset.gln],
    ChargeType: ["D03"],
    ChargeTypeCode: [preset.chargeTypeCode],
  }));
  url.searchParams.set("sort", "ValidFrom desc");
  url.searchParams.set("limit", "10");
  url.searchParams.set("columns", [
    "ValidFrom", "ValidTo", "ChargeOwner", "ChargeTypeCode",
    ...Array.from({ length: 24 }, (_, index) => `Price${index + 1}`),
  ].join(","));

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Nexus/0.1 (+https://nexus.sr-goodjob.workers.dev)",
    },
  });
  if (!response.ok) throw new Error(`datahub_tariff_http_${response.status}`);

  const body = await response.json() as DatahubResponse;
  if (!Array.isArray(body.records)) throw new Error("datahub_tariff_invalid_response");

  const now = Date.now();
  for (const record of body.records) {
    const parsed = parseRecord(providerKey, record);
    if (!parsed) continue;
    const from = parsed.validFrom ? Date.parse(parsed.validFrom) : Number.NEGATIVE_INFINITY;
    const to = parsed.validTo ? Date.parse(parsed.validTo) : Number.POSITIVE_INFINITY;
    if ((Number.isNaN(from) || from <= now) && (Number.isNaN(to) || to > now)) return parsed;
  }

  const first = body.records.map((record) => parseRecord(providerKey, record)).find((item): item is GridTariff => item !== null);
  if (!first) throw new Error("datahub_tariff_not_found");
  return first;
}

export async function getGridTariff(db: D1Database, providerKey: GridProviderKey) {
  const key = cacheKey(providerKey);
  const cached = await readSourceCache<GridTariff>(db, key);
  if (cached && !cached.stale) return cached;

  try {
    const data = await fetchGridTariff(providerKey);
    return await writeSourceCache(db, key, data, CACHE_TTL_MS);
  } catch (error) {
    const message = error instanceof Error ? error.message : "datahub_tariff_fetch_failed";
    await recordSourceError(db, key, message);
    if (cached) return { ...cached, stale: true, lastErrorAt: new Date().toISOString(), lastErrorMessage: message };
    throw error;
  }
}

function localHour(timestamp: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(timestamp));
  return Number(parts.find((part) => part.type === "hour")?.value ?? 0);
}

export function tariffForTimestamp(tariff: GridTariff, timestamp: string): number {
  const hour = Math.max(0, Math.min(23, localHour(timestamp)));
  return tariff.hourlyExVatDkkPerKwh[hour] ?? 0;
}
