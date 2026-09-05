import type { WidgetDefinition, WidgetSize } from "../widgets/widgetRegistry";

export type WidgetConfig = Record<string, unknown>;

/**
 * Stored dashboard item. Legacy widgets use `id` as both instance and widget
 * type. Configurable widgets can keep a stable instance `id` and point at a
 * reusable widget definition through `type`.
 */
export type LayoutItem = {
  id: string;
  size: WidgetSize;
  type?: string;
  config?: WidgetConfig;
};

export type WidgetResolver = (id: string) => WidgetDefinition | undefined;

export const SIZE_LABELS: Record<WidgetSize, string> = { small: "Lille", medium: "Mellem", wide: "Bred" };

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
    if (!widget || seen.has(item.id)) continue;
    seen.add(item.id);
    result.push({
      ...item,
      size: widget.supportedSizes.includes(item.size) ? item.size : widget.defaultSize,
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

export function moveWidget(layout: LayoutItem[], id: string, direction: -1 | 1): LayoutItem[] {
  const index = layout.findIndex((item) => item.id === id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= layout.length) return layout;
  const copy = [...layout];
  [copy[index], copy[target]] = [copy[target], copy[index]];
  return copy;
}

/** Drag/drop: place `sourceId` before `targetId`. */
export function moveBefore(layout: LayoutItem[], sourceId: string, targetId: string): LayoutItem[] {
  if (sourceId === targetId) return layout;
  const source = layout.findIndex((item) => item.id === sourceId);
  const target = layout.findIndex((item) => item.id === targetId);
  if (source < 0 || target < 0) return layout;
  const copy = [...layout];
  const [moved] = copy.splice(source, 1);
  copy.splice(source < target ? target - 1 : target, 0, moved);
  return copy;
}

export function sizeIndex(item: LayoutItem, widget: WidgetDefinition): number {
  return widget.supportedSizes.indexOf(item.size);
}
