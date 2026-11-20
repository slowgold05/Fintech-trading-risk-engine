import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { LOOK_KEY, LookContext, readLook, type Look } from "./preferences";

export function LookProvider({ children }: { children: ReactNode }) {
  const [look, setSelectedLook] = useState(readLook);

  function setLook(next: Look) {
    try {
      localStorage.setItem(LOOK_KEY, next);
    } catch {
      // The switch still works for the current visit.
    }
    setSelectedLook(next);
  }

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.look = look;
    return () => { delete root.dataset.look; };
  }, [look]);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if (event.key === null || event.key === LOOK_KEY) setSelectedLook(readLook());
    }
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  return <LookContext.Provider value={{ look, setLook }}>{children}</LookContext.Provider>;
}
