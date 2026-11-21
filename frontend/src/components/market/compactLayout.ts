import { useSyncExternalStore } from "react";

export const compactWidth = 860;
export const phoneWidth = 680;

function subscribe(resized: () => void) {
  window.addEventListener("resize", resized);
  return () => window.removeEventListener("resize", resized);
}

// Match the CSS layout viewport, including after rotation or window resizing.
export function useMaxWidth(maxWidth: number) {
  return useSyncExternalStore(subscribe, () => window.innerWidth <= maxWidth);
}
