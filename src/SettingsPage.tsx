import { useEffect, useState } from "react";

type SettingsResponse = {
  settings: {
    weatherLabel: string | null;
    weatherLat: number | null;
    weatherLon: number | null;
    updatedAt: string | null;
  };
};

type SaveState = "idle" | "saving" | "saved" | "error";

type LocateState = "idle" | "locating" | "error";

export default function SettingsPage() {
  const [label, setLabel] = useState("Hjem");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [locateState, setLocateState] = useState<LocateState>("idle");

  useEffect(() => {
    void fetch("/api/settings", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<SettingsResponse>;
      })
      .then(({ settings }) => {
        setLabel(settings.weatherLabel || "Hjem");
        setLatitude(settings.weatherLat === null ? "" : String(settings.weatherLat));
        setLongitude(settings.weatherLon === null ? "" : String(settings.weatherLon));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      setLocateState("error");
      return;
    }

    setLocateState("locating");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(5));
        setLongitude(position.coords.longitude.toFixed(5));
        setLocateState("idle");
        setSaveState("idle");
      },
      () => setLocateState("error"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  async function save() {
    setSaveState("saving");
    try {
      const weatherLat = Number(latitude);
      const weatherLon = Number(longitude);
      const response = await fetch("/api/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weatherLabel: label,
          weatherLat,
          weatherLon,
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { settings } = await response.json() as SettingsResponse;
      setLabel(settings.weatherLabel || "Hjem");
      setLatitude(String(settings.weatherLat));
      setLongitude(String(settings.weatherLon));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <article className="settings-card">
        <div className="settings-card-heading">
          <div>
            <p className="section-label">Personligt</p>
            <h2 id="settings-heading">Lokation</h2>
            <p>Bruges til vejrudsigt og andre lokale Nexus-kilder. Indstillingen gemmes kun for din bruger.</p>
          </div>
          <span className="settings-icon" aria-hidden="true">⌖</span>
        </div>

        {loading ? (
          <p className="settings-loading">Henter indstillinger…</p>
        ) : (
          <div className="settings-form">
            <label>
              <span>Navn på stedet</span>
              <input value={label} onChange={(event) => { setLabel(event.target.value); setSaveState("idle"); }} placeholder="Hjem" maxLength={80} />
            </label>

            <div className="settings-location-actions">
              <button className="primary-action" type="button" onClick={useCurrentLocation} disabled={locateState === "locating"}>
                {locateState === "locating" ? "Finder placering…" : "Brug min aktuelle placering"}
              </button>
              <span>Browseren spørger om tilladelse til lokation.</span>
            </div>

            <details className="settings-advanced">
              <summary>Avanceret: koordinater</summary>
              <div className="settings-coordinate-grid">
                <label>
                  <span>Breddegrad</span>
                  <input inputMode="decimal" value={latitude} onChange={(event) => { setLatitude(event.target.value); setSaveState("idle"); }} placeholder="56.19440" />
                </label>
                <label>
                  <span>Længdegrad</span>
                  <input inputMode="decimal" value={longitude} onChange={(event) => { setLongitude(event.target.value); setSaveState("idle"); }} placeholder="10.68210" />
                </label>
              </div>
            </details>

            {locateState === "error" && <p className="settings-feedback error">Placeringen kunne ikke læses fra browseren. Du kan indtaste koordinaterne manuelt.</p>}
            {saveState === "saved" && <p className="settings-feedback success">Lokationen er gemt. Vejrmodulet bruger den ved næste opdatering.</p>}
            {saveState === "error" && <p className="settings-feedback error">Indstillingerne kunne ikke gemmes.</p>}

            <div className="settings-save-row">
              <button className="primary-action" type="button" onClick={() => void save()} disabled={saveState === "saving" || !latitude || !longitude}>
                {saveState === "saving" ? "Gemmer…" : "Gem lokation"}
              </button>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
