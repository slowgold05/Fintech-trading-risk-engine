import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SurveillanceCaseResponse, SurveillanceRuleResponse } from "../types/schemas";
import { Compliance } from "./Compliance";

const surveillance = vi.hoisted(() => ({
  fetchSurveillanceRules: vi.fn(() => Promise.resolve({ rules: [] as SurveillanceRuleResponse[] })),
  fetchSurveillanceCases: vi.fn(() => Promise.resolve({ cases: [] as SurveillanceCaseResponse[] })),
}));

vi.mock("../api/compliance", () => ({
  fetchTradingHalt: () => Promise.resolve({ halted: false, operator_halted: false, emergency_override: false,
    actor_user_id: null, reason: "Initial trading state", changed_at: "2026-10-30T00:00:00Z" }),
  fetchTradingHaltEvents: () => Promise.resolve({ events: [] }),
  setTradingHalt: vi.fn(),
  fetchControlStatuses: () => Promise.resolve({ controls: [
    { id: "SM-PT-02", title: "Price band", owner: "Operations", frequency: "daily",
      status: "no_sample", run_at: "2026-10-28T20:00:00Z", checked: 0, sha256: "hash" },
  ] }),
  fetchRoleChanges: () => Promise.resolve({ changes: [] }),
  fetchRoleRequests: () => Promise.resolve({ requests: [] }),
  fetchAccessReview: () => Promise.resolve({ period: "2026-Q4", accounts: [] }),
  requestRoleChange: vi.fn(),
  approveRoleChange: vi.fn(),
  submitAccessReview: vi.fn(),
  fetchSurveillanceRules: surveillance.fetchSurveillanceRules,
  fetchSurveillanceCases: surveillance.fetchSurveillanceCases,
  requestSurveillanceActivation: vi.fn(),
  approveSurveillanceActivation: vi.fn(),
  fetchAmlRules: () => Promise.resolve({ rules: [] }),
  fetchAmlCases: () => Promise.resolve({ cases: [] }),
  requestAmlActivation: vi.fn(),
  approveAmlActivation: vi.fn(),
  fetchIncidents: () => Promise.resolve({ incidents: [] }),
  openIncident: vi.fn(),
  fetchKris: () => Promise.resolve({ kris: [] }),
  fetchIntents: () => Promise.resolve({ intents: [] }),
  approveIntent: vi.fn(),
  fetchFindings: () => Promise.resolve({ findings: [] }),
  fetchRiskBrief: () => Promise.resolve({ brief: null }),
  downloadEvidenceBundle: vi.fn(),
  fetchRegisteredRisks: () => Promise.resolve({ method: "test method", risks: [
    { id: "R-04", title: "Erroneous orders", owner: "Operations", inherent_rating: "high",
      residual_rating: "high", controls: ["SM-PT-02"], control_health: "unverified" },
  ] }),
}));
vi.mock("../api/auth", () => ({ fetchMe: () => Promise.resolve({ id: 1, email: "auditor@example.com", role: "auditor" }) }));

afterEach(() => {
  cleanup();
});

describe("Compliance", () => {
  it("labels an empty control sample without counting it as passing", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    expect(await screen.findByText("Price band")).toBeInTheDocument();
    expect(screen.getByText("no sample")).toBeInTheDocument();
    expect(screen.getByText("No role changes recorded.")).toBeInTheDocument();
    expect(await screen.findByText("Erroneous orders")).toBeInTheDocument();
    expect(screen.getByText("unverified")).toBeInTheDocument();
    expect(await screen.findByText("No role changes requested.")).toBeInTheDocument();
    expect(screen.getByText("No accounts to review.")).toBeInTheDocument();
    expect(screen.getByText("No surveillance cases.")).toBeInTheDocument();
    expect(await screen.findByText("No AML cases.")).toBeInTheDocument();
    expect(screen.getByText("No incidents.")).toBeInTheDocument();
    expect(screen.getByText("No KRI readings.")).toBeInTheDocument();
    expect(screen.getByText("No trade intents.")).toBeInTheDocument();
    expect(screen.getByText("No findings.")).toBeInTheDocument();
    expect(screen.getByText("No risk brief.")).toBeInTheDocument();
    expect(screen.getByText(/docs\/vendors.md/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve intent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request AML activation" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open incident" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download evidence bundle" })).toBeInTheDocument();
    client.clear();
  });

  it("shows an active rule and an open case", async () => {
    surveillance.fetchSurveillanceRules.mockResolvedValueOnce({ rules: [
      { id: "SM-SV-01", title: "Wash trading", version: 1, model_type: "deterministic_threshold", sla_hours: 24,
        activation_status: "active", request_id: null, requested_by_user_id: null },
    ] });
    surveillance.fetchSurveillanceCases.mockResolvedValueOnce({ cases: [
      { id: 7, rule_id: "SM-SV-01", rule_version: 1, subject_user_id: 4, symbol: "NVDA", status: "open",
        disposition: null, summary: "Offsetting fills", opened_at: "2026-11-03T15:00:00", due_at: "2026-11-04T15:00:00", closed_at: null },
    ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    expect(await screen.findByText("Wash trading")).toBeInTheDocument();
    expect(screen.getByText("NVDA")).toBeInTheDocument();
    expect(screen.getByText("Offsetting fills")).toBeInTheDocument();
    expect(screen.queryByText("No surveillance cases.")).not.toBeInTheDocument();
    client.clear();
  });
});
