export const ORDER_ATTEMPT_SLOT = "orderTicket.pendingAttempt.v1";

export function clearPersistedOrderAttempt(owner?: number): void {
  try {
    if (owner !== undefined) {
      const current: unknown = JSON.parse(sessionStorage.getItem(ORDER_ATTEMPT_SLOT) ?? "null");
      if (current && typeof current === "object" && "owner" in current && current.owner !== owner) return;
    }
    sessionStorage.removeItem(ORDER_ATTEMPT_SLOT);
  } catch {
    // Storage may be blocked for this session.
  }
}
