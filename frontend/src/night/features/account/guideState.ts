import { useSyncExternalStore } from "react";

export type GuideState = "new" | "active" | "skipped" | "done";
const memory = new Map<number, GuideState>();
const notice = "sentinel-guide-change";
function key(owner: number) { return "sentinel.guide." + owner; }

function read(owner: number): GuideState {
  const fallback = memory.get(owner);
  if (fallback) return fallback;
  try {
    const value = localStorage.getItem(key(owner));
    if (value === "active" || value === "skipped" || value === "done" || value === "new") return value;
  } catch { /* Settings still work in this session. */ }
  return "new";
}

export function setGuide(owner: number, state: GuideState) {
  try { localStorage.setItem(key(owner), state); memory.delete(owner); } catch { memory.set(owner, state); }
  window.dispatchEvent(new Event(notice));
}

function subscribe(update: () => void) {
  window.addEventListener(notice, update);
  window.addEventListener("storage", update);
  return () => { window.removeEventListener(notice, update); window.removeEventListener("storage", update); };
}

export function useGuide(owner: number) {
  return useSyncExternalStore(subscribe, () => read(owner));
}
