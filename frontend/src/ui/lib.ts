import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type RefObject } from "react";

/** Inline style that may carry CSS custom properties. */
export type Vars = CSSProperties & Record<`--${string}`, string | number>;

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export type Direction = "up" | "down" | "flat";

export function directionOf(value: number | null | undefined): Direction {
  if (value == null || !Number.isFinite(value) || value === 0) {
    return "flat";
  }
  return value > 0 ? "up" : "down";
}

/* ── Reduced motion ─────────────────────────────────────────────────────────── */

const REDUCED = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && (document.documentElement.dataset.motion === "reduced" || window.matchMedia(REDUCED).matches);
}

function subscribeReduced(notify: () => void) {
  const query = typeof window.matchMedia === "function" ? window.matchMedia(REDUCED) : null;
  query?.addEventListener?.("change", notify);
  return () => query?.removeEventListener?.("change", notify);
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeReduced, prefersReducedMotion, () => false);
}

/* ── Visibility ─────────────────────────────────────────────────────────────── */

const hasObserver = () => typeof IntersectionObserver !== "undefined";

/** True once the element has entered the viewport. Without an observer it is true at once. */
export function useInView<T extends Element>(margin = "0px 0px -6% 0px"): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(() => !hasObserver());

  useEffect(() => {
    const node = ref.current;
    if (!node || !hasObserver()) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [margin]);

  return [ref, seen];
}

/**
 * Arms a drawing: once its data is ready and it is on screen, the container gets
 * `data-on="true"` after intersection is measured, so CSS transitions run from the resting state. `data-live` follows visibility, for motion that must pause off screen.
 * The attributes are written straight to the node: no render, no state.
 */
export function useDraw<T extends Element>(ready: boolean, settleMs = 0): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node || !ready) {
      return;
    }
    let timer: number | undefined;
    const arm = () => {
      if (node.getAttribute("data-on") === "true") {
        return;
      }
      node.setAttribute("data-on", "true");
      if (settleMs > 0) {
        timer = window.setTimeout(() => node.setAttribute("data-settled", "true"), settleMs);
      } else {
        node.setAttribute("data-settled", "true");
      }
    };
    if (!hasObserver()) {
      arm();
      node.setAttribute("data-live", "true");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((entry) => entry.isIntersecting);
        node.setAttribute("data-live", visible ? "true" : "false");
        if (visible) {
          arm();
        }
      },
      { threshold: 0.12 },
    );
    observer.observe(node);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [ready, settleMs]);

  return ref;
}

/* ── Cross-panel focus: one sector or one symbol re-lights every panel that shows it ─ */

const SECTOR_ALIASES: Record<string, string> = {
  "consumer disc.": "consumer discretionary",
  "consumer disc": "consumer discretionary",
  "health care": "healthcare",
  "communication services": "communication",
  "information technology": "technology",
};

export function sectorKey(name: string | null | undefined) {
  const base = (name ?? "").trim().toLowerCase();
  return (SECTOR_ALIASES[base] ?? base).replace(/[^a-z0-9]+/g, "-");
}

type WallFocus = { sector: string | null; symbol: string | null };

let focus: WallFocus = { sector: null, symbol: null };
let pinnedSector: string | null = null;
const sectorListeners = new Set<() => void>();

export function pinSector(name: string | null, symbol?: string) {
  pinnedSector = name ? sectorKey(name) : null;
  setFocus(symbol ? {sector:pinnedSector, symbol} : null);
  sectorListeners.forEach(fn => fn());
}
export function usePinnedSector() {
  return useSyncExternalStore(fn => { sectorListeners.add(fn); return () => { sectorListeners.delete(fn); }; }, () => pinnedSector, () => null);
}

let lit = new Set<Element>();
let pointerFrame = 0;
let pointerTarget: EventTarget | null = null;
const focusListeners = new Set<() => void>();

