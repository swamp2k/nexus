import { useEffect, useMemo, useState } from "react";
import { DashboardRefreshScope, resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import type { DashboardRefreshSettingsResponse } from "./data/dashboardRefresh";
import { useCachedJson } from "./data/queryCache";
import { widgetRegistry, widgetById } from "./widgets/widgetRegistry";
import type { WidgetSize } from "./widgets/widgetRegistry";

type Dashboard = { id: string; name: string; theme: "light" | "dark" | "system"; layout: Array<{ id: string; size: WidgetSize }>; createdAt: string; updatedAt: string };
type Device = { id: string; name: string; dashboardId: string | null; dashboardName: string | null; createdAt: string; lastSeenAt: string };

const DISPLAY_GROUPS = new Set(["Strøm", "Vejr", "Kalender", "MELCloud"]);
const displayWidgets = widgetRegistry.filter((widget) => DISPLAY_GROUPS.has(widget.group));

export default function DisplaysPage() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [deviceName, setDeviceName] = useState("Køkken-iPad");
  const [message, setMessage] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const { data: refreshSettings } = useCachedJson<DashboardRefreshSettingsResponse>("/api/settings", 1_000);

  async function load() {
    const [dashboardResponse, deviceResponse] = await Promise.all([
      fetch("/api/display/dashboards", { credentials: "same-origin", cache: "no-store" }),
      fetch("/api/display/devices", { credentials: "same-origin", cache: "no-store" }),
    ]);
    if (!dashboardResponse.ok || !deviceResponse.ok) throw new Error("load_failed");
    const dashboardBody = await dashboardResponse.json() as { dashboards: Dashboard[] };
    const deviceBody = await deviceResponse.json() as { devices: Device[] };
    setDashboards(dashboardBody.dashboards);
    setDevices(deviceBody.devices);
    const id = selectedId && dashboardBody.dashboards.some((item) => item.id === selectedId) ? selectedId : dashboardBody.dashboards[0]?.id ?? null;
    setSelectedId(id);
    setDraft(dashboardBody.dashboards.find((item) => item.id === id) ?? null);
  }

  useEffect(() => { void load().catch(() => setMessage("Displays kunne ikke hentes.")); }, []);

  useEffect(() => {
    setDraft(dashboards.find((item) => item.id === selectedId) ?? null);
    setPairCode(null);
  }, [selectedId]);

  const groupedWidgets = useMemo(() => {
    const groups = new Map<string, typeof displayWidgets>();
    for (const widget of displayWidgets) groups.set(widget.group, [...(groups.get(widget.group) ?? []), widget]);
    return [...groups.entries()];
  }, []);

  async function createDashboard() {
    const response = await fetch("/api/display/dashboards", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Display ${dashboards.length + 1}` }) });
    if (!response.ok) { setMessage("Displayet kunne ikke oprettes."); return; }
    const body = await response.json() as { dashboard: Dashboard };
    await load();
    setSelectedId(body.dashboard.id);
  }

  async function saveDashboard() {
    if (!draft) return;
    const response = await fetch(`/api/display/dashboards/${encodeURIComponent(draft.id)}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, theme: draft.theme, layout: draft.layout }) });
    if (!response.ok) { setMessage("Displayet kunne ikke gemmes."); return; }
    setMessage("Displayet er gemt.");
    await load();
  }

  async function deleteDashboard() {
    if (!draft || !confirm(`Slet display-dashboardet “${draft.name}”?`)) return;
    await fetch(`/api/display/dashboards/${encodeURIComponent(draft.id)}`, { method: "DELETE", credentials: "same-origin" });
    setSelectedId(null);
    await load();
  }

  function toggleWidget(id: string) {
    if (!draft) return;
    const widget = widgetById.get(id);
    if (!widget) return;
    setDraft({ ...draft, layout: draft.layout.some((item) => item.id === id) ? draft.layout.filter((item) => item.id !== id) : [...draft.layout, { id, size: widget.defaultSize }] });
  }

  function updateWidget(id: string, patch: Partial<{ size: WidgetSize; move: -1 | 1 }>) {
    if (!draft) return;
    let layout = draft.layout;
    if (patch.size) layout = layout.map((item) => item.id === id ? { ...item, size: patch.size! } : item);
    if (patch.move) {
      const index = layout.findIndex((item) => item.id === id), target = index + patch.move;
      if (index >= 0 && target >= 0 && target < layout.length) { layout = [...layout]; [layout[index], layout[target]] = [layout[target], layout[index]]; }
    }
    setDraft({ ...draft, layout });
  }

  function stepSize(id: string, direction: -1 | 1) {
    if (!draft) return;
    const widget = widgetById.get(id);
    const item = draft.layout.find((entry) => entry.id === id);
    if (!widget || !item) return;
    const index = widget.supportedSizes.indexOf(item.size);
    const next = Math.max(0, Math.min(widget.supportedSizes.length - 1, index + direction));
    updateWidget(id, { size: widget.supportedSizes[next] });
  }

  function dropBefore(targetId: string) {
    if (!draft || !draggedId || draggedId === targetId) return;
    const source = draft.layout.findIndex((item) => item.id === draggedId);
    const target = draft.layout.findIndex((item) => item.id === targetId);
    if (source < 0 || target < 0) return;
    const layout = [...draft.layout];
    const [moved] = layout.splice(source, 1);
    const insertAt = source < target ? target - 1 : target;
    layout.splice(insertAt, 0, moved);
    setDraft({ ...draft, layout });
    setDraggedId(null);
  }

  async function createPairCode() {
    if (!draft) return;
    const response = await fetch("/api/display/pairing-code", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dashboardId: draft.id, name: deviceName }) });
    if (!response.ok) { setMessage("Parringskoden kunne ikke laves."); return; }
    const body = await response.json() as { code: string; expiresAt: string };
    setPairCode(body);
  }

  async function revokeDevice(id: string) {
    await fetch(`/api/display/devices/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
    await load();
  }

  return <section className="displays-page">
    <div className="displays-toolbar"><div><p className="section-label">Nexus displays</p><h2>Dashboards til faste skærme</h2><p>Byg flere displays med de samme widgets som Hjem, og par iPads eller andre skærme til det dashboard de skal vise.</p></div><button className="primary-action" type="button" onClick={() => void createDashboard()}>Nyt display</button></div>
    {message && <p className="home-layout-note">{message}</p>}
    <div className="displays-layout">
      <aside className="display-dashboard-list">{dashboards.map((dashboard) => <button type="button" className={selectedId === dashboard.id ? "active" : ""} key={dashboard.id} onClick={() => setSelectedId(dashboard.id)}><strong>{dashboard.name}</strong><span>{devices.filter((device) => device.dashboardId === dashboard.id).length} parret</span></button>)}</aside>
      {draft ? <div className="display-dashboard-editor">
        <section className="settings-card"><div className="settings-form"><label><span>Navn</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>Standardtema</span><select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Dashboard["theme"] })}><option value="system">Enhedens valg</option><option value="light">Lys</option><option value="dark">Mørk</option></select></label></div></section>

        <section className="display-layout-preview">
          <div className="home-editor-copy"><strong>Layout</strong><span>Træk kortene rundt direkte her. Brug −/+ til størrelse og × til at fjerne.</span></div>
          {draft.layout.length === 0 ? <div className="home-empty"><strong>Displayet er tomt.</strong><span>Tilføj widgets nedenfor.</span></div> : <div className="home-widget-grid display-dashboard-grid display-dashboard-grid--editing">
            {draft.layout.map((item, index) => {
              const widget = widgetById.get(item.id);
              if (!widget) return null;
              const Widget = widget.component;
              const sizeIndex = widget.supportedSizes.indexOf(item.size);
              const refreshClass = resolveDashboardRefreshClass(widget.group, refreshSettings);
              return <article
                className={`home-widget home-widget--${item.size} display-edit-widget${draggedId === item.id ? " is-dragging" : ""}`}
                draggable
                data-widget-id={item.id}
                key={item.id}
                onDragStart={() => setDraggedId(item.id)}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropBefore(item.id)}
              >
                <header><div><span>{widget.group}</span><h3>{widget.title}</h3></div><div className="home-widget-direct-controls">
                  <button type="button" title="Mindre" disabled={sizeIndex <= 0} onClick={() => stepSize(item.id, -1)}>−</button>
                  <button type="button" title="Større" disabled={sizeIndex >= widget.supportedSizes.length - 1} onClick={() => stepSize(item.id, 1)}>+</button>
                  <button type="button" className="home-widget-order-button" title="Flyt tidligere" disabled={index <= 0} onClick={() => updateWidget(item.id, { move: -1 })}>←</button>
                  <button type="button" className="home-widget-order-button" title="Flyt senere" disabled={index >= draft.layout.length - 1} onClick={() => updateWidget(item.id, { move: 1 })}>→</button>
                  <button type="button" className="home-widget-remove" title="Fjern" onClick={() => toggleWidget(item.id)}>×</button>
                </div></header>
                <div className="home-widget-content"><DashboardRefreshScope refreshClass={refreshClass}><Widget /></DashboardRefreshScope></div>
              </article>;
            })}
          </div>}
        </section>

        <section className="home-editor"><div className="home-editor-copy"><strong>Tilgængelige widgets</strong><span>Samme komponenter og data som på Hjem.</span></div><div className="home-editor-groups">{groupedWidgets.map(([group, widgets]) => <fieldset key={group}><legend>{group}</legend>{widgets.map((widget) => { const item = draft.layout.find((entry) => entry.id === widget.id); const index = draft.layout.findIndex((entry) => entry.id === widget.id); return <div className="home-editor-row" key={widget.id}><label><input type="checkbox" checked={Boolean(item)} onChange={() => toggleWidget(widget.id)} /><span><strong>{widget.title}</strong><small>{widget.description}</small></span></label>{item && <div className="home-editor-controls"><select value={item.size} onChange={(event) => updateWidget(widget.id, { size: event.target.value as WidgetSize })}>{widget.supportedSizes.map((size) => <option key={size} value={size}>{size === "small" ? "Lille" : size === "medium" ? "Mellem" : "Bred"}</option>)}</select><button type="button" disabled={index <= 0} onClick={() => updateWidget(widget.id, { move: -1 })}>↑</button><button type="button" disabled={index >= draft.layout.length - 1} onClick={() => updateWidget(widget.id, { move: 1 })}>↓</button></div>}</div>; })}</fieldset>)}</div></section>
        <div className="display-editor-actions"><button className="secondary-action" type="button" onClick={() => void deleteDashboard()}>Slet</button><button className="primary-action" type="button" onClick={() => void saveDashboard()}>Gem dashboard</button></div>
        <section className="settings-card"><div className="settings-card-heading"><div><p className="section-label">Pairing</p><h2>Par en skærm til {draft.name}</h2></div></div><div className="settings-form"><label><span>Enhedsnavn</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label><button className="primary-action" type="button" onClick={() => void createPairCode()}>Lav parringskode</button>{pairCode && <div className="display-pairing-code-panel"><span>Indtast på /display</span><strong className="display-pairing-code">{pairCode.code}</strong><small>Gyldig i 10 minutter.</small></div>}</div></section>
        <section className="settings-card"><div className="settings-card-heading"><div><p className="section-label">Enheder</p><h2>Parrede skærme</h2></div></div><div className="display-device-list">{devices.filter((device) => device.dashboardId === draft.id).map((device) => <div className="display-device-row" key={device.id}><div><strong>{device.name}</strong><small>Sidst set {new Date(device.lastSeenAt).toLocaleString("da-DK")}</small></div><button className="secondary-action" type="button" onClick={() => void revokeDevice(device.id)}>Fjern adgang</button></div>)}{devices.every((device) => device.dashboardId !== draft.id) && <p className="settings-help">Ingen skærme er parret endnu.</p>}</div></section>
      </div> : <div className="home-empty"><strong>Ingen displays endnu.</strong><span>Opret det første display-dashboard.</span></div>}
    </div>
  </section>;
}
