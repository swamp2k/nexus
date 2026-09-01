import { useEffect, useState } from "react";
import CalendarSourceSettings from "./CalendarSourceSettings";
import GarminImportSettings from "./GarminImportSettings";
import MelCloudSettings from "./MelCloudSettings";
import WellbeingMetricSettings from "./WellbeingMetricSettings";

type GridProviderOption = { key: string; label: string };
type SettingsResponse = {
  settings: {
    weatherLabel: string | null;
    weatherLat: number | null;
    weatherLon: number | null;
    energyPriceArea: "DK1" | "DK2" | null;
    energyGridProvider: string | null;
    energySupplierMarkupOere: number | null;
    energyLowPriceDkk: number | null;
    energyHighPriceDkk: number | null;
    updatedAt: string | null;
  };
  options?: { gridProviders?: GridProviderOption[] };
};

type SaveState = "idle" | "saving" | "saved" | "error";
type LocateState = "idle" | "locating" | "error";

async function responseError(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: string; detail?: string };
    return body.detail ?? body.error ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

export default function SettingsPage() {
  const [label, setLabel] = useState("Hjem");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [energyPriceArea, setEnergyPriceArea] = useState<"DK1" | "DK2">("DK1");
  const [energyGridProvider, setEnergyGridProvider] = useState("Konstant");
  const [energySupplierMarkupOere, setEnergySupplierMarkupOere] = useState("0");
  const [energyLowPriceDkk, setEnergyLowPriceDkk] = useState("1");
  const [energyHighPriceDkk, setEnergyHighPriceDkk] = useState("2");
  const [gridProviders, setGridProviders] = useState<GridProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
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
        setEnergyLowPriceDkk(String(settings.energyLowPriceDkk ?? 1));
        setEnergyHighPriceDkk(String(settings.energyHighPriceDkk ?? 2));
        setGridProviders(options?.gridProviders ?? []);
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  function changed() { setSaveState("idle"); setSaveError(null); }

  function useCurrentLocation() {
    if (!navigator.geolocation) { setLocateState("error"); return; }
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
    const lowBand = Number(energyLowPriceDkk);
    const highBand = Number(energyHighPriceDkk);
    if (!Number.isFinite(lowBand) || !Number.isFinite(highBand) || lowBand < 0 || highBand <= lowBand) {
      setSaveError("Grænsen for høj pris skal være større end grænsen for lav pris.");
      setSaveState("error");
      return;
    }

    setSaveError(null);
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
          energyLowPriceDkk: lowBand,
          energyHighPriceDkk: highBand,
        }),
      });
      if (!response.ok) throw new Error(await responseError(response));
      const { settings } = await response.json() as SettingsResponse;
      setLabel(settings.weatherLabel || "Hjem");
      setLatitude(String(settings.weatherLat));
      setLongitude(String(settings.weatherLon));
      setEnergyPriceArea(settings.energyPriceArea === "DK2" ? "DK2" : "DK1");
      setEnergyGridProvider(settings.energyGridProvider || "Konstant");
      setEnergySupplierMarkupOere(String(settings.energySupplierMarkupOere ?? 0));
      setEnergyLowPriceDkk(String(settings.energyLowPriceDkk ?? 1));
      setEnergyHighPriceDkk(String(settings.energyHighPriceDkk ?? 2));
      setSaveState("saved");
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Ukendt fejl");
      setSaveState("error");
    }
  }

  return (
    <section className="settings-page" aria-labelledby="settings-heading">
      <details className="settings-card settings-collapsible">
        <summary className="settings-card-heading">
          <div><p className="section-label">Personligt</p><h2 id="settings-heading">Lokation</h2></div>
          <span className="settings-icon" aria-hidden="true">⌖</span>
        </summary>
        {loading ? <p className="settings-loading">Henter indstillinger…</p> : (
          <div className="settings-form">
            <label><span>Navn på stedet</span><input value={label} onChange={(event) => { setLabel(event.target.value); changed(); }} placeholder="Hjem" maxLength={80} /></label>
            <div className="settings-location-actions"><button className="primary-action" type="button" onClick={useCurrentLocation} disabled={locateState === "locating"}>{locateState === "locating" ? "Finder placering…" : "Brug min aktuelle placering"}</button><span>Browseren spørger om tilladelse til lokation.</span></div>
            <details className="settings-advanced"><summary>Avanceret: koordinater</summary><div className="settings-coordinate-grid"><label><span>Breddegrad</span><input inputMode="decimal" value={latitude} onChange={(event) => { setLatitude(event.target.value); changed(); }} /></label><label><span>Længdegrad</span><input inputMode="decimal" value={longitude} onChange={(event) => { setLongitude(event.target.value); changed(); }} /></label></div></details>
            {locateState === "error" && <p className="settings-feedback error">Placeringen kunne ikke læses fra browseren.</p>}
          </div>
        )}
      </details>

      <details className="settings-card settings-collapsible">
        <summary className="settings-card-heading"><div><p className="section-label">Strøm</p><h2>Elpris</h2></div><span className="settings-icon" aria-hidden="true">ϟ</span></summary>
        {loading ? <p className="settings-loading">Henter indstillinger…</p> : (
          <div className="settings-form">
            <div className="settings-choice-grid" role="radiogroup" aria-label="Elprisområde">
              <button className={`settings-choice ${energyPriceArea === "DK1" ? "active" : ""}`} type="button" onClick={() => { setEnergyPriceArea("DK1"); changed(); }}><strong>DK1</strong><span>Vestdanmark · Jylland og Fyn</span></button>
              <button className={`settings-choice ${energyPriceArea === "DK2" ? "active" : ""}`} type="button" onClick={() => { setEnergyPriceArea("DK2"); changed(); }}><strong>DK2</strong><span>Østdanmark · Sjælland og Bornholm</span></button>
            </div>
            <label><span>Netselskab</span><select value={energyGridProvider} onChange={(event) => { setEnergyGridProvider(event.target.value); changed(); }}>{(gridProviders.length ? gridProviders : [{ key: "Konstant", label: "Konstant" }]).map((provider) => <option key={provider.key} value={provider.key}>{provider.label}</option>)}</select></label>
            <label><span>Elselskabets tillæg · øre/kWh ekskl. moms</span><input inputMode="decimal" type="number" min="0" max="500" step="0.01" value={energySupplierMarkupOere} onChange={(event) => { setEnergySupplierMarkupOere(event.target.value); changed(); }} /></label>
            <div className="settings-coordinate-grid">
              <label><span>Lav pris · op til kr/kWh</span><input inputMode="decimal" type="number" min="0" max="20" step="0.05" value={energyLowPriceDkk} onChange={(event) => { setEnergyLowPriceDkk(event.target.value); changed(); }} /></label>
              <label><span>Høj pris · fra kr/kWh</span><input inputMode="decimal" type="number" min="0" max="20" step="0.05" value={energyHighPriceDkk} onChange={(event) => { setEnergyHighPriceDkk(event.target.value); changed(); }} /></label>
            </div>
            <div className="energy-band-preview" aria-label="Farvegrænser for elpris"><span className="low">Lav ≤ {energyLowPriceDkk || "—"} kr</span><span className="medium">Middel</span><span className="high">Høj ≥ {energyHighPriceDkk || "—"} kr</span></div>
            <p className="settings-help">Farvegrænserne bruges på elprissøjlerne på både Strøm-siden og køkkendisplayet. Faste abonnementer fordeles ikke ind i timeprisen.</p>
          </div>
        )}
      </details>

      <details className="settings-card settings-collapsible settings-component-wrapper">
        <summary className="settings-card-heading"><div><p className="section-label">Datakilde</p><h2>Kalender · iCal</h2></div><span className="settings-icon" aria-hidden="true">▦</span></summary>
        <CalendarSourceSettings />
      </details>

      <details className="settings-card settings-collapsible settings-component-wrapper">
        <summary className="settings-card-heading"><div><p className="section-label">Datakilde</p><h2>MELCloud</h2></div><span className="settings-icon" aria-hidden="true">◫</span></summary>
        <MelCloudSettings />
      </details>

      <WellbeingMetricSettings />

      <details className="settings-card settings-collapsible settings-component-wrapper">
        <summary className="settings-card-heading"><div><p className="section-label">Datakilde</p><h2>Garmin</h2></div><span className="settings-icon" aria-hidden="true">⌖</span></summary>
        <GarminImportSettings />
      </details>

      {!loading && <div className="settings-save-bar"><div>{saveState === "saved" && <p className="settings-feedback success">Indstillingerne er gemt.</p>}{saveState === "error" && <p className="settings-feedback error">Indstillingerne kunne ikke gemmes: {saveError ?? "ukendt fejl"}.</p>}</div><button className="primary-action" type="button" onClick={() => void save()} disabled={saveState === "saving" || !latitude || !longitude}>{saveState === "saving" ? "Gemmer…" : "Gem indstillinger"}</button></div>}
    </section>
  );
}
