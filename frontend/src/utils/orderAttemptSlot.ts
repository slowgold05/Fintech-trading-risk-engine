export const ORDER_ATTEMPT_SLOT = "orderTicket.pendingAttempt.v1";

export function clearPersistedOrderAttempt(): void {
  try {
    sessionStorage.removeItem(ORDER_ATTEMPT_SLOT);
  } catch {
    // Storage may be blocked for this session.
  }
}
