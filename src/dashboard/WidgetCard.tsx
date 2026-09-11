import type { ButtonHTMLAttributes, ReactNode } from "react";
import { DashboardRefreshScope } from "../data/dashboardRefresh";
import type { RefreshClass } from "../data/dashboardRefresh";
import type { WidgetSize } from "../widgets/widgetRegistry";
import type { WidgetRows } from "./layoutEditing";

export type WidgetEditControls = {
  canShrink: boolean;
  canGrow: boolean;
  rows: WidgetRows;
  onCycleRows: () => void;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  onShrink: () => void;
  onGrow: () => void;
  onMoveEarlier: () => void;
  onMoveLater: () => void;
  onRemove: () => void;
};

type DragHandleProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown">;

export type WidgetCardProps = {
  id: string;
  title: string;
  /** Source/module label. Shown only when editing, where the catalogue is the context. */
  kicker?: string;
  size: WidgetSize;
  rows?: WidgetRows;
  compact?: boolean;
  refreshClass: RefreshClass;
  /** Drill-down to the feature page. Not rendered on paired displays. */
  link?: { label: string; onClick: () => void };
  /** When present the card renders inline edit controls instead of the link. */
  edit?: WidgetEditControls;
  className?: string;
  dragHandleProps?: DragHandleProps;
  children: ReactNode;
};

/**
 * The one card markup for dashboard widgets. Home, the Displays editor and
 * paired displays all render through here so sizing, headers and controls
 * cannot drift apart.
 */
export default function WidgetCard({ id, title, kicker, size, rows = 1, compact, refreshClass, link, edit, className, dragHandleProps, children }: WidgetCardProps) {
  const classes = ["home-widget", `home-widget--${size}`, `home-widget--rows-${rows}`];
  if (compact) classes.push("home-widget--compact");
  if (edit) classes.push("home-widget--editing");
  if (className) classes.push(className);

  return <article className={classes.join(" ")} data-widget-id={id} data-refresh-class={refreshClass} data-widget-rows={rows}>
    <header>
      <div>{edit && kicker && <span className="home-widget-kicker">{kicker}</span>}<h3>{title}</h3></div>
      {edit
        ? <div className="home-widget-direct-controls">
            {dragHandleProps && <button type="button" className="widget-drag-handle" title="Træk for at flytte; brug pilene med tastatur" aria-label={`Træk ${title} for at flytte`} {...dragHandleProps}>⠿</button>}
            <button type="button" title="Mindre" aria-label={`Gør ${title} smallere`} disabled={!edit.canShrink} onClick={edit.onShrink}>−</button>
            <button type="button" title="Større" aria-label={`Gør ${title} bredere`} disabled={!edit.canGrow} onClick={edit.onGrow}>+</button>
            <button type="button" className="home-widget-height-button" title={`Højde: ${edit.rows} række${edit.rows === 1 ? "" : "r"}. Klik for næste højde.`} aria-label={`Højde for ${title}: ${edit.rows} række${edit.rows === 1 ? "" : "r"}. Skift højde.`} onClick={edit.onCycleRows}>↕{edit.rows}</button>
            <button type="button" className="home-widget-order-button" title="Flyt tidligere" aria-label={`Flyt ${title} tidligere`} disabled={!edit.canMoveEarlier} onClick={edit.onMoveEarlier}><span className="glyph-row">←</span><span className="glyph-col">↑</span></button>
            <button type="button" className="home-widget-order-button" title="Flyt senere" aria-label={`Flyt ${title} senere`} disabled={!edit.canMoveLater} onClick={edit.onMoveLater}><span className="glyph-row">→</span><span className="glyph-col">↓</span></button>
            <button type="button" className="home-widget-remove" title="Fjern" aria-label={`Fjern ${title}`} onClick={edit.onRemove}>×</button>
          </div>
        : link && <button type="button" className="home-widget-link" onClick={link.onClick}>{link.label} ›</button>}
    </header>
    <div className="home-widget-content"><DashboardRefreshScope refreshClass={refreshClass}>{children}</DashboardRefreshScope></div>
  </article>;
}
