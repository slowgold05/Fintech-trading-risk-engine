import { createContext, useContext } from "react";

export type Look = "terrain" | "dial";
export const LOOK_KEY = "sentinel.look";

export function readLook(): Look {
  try {
    return localStorage.getItem(LOOK_KEY) === "dial" ? "dial" : "terrain";
  } catch {
    return "terrain";
  }
}

export const LookContext = createContext<{ look: Look; setLook: (look: Look) => void }>({
  look: "terrain",
  setLook: () => {},
});

export function useLook() {
  return useContext(LookContext);
}

export function reducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
