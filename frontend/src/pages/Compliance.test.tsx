import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OpsHealthResponse, SurveillanceCaseResponse, SurveillanceRuleResponse } from "../types/schemas";
import { Compliance } from "./Compliance";

const surveillance = vi.hoisted(() => ({
  fetchSurveillanceRules: vi.fn(() => Promise.resolve({ rules: [] as SurveillanceRuleResponse[] })),
  fetchSurveillanceCases: vi.fn(() => Promise.resolve({ cases: [] as SurveillanceCaseResponse[] })),
}));

const opsHealthSample: OpsHealthResponse = {
  generated_at: "2026-11-13T02:00:00Z",
  market_data_freshness: { "live-ish": 0, delayed: 12, cached: 3, stale: 1 },
  job_queues: {
    research: { queued_count: 0, running_count: 0, oldest_queued_age_seconds: null, failed_last_24h_count: 0 },
    forecast: { queued_count: 1, running_count: 0, oldest_queued_age_seconds: 340, failed_last_24h_count: 2 },
  },
  ai_usage: {
    research_jobs_with_token_counts: 5,
    total_prompt_tokens: 1200,
    total_completion_tokens: 800,
    avg_duration_ms: 4300,
  },
  massive_ingestion: {
    symbols_covered: 503,
    latest_session_date: "2026-11-12",
    flagged_last_30d_count: 0,
  },
  kronos_worker: {
    weights_cache_dir_exists: false,
    weights_cache_bytes: 0,
  },
};

const opsHealthApi = vi.hoisted(() => ({
  fetchOpsHealth: vi.fn(() => Promise.resolve({
    generated_at: "2026-11-13T02:00:00Z",
    market_data_freshness: { "live-ish": 0, delayed: 12, cached: 3, stale: 1 },
    job_queues: {
      research: { queued_count: 0, running_count: 0, oldest_queued_age_seconds: null, failed_last_24h_count: 0 },
      forecast: { queued_count: 1, running_count: 0, oldest_queued_age_seconds: 340, failed_last_24h_count: 2 },
    },
    ai_usage: {
      research_jobs_with_token_counts: 5,
      total_prompt_tokens: 1200,
      total_completion_tokens: 800,
      avg_duration_ms: 4300,
    },
    massive_ingestion: {
      symbols_covered: 503,
      latest_session_date: "2026-11-12",
      flagged_last_30d_count: 0,
    },
    kronos_worker: {
      weights_cache_dir_exists: false,
      weights_cache_bytes: 0,
    },
  })),
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
  fetchOpsHealth: opsHealthApi.fetchOpsHealth,
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
    expect(screen.getByRole("heading", { name: "Operational health" })).toBeInTheDocument();
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

  function metricValue(scope: HTMLElement, label: string) {
    const tile = within(scope).getByText(label).parentElement;
    const value = tile?.querySelector(".font-mono");
    if (!value) throw new Error(`missing value for ${label}`);
    return value.textContent;
  }

  it("shows operational health counts", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    const heading = await screen.findByRole("heading", { name: "Operational health" });
    const card = heading.closest("section");
    if (!card) throw new Error("missing operational health card");
    await within(card).findByText("live-ish");
    expect(metricValue(card, "live-ish")).toBe("0");
    expect(metricValue(card, "delayed")).toBe("12");
    expect(metricValue(card, "cached")).toBe("3");
    expect(metricValue(card, "stale")).toBe("1");
    const forecast = within(card).getByText("Forecast").parentElement;
    if (!forecast) throw new Error("missing forecast queue");
    expect(metricValue(forecast, "Queued")).toBe("1");
    expect(metricValue(card, "Symbols covered")).toBe("503");
    expect(within(card).getByText("No cached weights")).toBeInTheDocument();
    expect(within(card).getByText("2026-11-12")).toBeInTheDocument();
    expect(within(card).getByText(/As of /)).toBeInTheDocument();
    expect(opsHealthSample.kronos_worker.weights_cache_dir_exists).toBe(false);
    client.clear();
  });

  it("shows a skeleton while operational health is loading", async () => {
    opsHealthApi.fetchOpsHealth.mockReturnValueOnce(new Promise(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    expect(await screen.findByText("Price band")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Operational health" }).closest("section");
    expect(card?.querySelector(".skeleton")).toBeTruthy();
    expect(screen.queryByText("No cached weights")).not.toBeInTheDocument();
    expect(screen.queryByText("Operational health could not be loaded.")).not.toBeInTheDocument();
    client.clear();
  });

  it("shows an error when operational health cannot be loaded", async () => {
    opsHealthApi.fetchOpsHealth.mockRejectedValueOnce(new Error("unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Compliance /></QueryClientProvider>);

    expect(await screen.findByText("Operational health could not be loaded.")).toBeInTheDocument();
    const card = screen.getByRole("heading", { name: "Operational health" }).closest("section");
    expect(card?.querySelector(".skeleton")).toBeNull();
    expect(screen.queryByText("No cached weights")).not.toBeInTheDocument();
    expect(screen.queryByText("503")).not.toBeInTheDocument();
    client.clear();
  });
});
