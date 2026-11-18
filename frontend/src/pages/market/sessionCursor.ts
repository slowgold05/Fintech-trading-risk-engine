/** Share only actual session dates between the wall's history views. */
export type SessionCursor = { date: string | null; source: "pulse" | "research" | "history" | "news" };

const listeners = new Set<(cursor: SessionCursor) => void>();
let cursor: SessionCursor = { date: null, source: "pulse" };

export function pointAtSession(date: string | null, source: SessionCursor["source"]) {
  if (!date && cursor.source !== source) return;
  if (date === cursor.date && source === cursor.source) return;
  cursor = { date, source };
  const matches = document.querySelectorAll<HTMLElement>(".wall .news-item[data-session]");
  for (const node of matches) node.toggleAttribute("data-reading", node.dataset.session === date);
  listeners.forEach(listener => listener(cursor));
}

export function onSession(listener: (cursor: SessionCursor) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
