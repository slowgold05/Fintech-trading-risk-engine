import { useLayoutEffect, useRef } from "react";
import { prefersReducedMotion, pinSector } from "../../ui/lib";

let openedThisVisit = false;

/** One entrance per document visit, including client-side navigation back to the wall. */
export function useWallOpening() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const wall = ref.current;
    if (!wall) return;
    const controller = new AbortController();
    let release = 0;
    const finish = (input?: Event) => {
      controller.abort();
      openedThisVisit = true;
      wall.dataset.boot = "ready";
      if (input) {
        wall.dataset.interrupted = "";
        release = requestAnimationFrame(() => {
          release = requestAnimationFrame(() => { delete wall.dataset.interrupted; });
        });
      }
    };
    if (openedThisVisit || prefersReducedMotion()) {
      finish();
      return () => pinSector(null);
    }
    wall.dataset.boot = "opening";
    const events = ["pointermove", "pointerdown", "wheel", "keydown", "touchstart", "input", "scroll"];
    for (const event of events) window.addEventListener(event, finish, { capture: true, passive: true, signal: controller.signal });
    const timer = window.setTimeout(finish, window.matchMedia?.("(max-width: 959px)").matches ? 740 : 2380);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      cancelAnimationFrame(release);
      pinSector(null);
    };
  }, []);
  return ref;
}
