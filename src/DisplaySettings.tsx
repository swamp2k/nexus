import { useEffect, useState } from "react";

type Device = { id: string; name: string; createdAt: string; lastSeenAt: string };
type Pairing = { code: string; expiresAt: string; name: string };

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("da-DK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export default function DisplaySettings() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState("Køkken-iPad");
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "creating" | "error">("loading");

  async function load() {
    setState("loading");
    try {
      const response = await fetch("/api/display/devices", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { devices: Device[] };
      setDevices(body.devices ?? []);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  useEffect(() => { void load(); }, []);

  async function createCode() {
    setState("creating");
    try {
      const response = await fetch("/api/display/pairing-code", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setPairing(await response.json() as Pairing);
      setState("idle");
    } catch {
      setState("error");
    }
  }

  async function revoke(device: Device) {
    if (!confirm(`Fjern adgang for ${device.name}?`)) return;
    const response = await fetch(`/api/display/devices/${encodeURIComponent(device.id)}`, { method: "DELETE", credentials: "same-origin" });
    if (response.ok) {
      setDevices((current) => current.filter((item) => item.id !== device.id));
    }
  }

  return <div className="settings-form display-settings">
    <p className="settings-help">Par en fast skærm uden mail-login. Displayet får kun read-only adgang til de data, køkkenvisningen bruger.</p>
    <div className="display-settings-create">
      <label><span>Navn på display</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} placeholder="Køkken-iPad" /></label>
      <button className="primary-action" type="button" onClick={() => void createCode()} disabled={state === "creating" || !name.trim()}>{state === "creating" ? "Laver kode…" : "Lav parringskode"}</button>
    </div>

    {pairing && <div className="display-pairing-code-panel">
      <span>Indtast denne kode på <strong>/display/kitchen</strong></span>
      <strong className="display-pairing-code">{pairing.code.slice(0, 4)} {pairing.code.slice(4)}</strong>
      <small>Udløber {timeLabel(pairing.expiresAt)} · kan kun bruges én gang.</small>
    </div>}

    <div className="display-device-list">
      <strong>Parrede displays</strong>
      {state === "loading" && <p className="settings-loading">Henter displays…</p>}
      {state === "error" && <p className="settings-feedback error">Displays kunne ikke hentes.</p>}
      {state !== "loading" && devices.length === 0 && <p className="settings-help">Ingen displays er parret endnu.</p>}
      {devices.map((device) => <div className="display-device-row" key={device.id}>
        <div><strong>{device.name}</strong><small>Sidst set {timeLabel(device.lastSeenAt)} · parret {timeLabel(device.createdAt)}</small></div>
        <button className="secondary-action" type="button" onClick={() => void revoke(device)}>Fjern adgang</button>
      </div>)}
    </div>
  </div>;
}
