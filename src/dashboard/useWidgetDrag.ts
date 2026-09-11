import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Drop = { source: string; target: string; after: boolean };
type Session = { source: string; pointerId: number; x: number; y: number; startX: number; startY: number; active: boolean; handle: HTMLButtonElement };

/** Handle-only pointer dragging. The grid stays in place until a valid drop. */
export function useWidgetDrag(enabled: boolean, onDrop: (drop: Drop) => void, scope?: string) {
  const gridRef = useRef<HTMLDivElement>(null);
  const session = useRef<Session | null>(null);
  const dropRef = useRef<Drop | null>(null);
  const callback = useRef(onDrop);
  callback.current = onDrop;
  const [source, setSource] = useState<string | null>(null);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const finish = (commit: boolean) => {
      const current = session.current;
      session.current = null;
      cancelAnimationFrame(frame);
      if (current?.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
      if (commit && dropRef.current) {
        callback.current(dropRef.current);
        setAnnouncement("Widget flyttet. Gem layoutet for at beholde rækkefølgen.");
      } else if (current?.active) setAnnouncement("Flytning annulleret.");
      dropRef.current = null;
      setSource(null);
      setDrop(null);
    };
    const hitTest = () => {
      const current = session.current;
      const grid = gridRef.current;
      if (!current?.active || !grid) return;
      const card = document.elementFromPoint(current.x, current.y)?.closest<HTMLElement>("[data-widget-id]");
      let next: Drop | null = null;
      if (card && card.parentElement === grid && card.dataset.widgetId !== current.source) {
        const rect = card.getBoundingClientRect();
        const oneColumn = getComputedStyle(grid).gridTemplateColumns.split(" ").length === 1;
        next = { source: current.source, target: card.dataset.widgetId!, after: oneColumn
          ? current.y > rect.top + rect.height / 2 : current.x > rect.left + rect.width / 2 };
      }
      if (next?.target !== dropRef.current?.target || next?.after !== dropRef.current?.after) {
        dropRef.current = next;
        setDrop(next);
      }
    };
    const tick = () => {
      const current = session.current;
      if (!current?.active) return;
      // Scroll the page at the viewport edge; normal touch scroll remains available outside the handle.
      const edge = 56;
      const dy = current.y < edge ? -10 : current.y > window.innerHeight - edge ? 10 : 0;
      if (dy) window.scrollBy(0, dy);
      hitTest();
      frame = requestAnimationFrame(tick);
    };
    const move = (event: PointerEvent) => {
      const current = session.current;
      if (!current || current.pointerId !== event.pointerId) return;
      current.x = event.clientX; current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        setSource(current.source);
        setAnnouncement("Træk til en widget. Slip før eller efter den. Escape annullerer.");
        frame = requestAnimationFrame(tick);
      }
      if (current.active) { event.preventDefault(); hitTest(); }
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId === session.current?.pointerId) { hitTest(); finish(true); }
    };
    const cancel = () => finish(false);
    const cancelPointer = (event: PointerEvent) => {
      if (event.pointerId === session.current?.pointerId) cancel();
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") cancel(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancelPointer);
    window.addEventListener("lostpointercapture", cancelPointer);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", cancel);
    return () => {
      cancel();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancelPointer);
      window.removeEventListener("lostpointercapture", cancelPointer);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [enabled, scope]);

  function handleProps(id: string) {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!enabled || !event.isPrimary || event.button !== 0 || session.current) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        session.current = { source: id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
          startX: event.clientX, startY: event.clientY, active: false, handle: event.currentTarget };
      },
    };
  }
  function cardClass(id: string) {
    return [source === id ? "is-dragging" : "", drop?.target === id ? `widget-drop--${drop.after ? "after" : "before"}` : ""].filter(Boolean).join(" ");
  }
  return { gridRef, handleProps, cardClass, announcement };
}
