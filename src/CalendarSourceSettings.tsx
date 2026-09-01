import { useEffect, useState } from "react";

type CalendarSource = {
  id: string;
  name: string;
  enabled: boolean;
  host: string;
  updatedAt: string;
};

type SourcesResponse = { sources: CalendarSource[] };

async function errorText(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string };
    if (body.error === "calendar_http_401" || body.error === "calendar_http_403") return "Kalenderlinket kræver adgang. Brug et privat/hemmeligt iCal-link, der kan åbnes uden login.";
    if (body.error === "calendar_not_ics") return "Linket returnerede ikke en iCal-kalender.";
    if (body.error === "invalid_calendar_source") return "Navn eller kalenderlink er ugyldigt. Nexus accepterer HTTPS/webcal-links.";
    return body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function CalendarSourceSettings() {
  const [sources, setSources] = useState<CalendarSource[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/calendar/sources", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("calendar_sources_load_failed");
      const body = await response.json() as SourcesResponse;
      setSources(body.sources);
    } catch {
      setMessage("Kalenderkilderne kunne ikke hentes.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function addSource() {
    setSaving(true); setMessage(null);
    try {
      const response = await fetch("/api/calendar/sources", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url }),
      });
      if (!response.ok) throw new Error(await errorText(response));
      setName(""); setUrl(""); setMessage("Kalenderen er tilføjet.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kalenderen kunne ikke tilføjes.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleSource(source: CalendarSource) {
    await fetch(`/api/calendar/sources/${encodeURIComponent(source.id)}`, {
      method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !source.enabled }),
    });
    await load();
  }

  async function removeSource(source: CalendarSource) {
    if (!window.confirm(`Fjern kalenderen “${source.name}”?`)) return;
    await fetch(`/api/calendar/sources/${encodeURIComponent(source.id)}`, { method: "DELETE", credentials: "same-origin" });
    await load();
  }

  if (loading) return <p className="settings-loading">Henter kalenderkilder…</p>;

  return <div className="calendar-source-body calendar-source-settings">
    {sources.length > 0 && <div className="calendar-source-list">{sources.map((source) => <div key={source.id}><div><strong>{source.name}</strong><span>{source.host}</span></div><div><button type="button" className="secondary-action" onClick={() => void toggleSource(source)}>{source.enabled ? "Aktiv" : "Pauset"}</button><button type="button" className="calendar-remove" onClick={() => void removeSource(source)}>Fjern</button></div></div>)}</div>}
    <div className="calendar-add-form"><label><span>Navn</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Familiekalender" maxLength={80} /></label><label><span>iCal-link</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://…/calendar.ics" inputMode="url" /></label><button className="primary-action" type="button" disabled={saving || !name.trim() || !url.trim()} onClick={() => void addSource()}>{saving ? "Tester og tilføjer…" : "Tilføj kalender"}</button></div>
    <p className="settings-help">Nexus gemmer kalenderlinket privat pr. bruger og viser det ikke igen. Et Google-link findes under kalenderens indstillinger → Integrer kalender → Hemmelig adresse i iCal-format. Dette er læseadgang; Nexus kan ikke ændre aftaler via iCal.</p>
    {message && <p className="calendar-message">{message}</p>}
  </div>;
}
