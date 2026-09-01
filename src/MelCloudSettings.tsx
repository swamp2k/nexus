import { useEffect, useState } from "react";

type CredentialResponse = { configured: boolean; username: string | null; updatedAt: string | null };
type MelCloudDevice = {
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
type DeviceResponse = { devices: MelCloudDevice[]; fetchedAt: string; provider: string };

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error === "melcloud_invalid_credentials") return "MELCloud afviste login. Kontrollér mail og adgangskode.";
    if (body.error === "melcloud_login_throttled") return "MELCloud begrænser nye login lige nu. Vent lidt før næste forsøg.";
    if (body.error === "melcloud_credentials_unavailable") return "Krypteringsnøglen til MELCloud credentials mangler eller kan ikke læses.";
    if (body.error === "melcloud_not_configured") return "MELCloud er ikke konfigureret endnu.";
    return body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

function temp(value: number | null): string {
  return value === null ? "—" : `${value.toFixed(1).replace(".", ",")}°`;
}

export default function MelCloudSettings() {
  const [configured, setConfigured] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [devices, setDevices] = useState<MelCloudDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/melcloud/credentials", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(await errorText(response));
        return response.json() as Promise<CredentialResponse>;
      })
      .then((body) => {
        setConfigured(body.configured);
        setUsername(body.username ?? "");
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "MELCloud-indstillinger kunne ikke hentes."))
      .finally(() => setLoading(false));
  }, []);

  async function saveAndTest() {
    setWorking(true); setMessage(null);
    try {
      const response = await fetch("/api/melcloud/credentials", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as CredentialResponse & { devices?: MelCloudDevice[] };
      setConfigured(true);
      setPassword("");
      setDevices(body.devices ?? []);
      setMessage(`Forbundet til MELCloud Classic · ${body.devices?.length ?? 0} enhed(er) fundet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MELCloud kunne ikke forbindes.");
    } finally {
      setWorking(false);
    }
  }

  async function refreshDevices() {
    setWorking(true); setMessage(null);
    try {
      const response = await fetch("/api/melcloud/devices", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as DeviceResponse;
      setDevices(body.devices);
      setMessage(`${body.provider} svarer · ${body.devices.length} enhed(er) fundet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MELCloud-data kunne ikke hentes.");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!window.confirm("Fjern MELCloud-login fra Nexus?")) return;
    await fetch("/api/melcloud/credentials", { method: "DELETE", credentials: "same-origin" });
    setConfigured(false); setUsername(""); setPassword(""); setDevices([]); setMessage("MELCloud-login er fjernet.");
  }

  if (loading) return <p className="settings-loading">Henter MELCloud-indstillinger…</p>;

  return <div className="settings-form melcloud-settings-form">
    <div className="melcloud-status-line"><strong>{configured ? "Forbundet" : "Ikke konfigureret"}</strong><span>Første version bruger MELCloud Classic og er læse-kun, indtil vi har set dine faktiske enhedsdata.</span></div>
    <div className="settings-coordinate-grid">
      <label><span>MELCloud mail</span><input type="email" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="dig@example.com" /></label>
      <label><span>Adgangskode</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={configured ? "Skriv kun ved ændring" : "MELCloud adgangskode"} /></label>
    </div>
    <div className="settings-location-actions">
      <button className="primary-action" type="button" disabled={working || !username.trim() || !password} onClick={() => void saveAndTest()}>{working ? "Arbejder…" : configured ? "Opdatér login og test" : "Gem og test forbindelse"}</button>
      {configured && <button className="secondary-action" type="button" disabled={working} onClick={() => void refreshDevices()}>Hent enheder</button>}
      {configured && <button className="secondary-action" type="button" disabled={working} onClick={() => void remove()}>Fjern login</button>}
    </div>
    <p className="settings-help">Credentials gemmes krypteret i D1. Nexus bruger en separat MELCloud-nøgle hvis den findes, ellers samme AES-GCM nøgle som Garmin. Ingen styring af varmepumpen er aktiveret endnu.</p>
    {message && <p className="settings-feedback">{message}</p>}
    {devices.length > 0 && <div className="melcloud-device-list">{devices.map((device) => <article key={device.id}>
      <div><strong>{device.name}</strong><span>#{device.id}{device.deviceType === null ? "" : ` · type ${device.deviceType}`}</span></div>
      <dl>
        <div><dt>Status</dt><dd>{device.offline === true ? "Offline" : device.power === true ? "Tændt" : device.power === false ? "Slukket" : "Online"}</dd></div>
        <div><dt>Rum</dt><dd>{temp(device.roomTemperature)}</dd></div>
        <div><dt>Mål</dt><dd>{temp(device.setTemperature)}</dd></div>
        <div><dt>Ude</dt><dd>{temp(device.outdoorTemperature)}</dd></div>
        {device.tankTemperature !== null && <div><dt>Tank</dt><dd>{temp(device.tankTemperature)}</dd></div>}
      </dl>
    </article>)}</div>}
  </div>;
}
