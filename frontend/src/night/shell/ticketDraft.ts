export type TicketDraft = { symbol: string; quantity: string; side: "buy"|"sell"; orderType: "market"|"limit"; limitPrice: string };
const key = (owner: number) => "sentinel.ticket." + owner;
export function loadDraft(owner?: number): TicketDraft | null {
  if (!owner) return null;
  try {
    const draft = JSON.parse(sessionStorage.getItem(key(owner)) ?? "null");
    if (draft && ["symbol","quantity","limitPrice"].every(k => typeof draft[k] === "string") &&
      ["buy","sell"].includes(draft.side) && ["market","limit"].includes(draft.orderType)) return draft;
  } catch { /* Ignore inaccessible or malformed storage. */ }
  return null;
}
export function saveDraft(owner: number|undefined, draft: TicketDraft|null) {
  if (!owner) return;
  try { if (draft) sessionStorage.setItem(key(owner),JSON.stringify(draft)); else sessionStorage.removeItem(key(owner)); }
  catch { /* The active ticket remains editable in memory. */ }
}
