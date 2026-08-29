import { useEffect, useState } from "react";

type GridProviderOption = { key: string; label: string };
type SettingsResponse = {
  settings: {
    weatherLabel: string | null;
    weatherLat: number | null;
    weatherLon: number | null;
    energyPriceArea: "DK1" | "DK2" | null;
    energyGridProvider: string | null;
    energySupplierMarkupOere: number | null;
    updatedAt: string | null;
  };
  options?: {
    gridProviders?: GridProviderOption[];
  };
};

type SaveState = "idle" | "saving" | "saved" | "error";
type LocateState = "idle" | "locating" | "error";

export default function SettingsPage() {
  const [label, setLabel] = useState("Hjem");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [energyPriceArea, setEnergyPriceArea] = useState<"DK1" | "DK2">("DK1");
  const [energyGridProvider, setEnergyGridProvider] = useState("Konstant");
  const [energySupplierMarkupOere, setEnergySupplierMarkupOere] = useState("0");
  const [gridProviders, setGridProviders] = useState<GridProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [locateState, setLocateState] = useState<LocateState>("idle");

  useEffect(() => {
    void fetch("/api/settings", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<SettingsResponse>;
      })
      .then(({ settings, options }) => {
        setLabel(settings.weatherLabel || "Hjem");
        setLatitude(settings.weatherLat === null ? "" : String(settings.weatherLat));
        setLongitude(settings.weatherLon === null ? "" : String(settings.weatherLon));
        setEnergyPriceArea(settings.energyPriceArea === "DK2" ? "DK2" : "DK1");
        setEnergyGridProvider(settings.energyGridProvider || "Konstant");
        setEnergySupplierMarkupOere(String(settings.energySupplierMarkupOere ?? 0));
        setGridProviders(options?.gridProviders ?? []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  function changed() {
    setSaveState("idle");
  }

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
        changed();
      },
      () => setLocateState("error"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60 * 1000 },
    );
  }

  async function save() {
    setSaveState("saving");
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          weatherLabel: label,
          weatherLat: Number(latitude),
          weatherLon: Number(longitude),
          energyPriceArea,
          energyGridProvider,
          energySupplierMarkupOere: Number(energySupplierMarkupOere),
        }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const { settings } = await response.json() as SettingsResponse;
      setLabel(settings.weatherLabel || "Hjem");
      setLatitude(String(settings.weatherLat));
      setLongitude(String(settings.weatherLon));
      setEnergyPriceArea(settings.energyPriceArea === "DK2" ? "DK2" : "DK1");
      setEnergyGridProvider(settings.energyGridProvider || "Konstant");
      setEnergySupplierMarkupOere(String(settings.energySupplierMarkupOere ?? 0));
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <article className="settings-card">
        <div className="settings-card-heading">
          <div><p className="section-label">Personligt</p><h2 id="settings-heading">Lokation</h2><p>Bruges til vejrudsigt og andre lokale Nexus-kilder. Indstillingen gemmes kun for din bruger.</p></div>
          <span className="settings-icon" aria-hidden="true">⌖</span>
        </div>
        {loading ? <p className="settings-loading">Henter indstillinger…</p> : (
          <div className="settings-form">
            <label><span>Navn på stedet</span><input value={label} onChange={(event) => { setLabel(event.target.value); changed(); }} placeholder="Hjem" maxLength={80} /></label>
            <div className="settings-location-actions">
              <button className="primary-action" type="button" onClick={useCurrentLocation} disabled={locateState === "locating"}>{locateState === "locating" ? "Finder placering…" : "Brug min aktuelle placering"}</button>
              <span>Browseren spørger om tilladelse til lokation.</span>
            </div>
            <details className="settings-advanced">
              <summary>Avanceret: koordinater</summary>
              <div className="settings-coordinate-grid">
                <label><span>Breddegrad</span><input inputMode="decimal" value={latitude} onChange={(event) => { setLatitude(event.target.value); changed(); }} /></label>
                <label><span>Længdegrad</span><input inputMode="decimal" value={longitude} onChange={(event) => { setLongitude(event.target.value); changed(); }} /></label>
              </div>
            </details>
            {locateState === "error" && <p className="settings-feedback error">Placeringen kunne ikke læses fra browseren.</p>}
          </div>
        )}
      </article>

      <article className="settings-card">
        <div className="settings-card-heading">
          <div><p className="section-label">Strøm</p><h2>Elpris</h2><p>Nexus kombinerer spotpris med dit netselskabs aktuelle tarif, Energinet, elafgift, moms og dit elselskabs kWh-tillæg.</p></div>
          <span className="settings-icon" aria-hidden="true">ϟ</span>
        </div>
        {loading ? <p className="settings-loading">Henter indstillinger…</p> : (
          <div className="settings-form">
            <div className="settings-choice-grid" role="radiogroup" aria-label="Elprisområde">
              <button className={`settings-choice ${energyPriceArea === "DK1" ? "active" : ""}`} type="button" onClick={() => { setEnergyPriceArea("DK1"); changed(); }}><strong>DK1</strong><span>Vestdanmark · Jylland og Fyn</span></button>
              <button className={`settings-choice ${energyPriceArea === "DK2" ? "active" : ""}`} type="button" onClick={() => { setEnergyPriceArea("DK2"); changed(); }}><strong>DK2</strong><span>Østdanmark · Sjælland og Bornholm</span></button>
            </div>

            <label>
              <span>Netselskab</span>
              <select value={energyGridProvider} onChange={(event) => { setEnergyGridProvider(event.target.value); changed(); }}>
                {(gridProviders.length ? gridProviders : [{ key: "Konstant", label: "Konstant" }]).map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}
              </select>
            </label>

            <label>
              <span>Elselskabets tillæg · øre/kWh ekskl. moms</span>
              <input inputMode="decimal" type="number" min="0" max="500" step="0.01" value={energySupplierMarkupOere} onChange={(event) => { setEnergySupplierMarkupOere(event.target.value); changed(); }} />
            </label>
            <p className="settings-help">Faste abonnementer påvirker ikke, om det er billigt at bruge 1 kWh lige nu, og fordeles derfor ikke ind i timeprisen.</p>
          </div>
        )}
      </article>

      {!loading && (
        <div className="settings-save-bar">
          <div>{saveState === "saved" && <p className="settings-feedback success">Indstillingerne er gemt.</p>}{saveState === "error" && <p className="settings-feedback error">Indstillingerne kunne ikke gemmes.</p>}</div>
          <button className="primary-action" type="button" onClick={() => void save()} disabled={saveState === "saving" || !latitude || !longitude}>{saveState === "saving" ? "Gemmer…" : "Gem indstillinger"}</button>
        </div>
      )}
    </section>
  );
}
