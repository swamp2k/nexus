import { useEffect, useMemo, useState } from "react";
import WidgetCard from "./dashboard/WidgetCard";
import { changeSize, moveWidget, normalizeLayout, removeWidget, SIZE_LABELS, sizeIndex, stepSize, toggleWidget } from "./dashboard/layoutEditing";
import type { LayoutItem } from "./dashboard/layoutEditing";
import { resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import { useSettings } from "./data/settings";
import { discoverUnraidWidgets, widgetCatalog, widgetDefinitionById } from "./widgets/widgetCatalog";
import type { UnraidOverview } from "./widgets/widgetCatalog";
import { isUnraidContainerWidgetId, SelectedContainersWidget } from "./widgets/unraidWidgets";
import { widgetRefreshGroup } from "./widgets/widgetRegistry";
import type { WidgetDefinition, WidgetSize, WidgetTargetPage } from "./widgets/widgetRegistry";

type HomeLayoutResponse = { layout: LayoutItem[]; updatedAt: string | null; isDefault: boolean };

const FALLBACK_LAYOUT: LayoutItem[] = [
  { id: "weather.current", size: "medium" },
  { id: "energy.price.current", size: "small" },
  { id: "garmin.sleep.lastNight", size: "small" },
  { id: "garmin.steps.today", size: "small" },
  { id: "wellbeing.today", size: "medium" },
];

/** Selected Docker containers render together as one card with this ID. */
const CONTAINER_GROUP_ID = "unraid.containers.selected";

function isCompactEntityWidget(id: string): boolean {
  return id.startsWith("unraid.vm.");
}

function containerGroupSize(items: LayoutItem[]): WidgetSize {
  return items.some((item) => item.size === "wide") ? "wide" : "medium";
}

export default function HomePage({ onOpenPage }: { onOpenPage: (page: WidgetTargetPage) => void }) {
  const [layout, setLayout] = useState<LayoutItem[]>(FALLBACK_LAYOUT);
  const [draft, setDraft] = useState<LayoutItem[]>(FALLBACK_LAYOUT);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [unraidCatalog, setUnraidCatalog] = useState<UnraidOverview | null>(null);
  const [unraidCatalogLoading, setUnraidCatalogLoading] = useState(false);
  const { data: refreshSettings } = useSettings();

  useEffect(() => {
    void fetch("/api/home-layout", { credentials: "same-origin", cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<HomeLayoutResponse>;
      })
      .then((response) => {
        const next = normalizeLayout(response.layout, widgetDefinitionById);
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
  const availableWidgets = useMemo(() => {
    const result: WidgetDefinition[] = [...widgetCatalog, ...discoverUnraidWidgets(unraidCatalog)];
    const seen = new Set(result.map((widget) => widget.id));
    for (const item of draft) {
      if (seen.has(item.id)) continue;
      const widget = widgetDefinitionById(item.id);
      if (widget) { result.push(widget); seen.add(item.id); }
    }
    return result;
  }, [draft, unraidCatalog]);
  const availableById = useMemo(() => new Map(availableWidgets.map((widget) => [widget.id, widget])), [availableWidgets]);
  const resolve = (id: string) => availableById.get(id) ?? widgetDefinitionById(id);
  const grouped = useMemo(() => {
    const groups = new Map<string, WidgetDefinition[]>();
    for (const widget of availableWidgets) {
      const list = groups.get(widget.group) ?? [];
      list.push(widget);
      groups.set(widget.group, list);
    }
    return [...groups.entries()];
  }, [availableWidgets]);

  async function loadUnraidCatalog() {
    setUnraidCatalogLoading(true);
    try {
      const response = await fetch("/api/unraid/overview", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      setUnraidCatalog(await response.json() as UnraidOverview);
    } catch {
      // Static Unraid widgets still remain available; only dynamic discovery is skipped.
    } finally {
      setUnraidCatalogLoading(false);
    }
  }

  function beginEdit() {
    setDraft(layout);
    setMessage(null);
    setEditing(true);
    void loadUnraidCatalog();
  }

  // Selected containers are stored as individual items but edited as one card.
  function stepContainerGroupSize(direction: -1 | 1) {
    setDraft((current) => {
      const selected = current.filter((item) => isUnraidContainerWidgetId(item.id));
      if (selected.length === 0) return current;
      const nextSize: WidgetSize = direction < 0 ? "medium" : "wide";
      if (containerGroupSize(selected) === nextSize) return current;
      return current.map((item) => isUnraidContainerWidgetId(item.id) ? { ...item, size: nextSize } : item);
    });
  }

  function moveContainerGroup(direction: -1 | 1) {
    setDraft((current) => {
      const containers = current.filter((item) => isUnraidContainerWidgetId(item.id));
      const firstContainerIndex = current.findIndex((item) => isUnraidContainerWidgetId(item.id));
      if (containers.length === 0 || firstContainerIndex < 0) return current;
      const others = current.filter((item) => !isUnraidContainerWidgetId(item.id));
      const visualIndex = current.slice(0, firstContainerIndex).filter((item) => !isUnraidContainerWidgetId(item.id)).length;
      const target = Math.max(0, Math.min(others.length, visualIndex + direction));
      if (target === visualIndex) return current;
      const next = [...others];
      next.splice(target, 0, ...containers);
      return next;
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
      const next = normalizeLayout(body.layout, widgetDefinitionById);
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
  const selectedContainers = renderedLayout.filter((item) => isUnraidContainerWidgetId(item.id));
  const firstContainerIndex = renderedLayout.findIndex((item) => isUnraidContainerWidgetId(item.id));
  const selectedContainerIds = selectedContainers.map((item) => item.id);
  const selectedContainerSize = containerGroupSize(selectedContainers);
  const containerVisualIndex = firstContainerIndex < 0 ? -1 : renderedLayout.slice(0, firstContainerIndex).filter((item) => !isUnraidContainerWidgetId(item.id)).length;
  const visualItemCount = renderedLayout.filter((item) => !isUnraidContainerWidgetId(item.id)).length + (selectedContainers.length > 0 ? 1 : 0);

  return (
    <section className={`home-page${editing ? " home-page--editing" : ""}`} aria-label="Hjem">
      <div className="home-toolbar">
        {!editing
          ? <button className="secondary-action" type="button" onClick={beginEdit}>Rediger Hjem</button>
          : <div className="home-edit-actions"><span className="home-edit-hint">Brug pilene til rækkefølge og −/+ til størrelse.</span><button className="secondary-action" type="button" onClick={() => { setDraft(layout); setEditing(false); setMessage(null); }}>Annuller</button><button className="primary-action" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Gemmer…" : "Gem layout"}</button></div>}
      </div>

      {state === "loading" && <p className="home-layout-note">Henter dit layout…</p>}
      {state === "error" && <p className="home-layout-note">Viser standardlayout. Det personlige layout kunne ikke hentes.</p>}
      {message && <p className="home-layout-note home-layout-note--error">{message}</p>}

      {editing && <aside className="home-editor" aria-label="Rediger Hjem">
        <div className="home-editor-copy"><strong>Vælg moduler</strong><span>Tilføj og fjern widgets her. Rækkefølge og størrelse kan også ændres direkte på dashboardet nedenunder.</span></div>
        {unraidCatalogLoading && <p className="home-layout-note">Henter containere og VM'er fra UnraidWatch…</p>}
        <div className="home-editor-groups">
          {grouped.map(([group, widgets]) => <fieldset key={group}><legend>{group}</legend>{widgets.map((widget) => {
            const selected = selectedIds.has(widget.id);
            const item = draft.find((candidate) => candidate.id === widget.id);
            const index = draft.findIndex((candidate) => candidate.id === widget.id);
            const groupedContainer = isUnraidContainerWidgetId(widget.id);
            return <div className="home-editor-row" key={widget.id}>
              <label><input type="checkbox" checked={selected} onChange={() => setDraft((current) => toggleWidget(current, widget.id, resolve))} /><span><strong>{widget.title}</strong><small>{widget.description}</small></span></label>
              {selected && item && !groupedContainer && <div className="home-editor-controls">
                {widget.supportedSizes.length > 1 && <select aria-label={`Størrelse for ${widget.title}`} value={item.size} onChange={(event) => setDraft((current) => changeSize(current, widget.id, event.target.value as WidgetSize, resolve))}>{widget.supportedSizes.map((size) => <option value={size} key={size}>{SIZE_LABELS[size]}</option>)}</select>}
                <button type="button" aria-label={`Flyt ${widget.title} op`} disabled={index <= 0} onClick={() => setDraft((current) => moveWidget(current, widget.id, -1))}>↑</button>
                <button type="button" aria-label={`Flyt ${widget.title} ned`} disabled={index < 0 || index >= draft.length - 1} onClick={() => setDraft((current) => moveWidget(current, widget.id, 1))}>↓</button>
              </div>}
            </div>;
          })}</fieldset>)}
        </div>
      </aside>}

      {renderedLayout.length === 0
        ? <div className="home-empty"><strong>Hjem er tomt.</strong><span>Tryk Rediger Hjem og vælg de data du vil have her.</span></div>
        : <div className="home-widget-grid">{renderedLayout.map((item, index) => {
          if (isUnraidContainerWidgetId(item.id)) {
            if (index !== firstContainerIndex) return null;
            const refreshClass = resolveDashboardRefreshClass("Unraid", refreshSettings);
            return <WidgetCard key={CONTAINER_GROUP_ID} id={CONTAINER_GROUP_ID} title={`Containere · ${selectedContainers.length}`} kicker="Unraid" size={selectedContainerSize} rows={selectedContainers.length > 6 ? 2 : 1} refreshClass={refreshClass}
              link={{ label: "Unraid", onClick: () => onOpenPage("Unraid") }}
              edit={editing ? {
                canShrink: selectedContainerSize === "wide",
                canGrow: selectedContainerSize === "medium",
                canMoveEarlier: containerVisualIndex > 0,
                canMoveLater: containerVisualIndex >= 0 && containerVisualIndex < visualItemCount - 1,
                onShrink: () => stepContainerGroupSize(-1),
                onGrow: () => stepContainerGroupSize(1),
                onMoveEarlier: () => moveContainerGroup(-1),
                onMoveLater: () => moveContainerGroup(1),
                onRemove: () => setDraft((current) => current.filter((entry) => !isUnraidContainerWidgetId(entry.id))),
              } : undefined}>
              <SelectedContainersWidget widgetIds={selectedContainerIds} />
            </WidgetCard>;
          }

          const widget = resolve(item.type ?? item.id);
          if (!widget) return null;
          const Widget = widget.component;
          const refreshClass = resolveDashboardRefreshClass(widgetRefreshGroup(widget), refreshSettings);
          const currentSize = sizeIndex(item, widget);
          return <WidgetCard key={item.id} id={item.id} title={widget.title} kicker={widget.group} size={item.size} rows={widget.rows} compact={isCompactEntityWidget(item.id)} refreshClass={refreshClass}
            link={{ label: widget.page, onClick: () => onOpenPage(widget.page) }}
            edit={editing ? {
              canShrink: currentSize > 0,
              canGrow: currentSize >= 0 && currentSize < widget.supportedSizes.length - 1,
              canMoveEarlier: index > 0,
              canMoveLater: index < renderedLayout.length - 1,
              onShrink: () => setDraft((current) => stepSize(current, item.id, -1, resolve)),
              onGrow: () => setDraft((current) => stepSize(current, item.id, 1, resolve)),
              onMoveEarlier: () => setDraft((current) => moveWidget(current, item.id, -1)),
              onMoveLater: () => setDraft((current) => moveWidget(current, item.id, 1)),
              onRemove: () => setDraft((current) => removeWidget(current, item.id)),
            } : undefined}>
            <Widget />
          </WidgetCard>;
        })}</div>}
    </section>
  );
}
