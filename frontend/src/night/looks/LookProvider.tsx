import { useCallback, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { choices, LookContext, readPreferences, type Update } from "./preferences";

export function LookProvider({ children }: { children: ReactNode }) {
  const [prefs, set] = useState(readPreferences);
  const update: Update = useCallback((key, value) => {
    if (!(choices[key] as readonly string[]).includes(value)) return;
    try { localStorage.setItem("sentinel." + key, value); } catch { /* Use the in-memory preference. */ }
    set(previous => ({ ...previous, [key]: value }));
  }, []);
  useLayoutEffect(() => { Object.assign(document.documentElement.dataset, prefs); }, [prefs]);
  useLayoutEffect(() => {
    const sync = (event: StorageEvent) => {
      if (!event.key || event.key.startsWith("sentinel.")) set(readPreferences());
    };
    window.addEventListener("storage",sync);
    return () => window.removeEventListener("storage",sync);
  }, []);
  const context = useMemo(() => ({prefs,update}), [prefs,update]);
  return <LookContext.Provider value={context}>{children}</LookContext.Provider>;
}
