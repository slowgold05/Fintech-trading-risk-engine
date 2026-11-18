import { reducedMotion } from "../night/looks/preferences";
import { flushSync } from "react-dom";

// Capture just the named plot or mosaic. Native snapshots keep an outgoing
// canvas intact while the new query resolves and a different view mounts.
let current: ViewTransition | undefined;
export function changeView(update: () => void, scope: "pulse" | "heatmap" | "research" = "heatmap") {
  if (!document.startViewTransition || reducedMotion()) {
    update();
    return;
  }
  current?.skipTransition();
  document.documentElement.dataset.deskTransition = scope;
  const transition = document.startViewTransition(() => flushSync(update));
  current = transition;
  void transition.finished.finally(() => {
    if (current === transition) {
      current = undefined;
      delete document.documentElement.dataset.deskTransition;
    }
  });
}
