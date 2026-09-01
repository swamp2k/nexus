import { useEffect, useMemo, useState } from "react";

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
  lastCommunication: string | null;
};

type DeviceResponse = { devices: MelCloudDevice[]; fetchedAt: string; provider: string };

export function temp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1).replace(".", ",")}°`;
}

export function heatPumpState(device: MelCloudDevice): string {
  if (device.offline) return "Offline";
  if (device.power === false) return "Slukket";
  const auxiliaryHeat = device.boosterHeater1Status || device.boosterHeater2Status || device.immersionHeaterStatus;
  if ((device.heatPumpFrequency ?? 0) > 0 || device.waterPump1Status || auxiliaryHeat) return "Arbejder";
  if (device.idleZone1 === true) return "Hviler";
  return device.power ? "Tændt" : "Online";
}

function energy(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(2).replace(".", ",")} kWh`;
}

function yesNo(value: boolean | null): string {
  return value === null ? "—" : value ? "Ja" : "Nej";
}

function signalLabel(value: number | null): string {
  if (value === null) return "—";
  if (value >= -60) return `${value} dBm · god`;
  if (value >= -70) return `${value} dBm · ok`;
  return `${value} dBm · svagt`;
}

export default function MelCloudPage() {
  const [response, setResponse] = useState<DeviceResponse | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  async function refresh() {
    setState("loading");
    try {
      const result = await fetch("/api/melcloud/devices", { credentials: "same-origin", cache: "no-store" });
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      setResponse(await result.json() as DeviceResponse);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => { void refresh(); }, []);

  const device = response?.devices[0] ?? null;
  const deltaT = useMemo(() => device?.flowTemperature !== null && device?.flowTemperature !== undefined && device.returnTemperature !== null
    ? device.flowTemperature - device.returnTemperature
    : null, [device]);
  const hotWaterCop = useMemo(() => {
    if (!device || device.dailyHotWaterEnergyConsumed === null || device.dailyHotWaterEnergyProduced === null || device.dailyHotWaterEnergyConsumed < 0.1) return null;
    return device.dailyHotWaterEnergyProduced / device.dailyHotWaterEnergyConsumed;
  }, [device]);

  if (state === "loading") return <section className="melcloud-state">Henter varmepumpen…</section>;
  if (state === "error" || !device) return <section className="melcloud-state"><strong>Varmepumpen kunne ikke hentes.</strong><button className="secondary-action" type="button" onClick={() => void refresh()}>Prøv igen</button></section>;

  const status = heatPumpState(device);
  const fault = device.hasError === true || (device.errorCode2Digit ?? 0) > 0;

  return <section className="melcloud-page">
    <article className="melcloud-hero">
      <div>
        <p className="section-label">MELCloud · luft/vand</p>
        <div className="melcloud-status-title"><h2>{status}</h2><span className={`melcloud-status-dot ${status === "Arbejder" ? "active" : ""}`} /></div>
        <strong>{device.name}</strong>
        <p>{device.zone1Name ?? "Zone 1"} · {device.zone1InRoomMode ? "rumstyring" : "fremløbsstyring"}{device.zone1InHeatMode ? " · varme" : ""}</p>
      </div>
      <button className="secondary-action" type="button" onClick={() => void refresh()}>Opdatér</button>
    </article>

    {fault && <div className="melcloud-alert"><strong>MELCloud melder fejl</strong><span>{device.errorMessages || `Fejlkode ${device.errorCode2Digit}`}</span></div>}

    <div className="melcloud-grid">
      <article className="melcloud-card melcloud-card--zone">
        <p className="section-label">{device.zone1Name ?? "Zone 1"}</p><h3>Gulvvarme</h3>
        <div className="melcloud-big-pair"><div><strong>{temp(device.roomTemperatureZone1 ?? device.roomTemperature)}</strong><span>Rum</span></div><div><strong>{temp(device.setTemperatureZone1 ?? device.setTemperature)}</strong><span>Mål</span></div></div>
        <dl><div><dt>Fremløb</dt><dd>{temp(device.flowTemperature)}</dd></div><div><dt>Retur</dt><dd>{temp(device.returnTemperature)}</dd></div><div><dt>ΔT</dt><dd>{temp(deltaT)}</dd></div></dl>
      </article>

      <article className="melcloud-card melcloud-card--tank">
        <p className="section-label">Varmt vand</p><h3>Tank</h3>
        <div className="melcloud-big-pair"><div><strong>{temp(device.tankTemperature)}</strong><span>Nu</span></div><div><strong>{temp(device.setTankTemperature)}</strong><span>Mål</span></div></div>
        <dl><div><dt>Eco</dt><dd>{yesNo(device.ecoHotWater)}</dd></div><div><dt>Tvunget varmt vand</dt><dd>{yesNo(device.forcedHotWaterMode)}</dd></div><div><dt>Elpatron</dt><dd>{device.immersionHeaterStatus ? "Aktiv" : "Fra"}</dd></div></dl>
      </article>

      <article className="melcloud-card">
        <p className="section-label">Anlæg</p><h3>Drift lige nu</h3>
        <dl><div><dt>Ude</dt><dd>{temp(device.outdoorTemperature)}</dd></div><div><dt>Kompressor</dt><dd>{device.heatPumpFrequency === null ? "—" : `${device.heatPumpFrequency} Hz`}</dd></div><div><dt>Vandpumpe</dt><dd>{device.waterPump1Status ? "Kører" : "Stoppet"}</dd></div><div><dt>Booster</dt><dd>{device.boosterHeater1Status || device.boosterHeater2Status ? "Aktiv" : "Fra"}</dd></div><div><dt>Ferie</dt><dd>{yesNo(device.holidayMode)}</dd></div></dl>
      </article>

      <article className="melcloud-card">
        <p className="section-label">I dag</p><h3>Energi</h3>
        <dl><div><dt>Varmt vand · ind</dt><dd>{energy(device.dailyHotWaterEnergyConsumed)}</dd></div><div><dt>Varmt vand · ud</dt><dd>{energy(device.dailyHotWaterEnergyProduced)}</dd></div><div><dt>Varmt vand · COP</dt><dd>{hotWaterCop === null ? "—" : hotWaterCop.toFixed(1).replace(".", ",")}</dd></div><div><dt>Rumvarme · ind</dt><dd>{energy(device.dailyHeatingEnergyConsumed)}</dd></div><div><dt>Rumvarme · ud</dt><dd>{energy(device.dailyHeatingEnergyProduced)}</dd></div></dl>
        <small>MELCloud-rapporterede/estimerede energital.</small>
      </article>
    </div>

    <article className="melcloud-footer-card"><div><span>Wi‑Fi</span><strong>{signalLabel(device.wifiSignalStrength)}</strong></div><div><span>Forbindelse</span><strong>{device.offline ? "Offline" : "Online"}</strong></div><div><span>Styring</span><strong>Læs kun</strong></div></article>
  </section>;
}
