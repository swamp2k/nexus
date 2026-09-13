import { useEffect, useState } from "react";
import { DEFAULT_INTEGRATIONS } from "./data/integrations";
import type { IntegrationKey, IntegrationMap } from "./data/integrations";

type IntegrationDefinition = {
  key: IntegrationKey;
  label: string;
  description: string;
};

const DEFINITIONS: IntegrationDefinition[] = [
  { key: "garmin", label: "Garmin + Motion", description: "Sundhedsdata, søvn, aktiviteter og Motion-siden." },
  { key: "wellbeing", label: "Velbefindende + Miyagi", description: "Daglige check-ins, historik og Miyagi." },
  { key: "weather", label: "Vejr", description: "Vejrside og vejrdata." },
  { key: "electricity", label: "Strøm + Eloverblik", description: "Elpriser, elforbrug og Eloverblik." },
  { key: "calendar", label: "Kalender", description: "Kalenderside, iCal-kilder og affaldsdata." },
  { key: "melcloud", label: "Varmepumpe", description: "MELCloud-integration og varmepumpeside." },
  { key: "dba", label: "DBA", description: "DBA-modul og overvågninger." },
  { key: "unraid", label: "Unraid", description: "UnraidWatch, serverstatus og containere." },
  { key: "pcwatch", label: "PC Watch", description: "PC Watch-modulet." },
  { key: "notifications", label: "Notifikationer", description: "Notifikationsmodulet." },
  { key: "displays", label: "Displays", description: "Display-dashboard og pairing." },
];

export default function IntegrationSettings() {
  const [integrations, setIntegrations] = useState<IntegrationMap>(DEFAULT_INTEGRATIONS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<IntegrationKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/integrations", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{ integrations: IntegrationMap }>;
      })
      .then((body) => setIntegrations({ ...DEFAULT_INTEGRATIONS, ...body.integrations }))
      .catch(() => setError("Integrationerne kunne ikke hentes."))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: IntegrationKey) {
    const previous = integrations;
    const next = { ...integrations, [key]: !integrations[key] };
    setIntegrations(next);
    setSaving(key);
    setError(null);
    try {
      const response = await fetch("/api/integrations", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ integrations: { [key]: next[key] } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { integrations: IntegrationMap };
      const saved = { ...DEFAULT_INTEGRATIONS, ...body.integrations };
      setIntegrations(saved);
      window.dispatchEvent(new CustomEvent("nexus-integrations-changed", { detail: saved }));
    } catch {
      setIntegrations(previous);
      setError("Ændringen kunne ikke gemmes.");
    } finally {
      setSaving(null);
    }
  }

  if (loading) return <p className="settings-loading">Henter integrationer…</p>;

  return <div className="settings-form integrations-settings">
    <p className="settings-help">Slå moduler fra, som du ikke bruger. Det skjuler sider, widgets og tilhørende indstillinger, men sletter ikke data eller credentials.</p>
    <div className="integration-toggle-list">
      {DEFINITIONS.map((integration) => <div className="integration-toggle-row" key={integration.key}>
        <div><strong>{integration.label}</strong><span>{integration.description}</span></div>
        <button
          type="button"
          className={`integration-toggle ${integrations[integration.key] ? "active" : ""}`}
          aria-pressed={integrations[integration.key]}
          disabled={saving === integration.key}
          onClick={() => void toggle(integration.key)}
        >
          <span className="integration-toggle-knob" />
          <span className="sr-only">{integrations[integration.key] ? "Deaktivér" : "Aktivér"} {integration.label}</span>
        </button>
      </div>)}
    </div>
    {error && <p className="settings-feedback error">{error}</p>}
  </div>;
}
