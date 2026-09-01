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
type DiagnosticDevice = {
  id: number;
  name: string;
  deviceType: number | null;
  atwFields: Record<string, string | number | boolean | null>;
  allPrimitiveFields: Record<string, string | number | boolean | null>;
};
type DiagnosticResponse = { provider: string; purpose: string; fetchedAt: string; devices: DiagnosticDevice[] };

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
  const [diagnostics, setDiagnostics] = useState<DiagnosticResponse | null>(null);
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
    setWorking(true); setMessage(null); setDiagnostics(null);
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

  async function runAtwTest() {
    setWorking(true); setMessage(null); setDiagnostics(null);
    try {
      const response = await fetch("/api/melcloud/diagnostics", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(await errorText(response));
      const body = await response.json() as DiagnosticResponse;
      setDiagnostics(body);
      const fieldCount = body.devices.reduce((sum, device) => sum + Object.keys(device.atwFields).length, 0);
      setMessage(`ATW-test færdig · ${body.devices.length} enhed(er), ${fieldCount} relevante felter fundet.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ATW-testen kunne ikke køres.");
    } finally {
      setWorking(false);
    }
  }

  async function remove() {
    if (!window.confirm("Fjern MELCloud-login fra Nexus?")) return;
    await fetch("/api/melcloud/credentials", { method: "DELETE", credentials: "same-origin" });
    setConfigured(false); setUsername(""); setPassword(""); setDevices([]); setDiagnostics(null); setMessage("MELCloud-login er fjernet.");
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
      {configured && <button className="secondary-action" type="button" disabled={working} onClick={() => void runAtwTest()}>Kør luft/vand-test</button>}
      {configured && <button className="secondary-action" type="button" disabled={working} onClick={() => void remove()}>Fjern login</button>}
    </div>
    <p className="settings-help">Credentials gemmes krypteret i D1. Luft/vand-testen er kun læsning og viser de rå primitive MELCloud-felter, så vi kan mappe netop din Ecodan/ATW-enhed uden at gætte. Felter der ligner credentials, tokens eller sessionsdata filtreres fra.</p>
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
    {diagnostics && <div className="melcloud-diagnostics">
      <div><strong>Luft/vand diagnostik</strong><span>{new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "medium" }).format(new Date(diagnostics.fetchedAt))}</span></div>
      {diagnostics.devices.map((device) => <details key={device.id} open>
        <summary>{device.name} · #{device.id}{device.deviceType === null ? "" : ` · type ${device.deviceType}`}</summary>
        <h4>Relevante ATW-felter</h4>
        <pre>{JSON.stringify(device.atwFields, null, 2)}</pre>
        <details><summary>Alle primitive felter</summary><pre>{JSON.stringify(device.allPrimitiveFields, null, 2)}</pre></details>
      </details>)}
    </div>}
  </div>;
}