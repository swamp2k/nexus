import { useEffect, useMemo, useState } from "react";
import { useWidgetDrag } from "./dashboard/useWidgetDrag";
import { unavailableWidgetDefinition } from "./widgets/unavailableWidget";
import WidgetCard from "./dashboard/WidgetCard";
import { changeRows, changeSize, cycleRows, effectiveRows, moveVisualWidget, moveWidget, removeWidget, ROW_OPTIONS, SIZE_LABELS, sizeIndex, stepSize, toggleWidget } from "./dashboard/layoutEditing";
import type { LayoutItem, WidgetRows } from "./dashboard/layoutEditing";
import { resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import { useSettings } from "./data/settings";
import { widgetCatalog, widgetDefinitionById } from "./widgets/widgetCatalog";
import { widgetRefreshGroup, widgetSupportsSurface } from "./widgets/widgetRegistry";
import type { WidgetSize } from "./widgets/widgetRegistry";

type Dashboard = { id: string; name: string; theme: "light" | "dark" | "system"; layout: LayoutItem[]; createdAt: string; updatedAt: string };
type Device = { id: string; name: string; dashboardId: string | null; dashboardName: string | null; createdAt: string; lastSeenAt: string };

const displayWidgets = widgetCatalog.filter((widget) => widgetSupportsSurface(widget, "display"));

export default function DisplaysPage() {
  const [dashboards, setDashboards] = useState<Dashboard[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Dashboard | null>(null);
  const [pairCode, setPairCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [deviceName, setDeviceName] = useState("Køkken-iPad");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: refreshSettings } = useSettings();

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

  function updateLayout(update: (layout: LayoutItem[]) => LayoutItem[]) {
    setDraft((current) => current ? { ...current, layout: update(current.layout) } : current);
  }

  const drag = useWidgetDrag(Boolean(draft) && !saving, ({ source, target, after }) =>
    updateLayout((layout) => moveVisualWidget(layout, source, target, after)), draft?.id);

  async function createDashboard() {
    const response = await fetch("/api/display/dashboards", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: `Display ${dashboards.length + 1}` }) });
    if (!response.ok) { setMessage("Displayet kunne ikke oprettes."); return; }
    const body = await response.json() as { dashboard: Dashboard };
    await load();
    setSelectedId(body.dashboard.id);
  }

  async function saveDashboard() {
    if (!draft || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/display/dashboards/${encodeURIComponent(draft.id)}`, { method: "PUT", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, theme: draft.theme, layout: draft.layout }) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as { dashboard: Dashboard };
      setDashboards((current) => current.map((item) => item.id === draft.id ? body.dashboard : item));
      setDraft(body.dashboard);
      setMessage("Displayet er gemt.");
    } catch {
      setMessage("Displayet kunne ikke gemmes. Dine ændringer er bevaret; prøv igen.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteDashboard() {
    if (!draft || !confirm(`Slet display-dashboardet “${draft.name}”?`)) return;
    await fetch(`/api/display/dashboards/${encodeURIComponent(draft.id)}`, { method: "DELETE", credentials: "same-origin" });
    setSelectedId(null);
    await load();
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

  return <section className="displays-page" inert={saving} aria-busy={saving}>
    <div className="displays-toolbar"><div><p className="section-label">Nexus displays</p><h2>Dashboards til faste skærme</h2><p>Byg flere displays med de samme widgets som Hjem, og par iPads eller andre skærme til det dashboard de skal vise.</p></div><button className="primary-action" type="button" onClick={() => void createDashboard()}>Nyt display</button></div>
    {message && <p className="home-layout-note">{message}</p>}
    <div className="displays-layout">
      <aside className="display-dashboard-list">{dashboards.map((dashboard) => <button type="button" className={selectedId === dashboard.id ? "active" : ""} key={dashboard.id} onClick={() => setSelectedId(dashboard.id)}><strong>{dashboard.name}</strong><span>{devices.filter((device) => device.dashboardId === dashboard.id).length} parret</span></button>)}</aside>
      {draft ? <div className="display-dashboard-editor">
        <section className="settings-card"><div className="settings-form"><label><span>Navn</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>Standardtema</span><select value={draft.theme} onChange={(event) => setDraft({ ...draft, theme: event.target.value as Dashboard["theme"] })}><option value="system">Enhedens valg</option><option value="light">Lys</option><option value="dark">Mørk</option></select></label></div></section>

        <section className="display-layout-preview">
          <div className="home-editor-copy"><strong>Layout</strong><span>Træk i ⠿ for at flytte, eller brug pilene. −/+ ændrer bredde, ↕ ændrer højde. Kolonnerne tilpasses pladsen her; displayet bruger sin egen skærmbredde.</span></div>
          {draft.layout.length === 0 ? <div className="home-empty"><strong>Displayet er tomt.</strong><span>Tilføj widgets nedenfor.</span></div> : <div className="home-widget-grid display-dashboard-grid display-dashboard-grid--editing" ref={drag.gridRef}>
            {draft.layout.map((item, index) => {
              const widget = widgetDefinitionById(item.type ?? item.id) ?? unavailableWidgetDefinition(item.type ?? item.id);
              const Widget = widget.component;
              const currentSize = sizeIndex(item, widget);
              const rows = effectiveRows(item, widget);
              const refreshClass = resolveDashboardRefreshClass(widgetRefreshGroup(widget), refreshSettings);
              return <WidgetCard key={item.id} id={item.id} title={widget.resolveTitle?.(item.config) ?? widget.title} kicker={widget.group} size={item.size} rows={rows} refreshClass={refreshClass}
                className={drag.cardClass(item.id)}
                dragHandleProps={drag.handleProps(item.id)}
                edit={{
                  canShrink: currentSize > 0,
                  canGrow: currentSize >= 0 && currentSize < widget.supportedSizes.length - 1,
                  rows,
                  onCycleRows: () => updateLayout((layout) => cycleRows(layout, item.id, widget.rows ?? 1)),
                  canMoveEarlier: index > 0,
                  canMoveLater: index < draft.layout.length - 1,
                  onShrink: () => updateLayout((layout) => stepSize(layout, item.id, -1, widgetDefinitionById)),
                  onGrow: () => updateLayout((layout) => stepSize(layout, item.id, 1, widgetDefinitionById)),
                  onMoveEarlier: () => updateLayout((layout) => moveWidget(layout, item.id, -1)),
                  onMoveLater: () => updateLayout((layout) => moveWidget(layout, item.id, 1)),
                  onRemove: () => updateLayout((layout) => removeWidget(layout, item.id)),
                }}>
                <Widget config={item.config} />
              </WidgetCard>;
            })}
          </div>}
        </section>

        <section className="home-editor"><div className="home-editor-copy"><strong>Tilgængelige widgets</strong><span>Samme komponenter og data som på Hjem.</span></div><div className="home-editor-groups">{groupedWidgets.map(([group, widgets]) => <fieldset key={group}><legend>{group}</legend>{widgets.map((widget) => { const item = draft.layout.find((entry) => entry.id === widget.id); const index = draft.layout.findIndex((entry) => entry.id === widget.id); return <div className="home-editor-row" key={widget.id}><label><input type="checkbox" checked={Boolean(item)} onChange={() => updateLayout((layout) => toggleWidget(layout, widget.id, widgetDefinitionById))} /><span><strong>{widget.title}</strong><small>{widget.description}</small></span></label>{item && <div className="home-editor-controls"><select aria-label={`Bredde for ${widget.title}`} value={item.size} onChange={(event) => updateLayout((layout) => changeSize(layout, widget.id, event.target.value as WidgetSize, widgetDefinitionById))}>{widget.supportedSizes.map((size) => <option key={size} value={size}>{SIZE_LABELS[size]}</option>)}</select><select aria-label={`Højde for ${widget.title}`} value={effectiveRows(item, widget)} onChange={(event) => updateLayout((layout) => changeRows(layout, widget.id, Number(event.target.value) as WidgetRows))}>{ROW_OPTIONS.map((rows) => <option key={rows} value={rows}>{rows} række{rows === 1 ? "" : "r"}</option>)}</select><button type="button" aria-label={`Flyt ${widget.title} op`} disabled={index <= 0} onClick={() => updateLayout((layout) => moveWidget(layout, widget.id, -1))}>↑</button><button type="button" aria-label={`Flyt ${widget.title} ned`} disabled={index >= draft.layout.length - 1} onClick={() => updateLayout((layout) => moveWidget(layout, widget.id, 1))}>↓</button></div>}</div>; })}</fieldset>)}</div></section>
        <div className="display-editor-actions"><button className="secondary-action" type="button" onClick={() => void deleteDashboard()}>Slet</button><button className="primary-action" type="button" onClick={() => void saveDashboard()}>Gem dashboard</button></div>
        <section className="settings-card"><div className="settings-card-heading"><div><p className="section-label">Pairing</p><h2>Par en skærm til {draft.name}</h2></div></div><div className="settings-form"><label><span>Enhedsnavn</span><input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} /></label><button className="primary-action" type="button" onClick={() => void createPairCode()}>Lav parringskode</button>{pairCode && <div className="display-pairing-code-panel"><span>Indtast på /display</span><strong className="display-pairing-code">{pairCode.code}</strong><small>Gyldig i 10 minutter.</small></div>}</div></section>
        <section className="settings-card"><div className="settings-card-heading"><div><p className="section-label">Enheder</p><h2>Parrede skærme</h2></div></div><div className="display-device-list">{devices.filter((device) => device.dashboardId === draft.id).map((device) => <div className="display-device-row" key={device.id}><div><strong>{device.name}</strong><small>Sidst set {new Date(device.lastSeenAt).toLocaleString("da-DK")}</small></div><button className="secondary-action" type="button" onClick={() => void revokeDevice(device.id)}>Fjern adgang</button></div>)}{devices.every((device) => device.dashboardId !== draft.id) && <p className="settings-help">Ingen skærme er parret endnu.</p>}</div></section>
      </div> : <div className="home-empty"><strong>Ingen displays endnu.</strong><span>Opret det første display-dashboard.</span></div>}
    </div>
    <p className="widget-sr-only" role="status">{drag.announcement}</p>
  </section>;
}
