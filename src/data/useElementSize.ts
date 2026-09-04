import { useCallback, useLayoutEffect, useRef, useState } from "react";

export type ElementSize = { width: number; height: number };

/**
 * Measure the rendered size of an element and re-render when it changes.
 *
 * Charts use this so SVG coordinates are real CSS pixels: the stylesheet
 * decides how tall a chart is, the browser reports the resulting box, and the
 * chart draws into exactly that box. Text stays a constant pixel size instead
 * of scaling with a viewBox.
 */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): { ref: (node: T | null) => void } & ElementSize {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const nodeRef = useRef<T | null>(null);
  const [node, setNode] = useState<T | null>(null);

  useLayoutEffect(() => {
    if (!node) return;
    const apply = (width: number, height: number) => {
      const next = { width: Math.round(width), height: Math.round(height) };
      setSize((current) => current.width === next.width && current.height === next.height ? current : next);
    };
    const rect = node.getBoundingClientRect();
    apply(rect.width, rect.height);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      apply(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  // Stable callback ref: React would otherwise detach/re-attach it on every render.
  const ref = useCallback((next: T | null) => {
    if (nodeRef.current === next) return;
    nodeRef.current = next;
    setNode(next);
  }, []);

  return { ref, width: size.width, height: size.height };
}
