import { createContext, useContext, useLayoutEffect } from "react";

type Paint = (date: string | null) => void;
export function createSessionCursor() {
  let date: string | null = null;
  const listeners = new Set<Paint>();
  return {
    set(next: string | null) {
      if (next === date) return;
      date = next;
      for (const paint of listeners) paint(date);
    },
    subscribe(paint: Paint) {
      listeners.add(paint);
      paint(date);
      return () => {
        listeners.delete(paint);
      };
    },
  };
}

export const CursorContext = createContext<ReturnType<typeof createSessionCursor> | null>(null);

// Pointer coordinates don't belong in the React tree. Each mounted instrument
// binds its real observations to the shared date after data or layout changes.
export function useSessionPaint(paint: Paint) {
  const cursor = useContext(CursorContext);
  useLayoutEffect(() => cursor?.subscribe(paint), [cursor, paint]);
  return cursor;
}
