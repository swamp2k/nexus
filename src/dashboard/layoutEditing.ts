import type { WidgetDefinition, WidgetSize } from "../widgets/widgetRegistry";

export type WidgetConfig = Record<string, unknown>;
export type WidgetRows = 1 | 2 | 3;

/**
 * Stored dashboard item. Legacy widgets use `id` as both instance and widget
 * type. Configurable widgets can keep a stable instance `id` and point at a
 * reusable widget definition through `type`.
 *
 * `size` controls width. `rows` optionally overrides the registry's default
 * height for this specific dashboard instance.
 */
export type LayoutItem = {
  id: string;
  size: WidgetSize;
  rows?: WidgetRows;
  type?: string;
  config?: WidgetConfig;
};

export type WidgetResolver = (id: string) => WidgetDefinition | undefined;

export const SIZE_LABELS: Record<WidgetSize, string> = { small: "Lille", medium: "Mellem", wide: "Bred" };
export const ROW_OPTIONS: WidgetRows[] = [1, 2, 3];

/**
 * Pure layout edits shared by Home and the Displays editor. Every function
 * returns a new array (or the same one when nothing changed), so callers can
 * pass them straight to a state setter.
 */

export function normalizeLayout(layout: LayoutItem[], resolve: WidgetResolver): LayoutItem[] {
  const seen = new Set<string>();
  const result: LayoutItem[] = [];
  for (const item of layout) {
    const widget = resolve(item.type ?? item.id);
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({
      ...item,
      size: !widget || widget.supportedSizes.includes(item.size) ? item.size : widget.defaultSize,
      ...(item.rows === 1 || item.rows === 2 || item.rows === 3 ? { rows: item.rows } : { rows: undefined }),
    });
  }
  return result;
}

export function toggleWidget(layout: LayoutItem[], id: string, resolve: WidgetResolver): LayoutItem[] {
  if (layout.some((item) => item.id === id)) return layout.filter((item) => item.id !== id);
  const widget = resolve(id);
  return widget ? [...layout, { id, size: widget.defaultSize }] : layout;
}

export function removeWidget(layout: LayoutItem[], id: string): LayoutItem[] {
  return layout.filter((item) => item.id !== id);
}

export function changeSize(layout: LayoutItem[], id: string, size: WidgetSize, resolve: WidgetResolver): LayoutItem[] {
  const item = layout.find((candidate) => candidate.id === id);
  const widget = item ? resolve(item.type ?? item.id) : undefined;
  if (!widget?.supportedSizes.includes(size)) return layout;
  return layout.map((candidate) => candidate.id === id ? { ...candidate, size } : candidate);
}

export function stepSize(layout: LayoutItem[], id: string, direction: -1 | 1, resolve: WidgetResolver): LayoutItem[] {
  const current = layout.find((item) => item.id === id);
  const widget = current ? resolve(current.type ?? current.id) : undefined;
  if (!widget) return layout;
  return layout.map((item) => {
    if (item.id !== id) return item;
    const index = widget.supportedSizes.indexOf(item.size);
    const next = Math.max(0, Math.min(widget.supportedSizes.length - 1, index + direction));
    return { ...item, size: widget.supportedSizes[next] ?? item.size };
  });
}

export function effectiveRows(item: Pick<LayoutItem, "rows">, widget?: Pick<WidgetDefinition, "rows">): WidgetRows {
  return item.rows ?? widget?.rows ?? 1;
}

export function changeRows(layout: LayoutItem[], id: string, rows: WidgetRows): LayoutItem[] {
  return layout.map((item) => item.id === id ? { ...item, rows } : item);
}

export function cycleRows(layout: LayoutItem[], id: string, fallbackRows: WidgetRows = 1): LayoutItem[] {
  return layout.map((item) => {
    if (item.id !== id) return item;
    const current = item.rows ?? fallbackRows;
    return { ...item, rows: current === 3 ? 1 : current + 1 as WidgetRows };
  });
}

export function moveWidget(layout: LayoutItem[], id: string, direction: -1 | 1): LayoutItem[] {
  return stepVisualWidget(layout, id, direction);
}

export function sizeIndex(item: LayoutItem, widget: WidgetDefinition): number {
  return widget.supportedSizes.indexOf(item.size);
}

/** A displayed card can represent multiple stored items (Home containers). */
export function visualWidgetIds(layout: LayoutItem[], visualId: (id: string) => string = (id) => id): string[] {
  return [...new Set(layout.map((item) => visualId(item.id)))];
}

/** Move an entire visual group, preserving every instance and its config. */
export function moveVisualWidget(layout: LayoutItem[], sourceId: string, targetId: string, after: boolean,
  visualId: (id: string) => string = (id) => id): LayoutItem[] {
  if (sourceId === targetId) return layout;
  const ids = visualWidgetIds(layout, visualId);
  if (!ids.includes(sourceId) || !ids.includes(targetId)) return layout;
  const order = ids.filter((id) => id !== sourceId);
  order.splice(order.indexOf(targetId) + Number(after), 0, sourceId);
  return order.flatMap((id) => layout.filter((item) => visualId(item.id) === id));
}

export function stepVisualWidget(layout: LayoutItem[], id: string, direction: -1 | 1,
  visualId: (id: string) => string = (id) => id): LayoutItem[] {
  const ids = visualWidgetIds(layout, visualId);
  const index = ids.indexOf(id);
  const target = ids[index + direction];
  return index < 0 || !target ? layout : moveVisualWidget(layout, id, target, direction > 0, visualId);
}
