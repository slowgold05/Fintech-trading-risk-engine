import { apiClient } from "./client";
import type { AccessReviewAccountResponse, ControlStatusResponse, OpsHealthResponse, RegisteredRiskResponse, RoleChangeResponse, RoleRequestResponse, SurveillanceCaseResponse, SurveillanceRuleResponse, TradingHaltResponse, TradingHaltEventResponse } from "../types/schemas";

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

export async function fetchSurveillanceRules(): Promise<{ rules: SurveillanceRuleResponse[] }> {
  const response = await apiClient.get<{ rules: SurveillanceRuleResponse[] }>("/compliance/surveillance/rules");
  return response.data;
}

export async function fetchSurveillanceCases(): Promise<{ cases: SurveillanceCaseResponse[] }> {
  const response = await apiClient.get<{ cases: SurveillanceCaseResponse[] }>("/compliance/surveillance/cases");
  return response.data;
}

export async function requestSurveillanceActivation(payload: { rule_id: string; reason: string }): Promise<void> {
  await apiClient.post(`/compliance/surveillance/rules/${payload.rule_id}/request`, { reason: payload.reason });
}

export async function approveSurveillanceActivation(id: number): Promise<void> {
  await apiClient.post(`/compliance/surveillance/activations/${id}/approve`);
}

export interface AmlRuleResponse {
  id: string;
  title: string;
  version: number;
  activation_status: string;
  request_id: number | null;
  requested_by_user_id: number | null;
}

export interface AmlCaseResponse {
  id: number;
  rule_id: string;
  summary: string;
  status: string;
  due_at: string;
}

export interface IncidentResponse {
  id: number;
  title: string;
  severity: string;
  status: string;
  summary: string;
  customer_notice_due_at: string;
  opened_by_user_id: number;
}

export interface KriResponse {
  id: string;
  title: string;
  value: number;
  threshold: number;
  status: string;
}

export async function fetchAmlRules(): Promise<{ rules: AmlRuleResponse[] }> {
  const response = await apiClient.get<{ rules: AmlRuleResponse[] }>("/compliance/aml/rules");
  return response.data;
}

export async function fetchAmlCases(): Promise<{ cases: AmlCaseResponse[] }> {
  const response = await apiClient.get<{ cases: AmlCaseResponse[] }>("/compliance/aml/cases");
  return response.data;
}

export async function requestAmlActivation(payload: { rule_id: string; reason: string }): Promise<void> {
  await apiClient.post(`/compliance/aml/rules/${payload.rule_id}/request`, { reason: payload.reason });
}

export async function approveAmlActivation(id: number): Promise<void> {
  await apiClient.post(`/compliance/aml/activations/${id}/approve`);
}

export async function fetchIncidents(): Promise<{ incidents: IncidentResponse[] }> {
  const response = await apiClient.get<{ incidents: IncidentResponse[] }>("/compliance/incidents");
  return response.data;
}

export async function openIncident(payload: { title: string; severity: string; summary: string }): Promise<void> {
  await apiClient.post("/compliance/incidents", payload);
}

export async function fetchKris(): Promise<{ kris: KriResponse[] }> {
  const response = await apiClient.get<{ kris: KriResponse[] }>("/compliance/kris");
  return response.data;
}

export interface TradeIntentResponse {
  id: number;
  symbol: string;
  side: string;
  status: string;
  rejection_reason: string | null;
  proposed_by: string;
  decided_by_user_id: number | null;
  decided_at: string | null;
}

export interface FindingResponse {
  id: number;
  control_id: string;
  severity: string;
  owner: string;
  summary: string;
  status: string;
  due_at: string;
}

export interface RiskBriefResponse {
  id: number;
  brief_date: string;
  body: string;
  figures: Record<string, string>;
}

export async function fetchIntents(): Promise<{ intents: TradeIntentResponse[] }> {
  const response = await apiClient.get<{ intents: TradeIntentResponse[] }>("/compliance/intents");
  return response.data;
}

export async function approveIntent(id: number): Promise<void> {
  await apiClient.post(`/compliance/intents/${id}/approve`);
}

export async function fetchFindings(): Promise<{ findings: FindingResponse[] }> {
  const response = await apiClient.get<{ findings: FindingResponse[] }>("/compliance/findings");
  return response.data;
}

export async function fetchRiskBrief(): Promise<{ brief: RiskBriefResponse | null }> {
  const response = await apiClient.get<{ brief: RiskBriefResponse | null }>("/compliance/risk-brief");
  return response.data;
}

export async function fetchOpsHealth(): Promise<OpsHealthResponse> {
  const response = await apiClient.get<OpsHealthResponse>("/compliance/ops-health");
  return response.data;
}

export async function downloadEvidenceBundle(): Promise<void> {
  const response = await apiClient.get<Blob>("/compliance/evidence-export", { responseType: "blob" });
  const url = URL.createObjectURL(response.data);
  const link = document.createElement("a");
  link.href = url;
  link.download = "evidence-bundle.zip";
  link.click();
  URL.revokeObjectURL(url);
}
