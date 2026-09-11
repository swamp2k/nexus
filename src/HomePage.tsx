import { useEffect, useMemo, useState } from "react";
import { useWidgetDrag } from "./dashboard/useWidgetDrag";
import { unavailableWidgetDefinition } from "./widgets/unavailableWidget";
import WidgetCard from "./dashboard/WidgetCard";
import { changeRows, changeSize, cycleRows, effectiveRows, moveVisualWidget, stepVisualWidget, visualWidgetIds, normalizeLayout, removeWidget, ROW_OPTIONS, SIZE_LABELS, sizeIndex, stepSize, toggleWidget } from "./dashboard/layoutEditing";
import type { LayoutItem, WidgetRows } from "./dashboard/layoutEditing";
import { resolveDashboardRefreshClass } from "./data/dashboardRefresh";
import { useSettings } from "./data/settings";
import { discoverUnraidWidgets, widgetCatalog, widgetDefinitionById } from "./widgets/widgetCatalog";
import type { UnraidOverview } from "./widgets/widgetCatalog";
import { isUnraidContainerWidgetId, SelectedContainersWidget } from "./widgets/unraidWidgets";
import { createLinkCollectionConfig, LINK_COLLECTION_TYPE, LinkCollectionEditor } from "./widgets/LinkCollectionWidget";
import type { LinkCollectionConfig } from "./widgets/LinkCollectionWidget";
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
const homeVisualId = (id: string) => isUnraidContainerWidgetId(id) ? CONTAINER_GROUP_ID : id;
const moveHomeWidget = (layout: LayoutItem[], id: string, direction: -1 | 1) =>
  stepVisualWidget(layout, homeVisualId(id), direction, homeVisualId);

function isCompactEntityWidget(id: string): boolean {
  return id.startsWith("unraid.vm.");
}

function containerGroupSize(items: LayoutItem[]): WidgetSize {
  return items.some((item) => item.size === "wide") ? "wide" : "medium";
}

