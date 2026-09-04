import type { HTMLAttributes, ReactNode } from "react";
import { DashboardRefreshScope } from "../data/dashboardRefresh";
import type { RefreshClass } from "../data/dashboardRefresh";
import type { WidgetSize } from "../widgets/widgetRegistry";

export type WidgetEditControls = {
  canShrink: boolean;
  canGrow: boolean;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onShrink: () => void;
  onGrow: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRemove: () => void;
};

type DragProps = Pick<HTMLAttributes<HTMLElement>, "draggable" | "onDragStart" | "onDragEnd" | "onDragOver" | "onDrop">;

export type WidgetCardProps = {
  id: string;
  title: string;
  /** Source/module label. Shown only when editing, where the catalogue is the context. */
  kicker?: string;
  size: WidgetSize;
  rows?: 1 | 2;
  compact?: boolean;
  refreshClass: RefreshClass;
  /** Drill-down to the feature page. Not rendered on paired displays. */
  link?: { label: string; onClick: () => void };
  /** When present the card renders inline edit controls instead of the link. */
  edit?: WidgetEditControls;
  className?: string;
  dragProps?: DragProps;
  children: ReactNode;
};

/**
 * The one card markup for dashboard widgets. Home, the Displays editor and
 * paired displays all render through here so sizing, headers and controls
 * cannot drift apart.
 */
export default function WidgetCard({ id, title, kicker, size, rows = 1, compact, refreshClass, link, edit, className, dragProps, children }: WidgetCardProps) {
  const classes = ["home-widget", `home-widget--${size}`];
  if (rows === 2) classes.push("home-widget--rows-2");
  if (compact) classes.push("home-widget--compact");
  if (edit) classes.push("home-widget--editing");
  if (className) classes.push(className);

  return <article className={classes.join(" ")} data-widget-id={id} data-refresh-class={refreshClass} {...dragProps}>
    <header>
      <div>{edit && kicker && <span className="home-widget-kicker">{kicker}</span>}<h3>{title}</h3></div>
      {edit
        ? <div className="home-widget-direct-controls">
            <button type="button" title="Mindre" aria-label={`Gør ${title} mindre`} disabled={!edit.canShrink} onClick={edit.onShrink}>−</button>
            <button type="button" title="Større" aria-label={`Gør ${title} større`} disabled={!edit.canGrow} onClick={edit.onGrow}>+</button>
            <button type="button" className="home-widget-order-button" title="Flyt tidligere" aria-label={`Flyt ${title} tidligere`} disabled={!edit.canMoveEarlier} onClick={edit.onMoveEarlier}><span className="glyph-row">←</span><span className="glyph-col">↑</span></button>
            <button type="button" className="home-widget-order-button" title="Flyt senere" aria-label={`Flyt ${title} senere`} disabled={!edit.canMoveLater} onClick={edit.onMoveLater}><span className="glyph-row">→</span><span className="glyph-col">↓</span></button>
            <button type="button" className="home-widget-remove" title="Fjern" aria-label={`Fjern ${title}`} onClick={edit.onRemove}>×</button>
          </div>
        : link && <button type="button" className="home-widget-link" onClick={link.onClick}>{link.label} ›</button>}
    </header>
    <div className="home-widget-content"><DashboardRefreshScope refreshClass={refreshClass}>{children}</DashboardRefreshScope></div>
  </article>;
}
