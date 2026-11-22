import { apiClient } from "../../../api/client";
import type { Decimal, Provenance, SessionDate, Utc } from "../../api";

export type AlertRule = { symbol: string; direction: "at_or_above" | "at_or_below"; target: Decimal };
export type CloseAlert = AlertRule & {
  id: number; status: "armed" | "triggered"; last_date: SessionDate | null;
  last_close: Decimal | null; triggered_at: Utc | null; source: Provenance | null;
};
type Collection = { items: CloseAlert[] };

export async function fetchAlerts() {
  return (await apiClient.get<Collection>("/night/alerts")).data.items;
}
export async function createAlert(rule: AlertRule) {
  return (await apiClient.post<CloseAlert>("/night/alerts", rule)).data;
}
export async function evaluateAlerts() {
  return (await apiClient.post<Collection>("/night/alerts/evaluate")).data.items;
}
export async function deleteAlert(id: number) {
  await apiClient.delete(`/night/alerts/${id}`);
}
