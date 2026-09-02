export type UnraidStats = {
  cpuPct: number;
  ramPct: number;
  ramUsedGb: number;
  ramTotalGb: number;
  uptimeS: number;
  tempAvg: number | null;
};

export type UnraidDisk = { slot: string; name: string; temp: number | null; health: string; usedGb: number; totalGb: number };
export type UnraidArray = { status: string; capacityUsedTb: number; capacityTotalTb: number; disks: UnraidDisk[]; cache: UnraidDisk[] };
export type UnraidContainer = { id: string; name: string; status: string };
export type UnraidVM = { id: string; name: string; status: string };
export type UnraidShare = { name: string; usedGb: number; totalGb: number; pct: number };
export type UnraidUPS = { model: string; status: string; batteryPct: number; runtimeMin: number; loadPct: number };

async function gql<T>(url: string, apiKey: string, query: string): Promise<T> {
  const base = url.replace(/\/$/, "");
  let response: Response;
  try {
    response = await fetch(`${base}/graphql`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new Error("unraid_unreachable");
  }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? "unraid_invalid_api_key" : `unraid_http_${response.status}`);
  const body = await response.json() as { data?: T; errors?: Array<{ message?: string }> };
  if (body.errors?.length || !body.data) throw new Error("unraid_graphql_error");
  return body.data;
}

export async function getStats(url: string, apiKey: string): Promise<UnraidStats> {
  const data = await gql<{
    metrics: { cpu: { percentTotal: number }; memory: { total: number; used: number; percentTotal: number }; temperature: { summary: { average: number } } | null };
    info: { os: { uptime: string } };
  }>(url, apiKey, `query { metrics { cpu { percentTotal } memory { total used percentTotal } temperature { summary { average } } } info { os { uptime } } }`);
  const totalGb = data.metrics.memory.total / 1024 ** 3;
  const usedGb = data.metrics.memory.used / 1024 ** 3;
  const fahrenheit = data.metrics.temperature?.summary?.average;
  return {
    cpuPct: Math.round(data.metrics.cpu.percentTotal * 10) / 10,
    ramPct: Math.round(data.metrics.memory.percentTotal * 10) / 10,
    ramUsedGb: Math.round(usedGb * 10) / 10,
    ramTotalGb: Math.round(totalGb * 10) / 10,
    uptimeS: Math.max(0, Math.floor((Date.now() - new Date(data.info.os.uptime).getTime()) / 1000)),
    tempAvg: typeof fahrenheit === "number" ? Math.round((fahrenheit - 32) * 5 / 9) : null,
  };
}

type RawDisk = { idx: number; name: string | null; device: string | null; temp: number | null; status: string | null; fsSize: number | null; fsUsed: number | null };
function disk(row: RawDisk, prefix: string): UnraidDisk {
  return {
    slot: `${prefix}${row.idx}`,
    name: row.name ?? row.device ?? `${prefix}${row.idx}`,
    temp: row.temp,
    health: row.status ?? "UNKNOWN",
    usedGb: Math.round((row.fsUsed ?? 0) / 1024 / 1024),
    totalGb: Math.round((row.fsSize ?? 0) / 1024 / 1024),
  };
}

export async function getArray(url: string, apiKey: string): Promise<UnraidArray> {
  const data = await gql<{ array: { state: string; capacity: { kilobytes: { used: string; total: string } }; disks: RawDisk[]; caches: RawDisk[] } }>(url, apiKey,
    `query { array { state capacity { kilobytes { used total } } disks { idx name device temp status fsSize fsUsed } caches { idx name device temp status fsSize fsUsed } } }`);
  const used = Number.parseInt(data.array.capacity.kilobytes.used, 10) || 0;
  const total = Number.parseInt(data.array.capacity.kilobytes.total, 10) || 0;
  return {
    status: data.array.state,
    capacityUsedTb: Math.round(used / 1024 / 1024 / 1024 * 10) / 10,
    capacityTotalTb: Math.round(total / 1024 / 1024 / 1024 * 10) / 10,
    disks: data.array.disks.map((row) => disk(row, "disk")),
    cache: data.array.caches.map((row) => disk(row, "cache")),
  };
}

export async function getContainers(url: string, apiKey: string): Promise<UnraidContainer[]> {
  const data = await gql<{ docker: { containers: Array<{ id: string; names: string[]; state: string }> } }>(url, apiKey, `query { docker { containers { id names state } } }`);
  return data.docker.containers.map((row) => ({ id: row.id, name: (row.names[0] ?? "unknown").replace(/^\//, ""), status: row.state.toLowerCase() }));
}

export async function getVMs(url: string, apiKey: string): Promise<UnraidVM[]> {
  const data = await gql<{ vms: { domains: Array<{ id: string; name: string | null; state: string }> | null } }>(url, apiKey, `query { vms { domains { id name state } } }`);
  return (data.vms.domains ?? []).map((row) => ({ id: row.id, name: row.name ?? row.id, status: row.state.toLowerCase() }));
}

export async function getShares(url: string, apiKey: string): Promise<UnraidShare[]> {
  const data = await gql<{ shares: Array<{ name: string; free: number | null; used: number | null }> }>(url, apiKey, `query { shares { name free used } }`);
  return data.shares.filter((row) => row.name).map((row) => {
    const usedGb = Math.round((row.used ?? 0) / 1024 / 1024);
    const totalGb = Math.round(((row.used ?? 0) + (row.free ?? 0)) / 1024 / 1024);
    return { name: row.name, usedGb, totalGb, pct: totalGb > 0 ? Math.round(usedGb / totalGb * 100) : 0 };
  });
}

export async function getUPS(url: string, apiKey: string): Promise<UnraidUPS | null> {
  try {
    const data = await gql<{ upsDevices: Array<{ model: string; status: string; battery: { chargeLevel: number; estimatedRuntime: number }; power: { loadPercentage: number } }> }>(url, apiKey,
      `query { upsDevices { model status battery { chargeLevel estimatedRuntime } power { loadPercentage } } }`);
    const row = data.upsDevices[0];
    return row ? { model: row.model, status: row.status, batteryPct: row.battery.chargeLevel, runtimeMin: row.battery.estimatedRuntime, loadPct: row.power.loadPercentage } : null;
  } catch { return null; }
}
