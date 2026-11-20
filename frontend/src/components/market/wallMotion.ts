import { reducedMotion } from "../../marketLooks/preferences";
import { useEffect, useLayoutEffect, useRef } from "react";

const duration = 2380;
let started: number | undefined;
let finished = false;

export function powerTime(now: number) {
  return finished || started === undefined ? duration : Math.min(duration, Math.max(0, now - started));
}

const handheldAnimations = new Set<Animation>();

export function registerHandsetSurface(node: Element | null, delay: number) {
  if (!node?.animate || finished || started === undefined) return;
  const animation = node.animate(
    [
      { opacity: 0, transform: "translateY(8px)" },
      { opacity: 1, transform: "translateY(0)" },
    ],
    {
      duration: 320,
      delay: Math.max(0, delay - (performance.now() - started)),
      easing: "cubic-bezier(.23,1,.32,1)",
      fill: "backwards",
    },
  );
  handheldAnimations.add(animation);
  animation.onfinish = animation.oncancel = () => {
    handheldAnimations.delete(animation);
  };
}

export function usePowerOn() {
  const wall = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = wall.current;
    if (!node || finished) return;
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) {
      finished = true;
      return;
    }
    started ??= performance.now();
    const handset = window.innerWidth <= 680;
    const input = new AbortController();
    const finish = () => {
      finished = true;
      if (!handset) delete node.dataset.power;
      for (const animation of handheldAnimations) animation.cancel();
      handheldAnimations.clear();
      input.abort();
      clearTimeout(timer);
    };
    if (handset) {
      registerHandsetSurface(node.querySelector(".market-mast"), 0);
      registerHandsetSurface(node.querySelector(".index-strip"), 65);
    } else node.dataset.power = "on";
    const timer = window.setTimeout(finish, (handset ? 900 : duration) - powerTime(performance.now()));
    for (const event of [
      "pointermove",
      "pointerdown",
      "touchstart",
      "wheel",
      "keydown",
      "input",
      "click",
      "scroll",
    ])
      window.addEventListener(event, finish, { capture: true, passive: true, signal: input.signal });
    motion.addEventListener("change", finish, { signal: input.signal });
    return () => {
      input.abort();
      clearTimeout(timer);
      if (!handset) delete node.dataset.power;
      for (const animation of handheldAnimations) animation.cancel();
      handheldAnimations.clear();
      queueMicrotask(() => {
        if (!node.isConnected) finished = true;
      });
    };
  }, []);
  return wall;
}

export function useArrival<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !window.IntersectionObserver || reducedMotion())
      return;
    let timer = 0;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return;
      const opening =
        node.closest("[data-power]") || (window.innerWidth <= 680 && started !== undefined && !finished);
      if (!opening) {
        node.dataset.arrived = "";
        timer = window.setTimeout(() => delete node.dataset.arrived, 1100);
      }
      observer.disconnect();
    });
    observer.observe(node);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, []);
  return ref;
}

// Store positions in table coordinates so scrolling never looks like a reorder.
export function useRowMotion(order: string) {
  const ref = useRef<HTMLTableSectionElement>(null);
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const body = ref.current;
    if (!body) return;
    function measure() {
      const rows = Array.from(body!.rows, (row) => ({ row, id: row.dataset.symbol!, y: row.offsetTop }));
      const last = previous.current;
      previous.current = new Map(rows.map((r) => [r.id, r.y]));
      if (!last.size || reducedMotion()) return;
      for (const { row, id, y } of rows) {
        const old = last.get(id);
        row.getAnimations?.().forEach((a) => a.cancel());
        row.animate?.(
          [
            { transform: `translateY(${old == null || old === y ? 5 : old - y}px)`, opacity: old == null || old === y ? 0.35 : 1 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 310, easing: "cubic-bezier(.23,1,.32,1)" },
        );
      }
    }
    // Read the new row positions after the browser has laid out the table.
    if (!window.ResizeObserver) return measure();
    const observer = new ResizeObserver(() => {
      measure();
      observer.disconnect();
    });
    observer.observe(body);
    return () => observer.disconnect();
  }, [order]);
  return ref;
}
