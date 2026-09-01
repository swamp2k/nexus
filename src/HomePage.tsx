import { useEffect, useMemo, useState } from "react";
import { useCachedJson } from "./data/queryCache";
import { DashboardRefreshScope, resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import type { DashboardRefreshSettingsResponse } from "./data/dashboardRefresh";
import { widgetById, widgetRegistry } from "./widgets/widgetRegistry";
import type { WidgetSize, WidgetTargetPage } from "./widgets/widgetRegistry";

type HomeLayoutItem = { id: string; size: WidgetSize };
type HomeLayoutResponse = { layout: HomeLayoutItem[]; updatedAt: string | null; isDefault: boolean };

const FALLBACK_LAYOUT: HomeLayoutItem[] = [
  { id: "weather.current", size: "medium" },
  { id: "energy.price.current", size: "small" },
  { id: "garmin.sleep.lastNight", size: "small" },
  { id: "garmin.steps.today", size: "small" },
  { id: "wellbeing.today", size: "medium" },
];

function normalizeLayout(layout: HomeLayoutItem[]): HomeLayoutItem[] {
  return layout.filter((item, index, all) => widgetById.has(item.id) && all.findIndex((candidate) => candidate.id === item.id) === index).map((item) => {
    const widget = widgetById.get(item.id)!;
    return { id: item.id, size: widget.supportedSizes.includes(item.size) ? item.size : widget.defaultSize };
  });
}

export default function HomePage({ onOpenPage }: { onOpenPage: (page: WidgetTargetPage) => void }) {
  const [layout, setLayout] = useState<HomeLayoutItem[]>(FALLBACK_LAYOUT);
  const [draft, setDraft] = useState<HomeLayoutItem[]>(FALLBACK_LAYOUT);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const { data: refreshSettings } = useCachedJson<DashboardRefreshSettingsResponse>("/api/settings", 1_000);

  useEffect(() => {
    void fetch("/api/home-layout", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<HomeLayoutResponse>;
      })
      .then((response) => {
        const next = normalizeLayout(response.layout);
        setLayout(next);
        setDraft(next);
        setState("ready");
      })
      .catch(() => {
        setLayout(FALLBACK_LAYOUT);
        setDraft(FALLBACK_LAYOUT);
        setState("error");
      });
  }, []);

  const selectedIds = useMemo(() => new Set(draft.map((item) => item.id)), [draft]);
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof widgetRegistry>();
    for (const widget of widgetRegistry) {
      const list = groups.get(widget.group) ?? [];
      list.push(widget);
      groups.set(widget.group, list);
    }
    return [...groups.entries()];
  }, []);

  function beginEdit() {
    setDraft(layout);
    setMessage(null);
    setEditing(true);
  }

  function toggleWidget(id: string) {
    const widget = widgetById.get(id);
    if (!widget) return;
    setDraft((current) => current.some((item) => item.id === id)
      ? current.filter((item) => item.id !== id)
      : [...current, { id, size: widget.defaultSize }]);
  }

  function changeSize(id: string, size: WidgetSize) {
    const widget = widgetById.get(id);
    if (!widget?.supportedSizes.includes(size)) return;
    setDraft((current) => current.map((item) => item.id === id ? { ...item, size } : item));
  }

  function stepSize(id: string, direction: -1 | 1) {
    const widget = widgetById.get(id);
    if (!widget) return;
    setDraft((current) => current.map((item) => {
      if (item.id !== id) return item;
      const index = widget.supportedSizes.indexOf(item.size);
      const nextIndex = Math.max(0, Math.min(widget.supportedSizes.length - 1, index + direction));
      return { ...item, size: widget.supportedSizes[nextIndex] ?? item.size };
    }));
  }

  function move(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const index = current.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const copy = [...current];
      [copy[index], copy[nextIndex]] = [copy[nextIndex], copy[index]];
      return copy;
    });
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/home-layout", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout: draft }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.json() as HomeLayoutResponse;
      const next = normalizeLayout(body.layout);
      setLayout(next);
      setDraft(next);
      setEditing(false);
    } catch {
      setMessage("Layoutet kunne ikke gemmes. Kør den nyeste D1 migration, hvis den ikke er anvendt endnu.");
    } finally {
      setSaving(false);
    }
  }

  const renderedLayout = editing ? draft : layout;

  return (
    <section className={`home-page${editing ? " home-page--editing" : ""}`} aria-label="Hjem">
      <div className="home-toolbar">
        {!editing
          ? <button className="secondary-action" type="button" onClick={beginEdit}>Rediger Hjem</button>
          : <div className="home-edit-actions"><span className="home-edit-hint">Brug ←/→ til rækkefølge og −/+ til størrelse.</span><button className="secondary-action" type="button" onClick={() => { setDraft(layout); setEditing(false); setMessage(null); }}>Annuller</button><button className="primary-action" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Gemmer…" : "Gem layout"}</button></div>}
      </div>

      {state === "loading" && <p className="home-layout-note">Henter dit layout…</p>}
      {state === "error" && <p className="home-layout-note">Viser standardlayout. Det personlige layout kunne ikke hentes.</p>}
      {message && <p className="home-layout-note home-layout-note--error">{message}</p>}

      {editing && <aside className="home-editor" aria-label="Rediger Hjem">
        <div className="home-editor-copy"><strong>Vælg moduler</strong><span>Tilføj og fjern widgets her. Rækkefølge og størrelse kan også ændres direkte på dashboardet nedenunder.</span></div>
        <div className="home-editor-groups">
          {grouped.map(([group, widgets]) => <fieldset key={group}><legend>{group}</legend>{widgets.map((widget) => {
            const selected = selectedIds.has(widget.id);
            const item = draft.find((candidate) => candidate.id === widget.id);
            const index = draft.findIndex((candidate) => candidate.id === widget.id);
            return <div className="home-editor-row" key={widget.id}>
              <label><input type="checkbox" checked={selected} onChange={() => toggleWidget(widget.id)} /><span><strong>{widget.title}</strong><small>{widget.description}</small></span></label>
              {selected && item && <div className="home-editor-controls">
                {widget.supportedSizes.length > 1 && <select aria-label={`Størrelse for ${widget.title}`} value={item.size} onChange={(event) => changeSize(widget.id, event.target.value as WidgetSize)}>{widget.supportedSizes.map((size) => <option value={size} key={size}>{size === "small" ? "Lille" : size === "medium" ? "Mellem" : "Bred"}</option>)}</select>}
                <button type="button" aria-label={`Flyt ${widget.title} op`} disabled={index <= 0} onClick={() => move(widget.id, -1)}>↑</button>
                <button type="button" aria-label={`Flyt ${widget.title} ned`} disabled={index < 0 || index >= draft.length - 1} onClick={() => move(widget.id, 1)}>↓</button>
              </div>}
            </div>;
          })}</fieldset>)}
        </div>
      </aside>}

      {renderedLayout.length === 0
        ? <div className="home-empty"><strong>Hjem er tomt.</strong><span>Tryk Rediger Hjem og vælg de data du vil have her.</span></div>
        : <div className="home-widget-grid">{renderedLayout.map((item, index) => {
          const widget = widgetById.get(item.id);
          if (!widget) return null;
          const Widget = widget.component;
          const sizeIndex = widget.supportedSizes.indexOf(item.size);
          const refreshClass = resolveDashboardRefreshClass(widget.group, refreshSettings);
          return <article className={`home-widget home-widget--${item.size}${editing ? " home-widget--editing" : ""}`} data-widget-id={item.id} data-refresh-class={refreshClass} key={item.id}>
            <header><div><span>{widget.group}</span><h3>{widget.title}</h3></div>{editing
              ? <div className="home-widget-direct-controls">
                  <button type="button" title="Mindre" aria-label={`Gør ${widget.title} mindre`} disabled={sizeIndex <= 0} onClick={() => stepSize(item.id, -1)}>−</button>
                  <button type="button" title="Større" aria-label={`Gør ${widget.title} større`} disabled={sizeIndex < 0 || sizeIndex >= widget.supportedSizes.length - 1} onClick={() => stepSize(item.id, 1)}>+</button>
                  <button type="button" className="home-widget-order-button" title="Flyt tidligere" aria-label={`Flyt ${widget.title} tidligere`} disabled={index <= 0} onClick={() => move(item.id, -1)}>←</button>
                  <button type="button" className="home-widget-order-button" title="Flyt senere" aria-label={`Flyt ${widget.title} senere`} disabled={index >= renderedLayout.length - 1} onClick={() => move(item.id, 1)}>→</button>
                  <button type="button" className="home-widget-remove" title="Fjern" aria-label={`Fjern ${widget.title}`} onClick={() => toggleWidget(item.id)}>×</button>
                </div>
              : <button type="button" onClick={() => onOpenPage(widget.page)}>{widget.page} ›</button>}</header>
            <div className="home-widget-content"><DashboardRefreshScope refreshClass={refreshClass}><Widget /></DashboardRefreshScope></div>
          </article>;
        })}</div>}
    </section>
  );
}