/** Touch only matching marks. Replacing a stylesheet on each tick invalidates the whole wall. */
export function setFocus(next: Partial<WallFocus> | null) {
  cancelAnimationFrame(pointerFrame);
  pointerFrame = 0;
  pointerTarget = null;
  const sector = next ? sectorKey(next.sector) || null : pinnedSector;
  const symbol = next?.symbol ?? null;
  if (sector === focus.sector && symbol === focus.symbol) return;
  focus = { sector, symbol };
  const wall = document.querySelector(".wall");
  const selectors = [];
  if (sector) selectors.push(`.x-seclit[data-sector="${sector}"]`);
  if (sector && !symbol) selectors.push(`.x-sec[data-sector="${sector}"]`);
  if (symbol) selectors.push(`.x-sym[data-sym="${CSS.escape(symbol)}"]`);
  const nextLit = new Set(wall && selectors.length ? wall.querySelectorAll(selectors.join(",")) : []);
  for (const node of lit) {
    if (!nextLit.has(node)) node.removeAttribute("data-lit");
  }
  for (const node of nextLit) {
    if (!lit.has(node)) node.setAttribute("data-lit", "");
  }
  lit = nextLit;
  focusListeners.forEach((listener) => listener());
}

export function useWallFocus() {
  return useSyncExternalStore(subscribeFocus, () => focus, () => focus);
}

function subscribeFocus(listener: () => void) {
  focusListeners.add(listener);
  return () => {
    focusListeners.delete(listener);
  };
}

/** A readout below the fold catches up on entry without re-rendering during every dial inspection. */
export function useVisibleFocusSymbol(ref: RefObject<HTMLElement | null>) {
  const [symbol, setSymbol] = useState(focus.symbol);
  useEffect(() => {
    let visible = !hasObserver() || !ref.current;
    const read = () => { if (visible) setSymbol(focus.symbol); };
    const observer = ref.current && hasObserver() ? new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      read();
    }) : null;
    if (ref.current) observer?.observe(ref.current);
    read();
    const unsubscribe = subscribeFocus(read);
    return () => { observer?.disconnect(); unsubscribe(); };
  }, [ref]);
  return symbol;
}

function focusFromTarget(target: EventTarget | null) {
  const node = target instanceof Element ? target.closest<HTMLElement>("[data-sym], [data-sector]") : null;
  if (!node) {
    setFocus(null);
    return;
  }
  setFocus({
    symbol: node.dataset.sym ?? null,
    sector: node.dataset.sector ?? node.closest<HTMLElement>("[data-sector]")?.dataset.sector ?? null,
  });
}

// Mouse transitions between adjacent hit shapes can deliver leave and over in the same
// paint. Resolve the last target once, before that paint, without flashing the default dial.
function queuePointerFocus(target: EventTarget | null) {
  pointerTarget = target;
  if (pointerFrame) return;
  pointerFrame = requestAnimationFrame(() => {
    pointerFrame = 0;
    focusFromTarget(pointerTarget);
  });
}

/** Spread on a container: pointer and keyboard focus inside it drive the shared focus. */
export const focusHandlers = {
  onPointerOver: (event: { target: EventTarget | null }) => queuePointerFocus(event.target),
  onPointerLeave: (event: { pointerType?: string }) => { if (event.pointerType !== "touch") queuePointerFocus(null); },
  onFocus: (event: { target: EventTarget | null }) => focusFromTarget(event.target),
  onBlur: () => setFocus(null),
};

/* ── Swaps that do not blink ────────────────────────────────────────────────── */

const EASE_DRAWER = "cubic-bezier(0.32, 0.72, 0, 1)";

export type FlipRects = Map<string, DOMRect>;

export function captureRects(container: HTMLElement | null, selector: string): FlipRects {
  const rects: FlipRects = new Map();
  container?.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    const key = node.dataset.flip;
    const rect = node.getBoundingClientRect();
    if (key && rect.width && rect.height) {
      rects.set(key, rect);
    }
  });
  return rects;
}

/** FLIP: every node glides from where it was to where the new layout puts it. */
export function playFlip(container: HTMLElement | null, selector: string, before: FlipRects) {
  if (!container || before.size === 0 || prefersReducedMotion()) {
    return;
  }
  container.querySelectorAll<HTMLElement>(selector).forEach((node) => {
    const from = node.dataset.flip ? before.get(node.dataset.flip) : undefined;
    if (!from || typeof node.animate !== "function") {
      return;
    }
    const to = node.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) {
      return;
    }
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01) {
      return;
    }
    node.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: 440, easing: EASE_DRAWER },
    );
  });
}

const compactQuery = "(max-width: 959px)";
function subscribeCompact(notify: () => void) {
  const media = window.matchMedia?.(compactQuery);
  media?.addEventListener("change", notify);
  return () => media?.removeEventListener("change", notify);
}
export function useCompactWall() {
  return useSyncExternalStore(subscribeCompact, () => window.matchMedia?.(compactQuery).matches ?? false, () => false);
}
