import { apiClient } from "./client";
import type { AccessReviewAccountResponse, ControlStatusResponse, RegisteredRiskResponse, RoleChangeResponse, RoleRequestResponse, TradingHaltResponse, TradingHaltEventResponse } from "../types/schemas";

export async function fetchTradingHalt(): Promise<TradingHaltResponse> {
  const response = await apiClient.get<TradingHaltResponse>("/compliance/trading-halt");
  return response.data;
}

export async function setTradingHalt(payload: { halted: boolean; reason: string }): Promise<TradingHaltResponse> {
  const response = await apiClient.put<TradingHaltResponse>("/compliance/trading-halt", payload);
  return response.data;
}

export async function fetchTradingHaltEvents(): Promise<{ events: TradingHaltEventResponse[] }> {
  const response = await apiClient.get<{ events: TradingHaltEventResponse[] }>("/compliance/trading-halt/events");
  return response.data;
}

export async function fetchControlStatuses(): Promise<{ controls: ControlStatusResponse[] }> {
  const response = await apiClient.get<{ controls: ControlStatusResponse[] }>("/compliance/controls");
  return response.data;
}

export async function fetchRoleChanges(): Promise<{ changes: RoleChangeResponse[] }> {
  const response = await apiClient.get<{ changes: RoleChangeResponse[] }>("/compliance/role-changes");
  return response.data;
}

export async function fetchRegisteredRisks(): Promise<{ method: string; risks: RegisteredRiskResponse[] }> {
  const response = await apiClient.get<{ method: string; risks: RegisteredRiskResponse[] }>("/compliance/risks");
  return response.data;
}

export async function fetchRoleRequests(): Promise<{ requests: RoleRequestResponse[] }> {
  const response = await apiClient.get<{ requests: RoleRequestResponse[] }>("/compliance/role-requests");
  return response.data;
}

export async function requestRoleChange(payload: { email: string; role: string; reason: string }): Promise<void> {
  await apiClient.post("/compliance/role-requests", payload);
}

export async function approveRoleChange(id: number): Promise<void> {
  await apiClient.post(`/compliance/role-requests/${id}/approve`);
}

export async function fetchAccessReview(): Promise<{ period: string; accounts: AccessReviewAccountResponse[] }> {
  const response = await apiClient.get<{ period: string; accounts: AccessReviewAccountResponse[] }>("/compliance/access-review");
  return response.data;
}

export async function submitAccessReview(payload: { user_id: number; decision: "retain" | "remove"; reason: string }): Promise<void> {
  await apiClient.post("/compliance/access-review", payload);
}
