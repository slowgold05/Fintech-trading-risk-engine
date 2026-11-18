import { createContext, useContext } from "react";

export const choices = {
  look: ["terrain", "dial"],
  density: ["comfortable", "compact"],
  motion: ["system", "reduced"],
  historyProvider: ["auto", "yahoo", "massive"],
} as const;
export type Preferences = { [K in keyof typeof choices]: typeof choices[K][number] };
export type Look = Preferences["look"];
export type Update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
export function readPreferences(): Preferences {
  return Object.fromEntries(Object.entries(choices).map(([key, allowed]) => {
    let value: string | null = null;
    try { value = localStorage.getItem("sentinel." + key); } catch { /* Storage may be disabled. */ }
    return [key, (allowed as readonly string[]).includes(value ?? "") ? value : allowed[0]];
  })) as Preferences;
}
export const LookContext = createContext({ prefs: readPreferences(), update: (() => {}) as Update });
export function useLook() { return useContext(LookContext); }
export function reducedMotion() {
  return document.documentElement.dataset.motion === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
