import { type RefObject, useLayoutEffect, useRef } from "react";
import { prefersReducedMotion } from "../../ui/lib";

/** Remember row positions relative to the list, so a cache refresh can reorder it even after scrolling. */
export function useRankMotion(ref: RefObject<HTMLElement | null>, order: string) {
  const previous = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    const positions = new Map<string, number>();
    const moves = [];
    for (const row of list.querySelectorAll<HTMLElement>("[data-rank]")) {
      const key = row.dataset.rank!;
      positions.set(key, row.offsetTop);
      const top = previous.current.get(key);
      if (top != null && top !== row.offsetTop) moves.push({ row, dy: top - row.offsetTop });
    }
    previous.current = positions;
    if (prefersReducedMotion() || !moves.length) return;
    const box = list.getBoundingClientRect();
    if (box.bottom < 0 || box.top > window.innerHeight) return;
    for (const { row, dy } of moves) {
      row.animate?.([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
        { duration: 340, easing: "cubic-bezier(.23,1,.32,1)" });
    }
  }, [order, ref]);
}