function containerGroupRows(items: LayoutItem[]): WidgetRows {
  const explicit = items.flatMap((item) => item.rows ? [item.rows] : []);
  return explicit.length > 0 ? Math.max(...explicit) as WidgetRows : items.length > 6 ? 2 : 1;
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
      if (widget.repeatable) continue;
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

  function cycleContainerGroupRows() {
    setDraft((current) => {
      const selected = current.filter((item) => isUnraidContainerWidgetId(item.id));
      if (selected.length === 0) return current;
      const currentRows = containerGroupRows(selected);
      const nextRows = currentRows === 3 ? 1 : currentRows + 1 as WidgetRows;
      return current.map((item) => isUnraidContainerWidgetId(item.id) ? { ...item, rows: nextRows } : item);
    });
  }

  function addLinkCollection() {
    setDraft((current) => [...current, {
      id: `${LINK_COLLECTION_TYPE}.${crypto.randomUUID()}`,
      type: LINK_COLLECTION_TYPE,
      size: "small",
      config: createLinkCollectionConfig(),
    }]);
  }

  function updateLinkCollection(id: string, config: LinkCollectionConfig) {
    setDraft((current) => current.map((item) => item.id === id ? { ...item, config } : item));
  }

  async function save() {
    if (saving) return;
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
  const selectedContainerRows = containerGroupRows(selectedContainers);
  const visualIds = visualWidgetIds(renderedLayout, homeVisualId);
  const containerVisualIndex = visualIds.indexOf(CONTAINER_GROUP_ID);
  const visualItemCount = visualIds.length;
  const drag = useWidgetDrag(editing && !saving, ({ source, target, after }) =>
    setDraft((current) => moveVisualWidget(current, source, target, after, homeVisualId)));

  return (
    <section className={`home-page${editing ? " home-page--editing" : ""}`} aria-label="Hjem" inert={saving} aria-busy={saving}>
      <div className="home-toolbar">
        {!editing
          ? <button className="secondary-action" type="button" disabled={state === "loading"} onClick={beginEdit}>Rediger Hjem</button>
          : <div className="home-edit-actions"><span className="home-edit-hint">Træk i ⠿ for at flytte. −/+ ændrer bredde, ↕ ændrer højde.</span><button className="secondary-action" type="button" onClick={() => { setDraft(layout); setEditing(false); setMessage(null); }}>Annuller</button><button className="primary-action" type="button" disabled={saving} onClick={() => void save()}>{saving ? "Gemmer…" : "Gem layout"}</button></div>}
      </div>

      {state === "loading" && <p className="home-layout-note">Henter dit layout…</p>}
      {state === "error" && <p className="home-layout-note">Viser standardlayout. Det personlige layout kunne ikke hentes.</p>}
      {message && <p className="home-layout-note home-layout-note--error">{message}</p>}

      {editing && <aside className="home-editor" aria-label="Rediger Hjem">
        <div className="home-editor-copy"><strong>Vælg moduler</strong><span>Tilføj og fjern widgets her. Bredde, højde og rækkefølge kan også ændres direkte på dashboardet nedenunder.</span></div>
        {unraidCatalogLoading && <p className="home-layout-note">Henter containere og VM'er fra UnraidWatch…</p>}
        <div className="home-editor-groups">
          <fieldset className="link-collection-editor-group">
            <legend>Links</legend>
            <div className="link-collection-editor-group-heading">
              <span>Lav små, personlige samlinger med op til fem links.</span>
              <button type="button" className="secondary-action" onClick={addLinkCollection}>+ Ny linksamling</button>
            </div>
            {draft.filter((item) => item.type === LINK_COLLECTION_TYPE).length === 0
              ? <p className="link-collection-editor-empty">Ingen linksamlinger endnu.</p>
              : draft.filter((item) => item.type === LINK_COLLECTION_TYPE).map((item) => <div className="link-collection-editor-card" key={item.id}>
                  <LinkCollectionEditor config={item.config} onChange={(config) => updateLinkCollection(item.id, config)} />
                  <button type="button" className="link-collection-remove-collection" onClick={() => setDraft((current) => removeWidget(current, item.id))}>Fjern samling</button>
                </div>)}
          </fieldset>
          {grouped.map(([group, widgets]) => <fieldset key={group}><legend>{group}</legend>{widgets.map((widget) => {
            const selected = selectedIds.has(widget.id);
            const item = draft.find((candidate) => candidate.id === widget.id);
            const index = visualIds.indexOf(homeVisualId(widget.id));
            const groupedContainer = isUnraidContainerWidgetId(widget.id);
            return <div className="home-editor-row" key={widget.id}>
              <label><input type="checkbox" checked={selected} onChange={() => setDraft((current) => toggleWidget(current, widget.id, resolve))} /><span><strong>{widget.title}</strong><small>{widget.description}</small></span></label>
              {selected && item && !groupedContainer && <div className="home-editor-controls">
                {widget.supportedSizes.length > 1 && <select aria-label={`Bredde for ${widget.title}`} value={item.size} onChange={(event) => setDraft((current) => changeSize(current, widget.id, event.target.value as WidgetSize, resolve))}>{widget.supportedSizes.map((size) => <option value={size} key={size}>{SIZE_LABELS[size]}</option>)}</select>}
                <select aria-label={`Højde for ${widget.title}`} value={effectiveRows(item, widget)} onChange={(event) => setDraft((current) => changeRows(current, widget.id, Number(event.target.value) as WidgetRows))}>{ROW_OPTIONS.map((rows) => <option value={rows} key={rows}>{rows} række{rows === 1 ? "" : "r"}</option>)}</select>
                <button type="button" aria-label={`Flyt ${widget.title} op`} disabled={index <= 0} onClick={() => setDraft((current) => moveHomeWidget(current, widget.id, -1))}>↑</button>
                <button type="button" aria-label={`Flyt ${widget.title} ned`} disabled={index < 0 || index >= visualIds.length - 1} onClick={() => setDraft((current) => moveHomeWidget(current, widget.id, 1))}>↓</button>
              </div>}
            </div>;
          })}</fieldset>)}
        </div>
      </aside>}

      {renderedLayout.length === 0
        ? <div className="home-empty"><strong>Hjem er tomt.</strong><span>Tryk Rediger Hjem og vælg de data du vil have her.</span></div>
        : <div className="home-widget-grid" ref={drag.gridRef}>{renderedLayout.map((item, index) => {
          if (isUnraidContainerWidgetId(item.id)) {
            if (index !== firstContainerIndex) return null;
            const refreshClass = resolveDashboardRefreshClass("Unraid", refreshSettings);
            return <WidgetCard key={CONTAINER_GROUP_ID} id={CONTAINER_GROUP_ID} className={drag.cardClass(CONTAINER_GROUP_ID)} dragHandleProps={editing ? drag.handleProps(CONTAINER_GROUP_ID) : undefined} title={`Containere · ${selectedContainers.length}`} kicker="Unraid" size={selectedContainerSize} rows={selectedContainerRows} refreshClass={refreshClass}
              link={{ label: "Unraid", onClick: () => onOpenPage("Unraid") }}
              edit={editing ? {
                canShrink: selectedContainerSize === "wide",
                canGrow: selectedContainerSize === "medium",
                rows: selectedContainerRows,
                onCycleRows: cycleContainerGroupRows,
                canMoveEarlier: containerVisualIndex > 0,
                canMoveLater: containerVisualIndex >= 0 && containerVisualIndex < visualItemCount - 1,
                onShrink: () => stepContainerGroupSize(-1),
                onGrow: () => stepContainerGroupSize(1),
                onMoveEarlier: () => setDraft((current) => moveHomeWidget(current, CONTAINER_GROUP_ID, -1)),
                onMoveLater: () => setDraft((current) => moveHomeWidget(current, CONTAINER_GROUP_ID, 1)),
                onRemove: () => setDraft((current) => current.filter((entry) => !isUnraidContainerWidgetId(entry.id))),
              } : undefined}>
              <SelectedContainersWidget widgetIds={selectedContainerIds} />
            </WidgetCard>;
          }

          const widget = resolve(item.type ?? item.id) ?? unavailableWidgetDefinition(item.type ?? item.id);
          const Widget = widget.component;
          const refreshClass = resolveDashboardRefreshClass(widgetRefreshGroup(widget), refreshSettings);
          const currentSize = sizeIndex(item, widget);
          const rows = effectiveRows(item, widget);
          const title = widget.resolveTitle?.(item.config) ?? widget.title;
          return <WidgetCard key={item.id} id={item.id} className={drag.cardClass(item.id)} dragHandleProps={editing ? drag.handleProps(item.id) : undefined} title={title} kicker={widget.group} size={item.size} rows={rows} compact={isCompactEntityWidget(item.id)} refreshClass={refreshClass}
            link={widget.page ? { label: widget.page, onClick: () => onOpenPage(widget.page!) } : undefined}
            edit={editing ? {
              canShrink: currentSize > 0,
              canGrow: currentSize >= 0 && currentSize < widget.supportedSizes.length - 1,
              rows,
              onCycleRows: () => setDraft((current) => cycleRows(current, item.id, widget.rows ?? 1)),
              canMoveEarlier: visualIds.indexOf(item.id) > 0,
              canMoveLater: visualIds.indexOf(item.id) < visualIds.length - 1,
              onShrink: () => setDraft((current) => stepSize(current, item.id, -1, resolve)),
              onGrow: () => setDraft((current) => stepSize(current, item.id, 1, resolve)),
              onMoveEarlier: () => setDraft((current) => moveHomeWidget(current, item.id, -1)),
              onMoveLater: () => setDraft((current) => moveHomeWidget(current, item.id, 1)),
              onRemove: () => setDraft((current) => removeWidget(current, item.id)),
            } : undefined}>
            <Widget config={item.config} />
          </WidgetCard>;
        })}</div>}
      <p className="widget-sr-only" role="status">{drag.announcement}</p>
    </section>
  );
}
