import { apiClient } from "../../../api/client";
import type { Page, Provenance } from "../../api";

export type InboxFilter = "all" | "unread";
export type InboxEvent = {
  id: string; kind: "fill" | "alert_triggered" | "demo_started" | "demo_reset";
  occurred_at: string; read_at: string | null; symbol: string | null; order_id: number | null;
  alert_id: number | null; side: "buy" | "sell" | null; quantity: string | null;
  price: string | null; target: string | null; session_date: string | null; source: Provenance | null;
};
export type InboxPage = Page<InboxEvent> & {
  unread_count: number; history_days: number; sources: { fills: true; demo: boolean; alerts: boolean }; read_at: string;
};
export const pageSize = 5;
export async function readInbox(filter: InboxFilter, cursor: string | null, signal: AbortSignal) {
  return (await apiClient.get<InboxPage>("/night/inbox", { params: { filter, cursor, limit: pageSize }, signal })).data;
}
export async function markInboxRead(id: string) {
  return (await apiClient.put<{ id: string; read_at: string }>('/night/inbox/' + encodeURIComponent(id) + '/read')).data;
}
