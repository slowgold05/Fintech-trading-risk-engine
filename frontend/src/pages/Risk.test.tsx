import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RiskAssessmentResponse, RiskResponse } from "../types/schemas";
import { Risk } from "./Risk";

const fetchRisk = vi.hoisted(() => vi.fn());
vi.mock("../api/risk", () => ({ fetchRisk }));

const clients: QueryClient[] = [];
function open(seed?: RiskResponse) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
  });
  clients.push(client);
  if (seed) client.setQueryData(["risk"], seed);
  render(<QueryClientProvider client={client}><Risk /></QueryClientProvider>);
  return client;
}

function assessment(score: number, id = 1): RiskAssessmentResponse {
  return {
    assessment_id: id, trade_id: id, risk_score: score, created_at: "2026-11-06T12:00:00Z",
    trade: {
      symbol: `TRADE${id}`, asset_type: "stock", side: "buy", quantity: 2,
      price_at_execution: 10, executed_at: "2026-11-06T12:00:00Z",
    },
    alerts: [],
  };
}

describe("historical trade risk", () => {
  beforeEach(() => { fetchRisk.mockReset(); });
  afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); });

  it("keeps pending data distinct from a successful empty assessment list", () => {
    fetchRisk.mockReturnValue(new Promise(() => {}));
    open();
    expect(screen.getByRole("heading", { name: "Latest Trade Risk Score" })).toBeInTheDocument();
    expect(screen.queryByText("No trade assessments yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 assessment alerts")).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
  });

  it("recovers a failed read through Retry without claiming the failure is empty or Low", async () => {
    fetchRisk.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ assessments: [] });
    open();
    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.queryByText("No trade assessments yet.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 assessment alerts")).not.toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
    fireEvent.click(retry);
    expect(await screen.findByText("No trade assessments yet.")).toBeInTheDocument();
    expect(screen.getByText("No assessment alerts.")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
  });

  it("preserves an actual zero trade score as Low", async () => {
    fetchRisk.mockResolvedValue({ assessments: [assessment(0)] });
    open();
    expect(await screen.findByRole("img", { name: "Risk score 0 of 100, Low" })).toBeInTheDocument();
    expect(screen.queryByText("Latest trade score unavailable.")).not.toBeInTheDocument();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY])("keeps an unusable latest score unavailable while retaining older trade history (%s)", async (score) => {
    const missingTrade = assessment(score);
    missingTrade.trade = null;
    fetchRisk.mockResolvedValue({ assessments: [missingTrade, assessment(70, 2)] });
    open();
    expect(await screen.findByText("Latest trade score unavailable.")).toBeInTheDocument();
    expect(screen.getByText("TRADE2")).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Low")).not.toBeInTheDocument();
    const feed = screen.getByRole("heading", { name: "Assessment Feed" }).closest("section")!;
    const rows = within(feed).getAllByRole("row");
    expect(within(rows[1]).getAllByText("Unavailable")).toHaveLength(2);
    expect(within(rows[1]).queryByText("$0.00")).not.toBeInTheDocument();
  });

  it("labels gross buy and sell notionals as historical assessed trades", async () => {
    const sale = assessment(30, 2);
    sale.trade = { ...sale.trade!, side: "sell", quantity: 1, price_at_execution: 15 };
    fetchRisk.mockResolvedValue({ assessments: [assessment(0), sale] });
    open();
    const section = (await screen.findByRole("heading", { name: "Assessed Trade Notional" })).closest("section")!;
    expect(await within(section).findByText("$35")).toBeInTheDocument();
    expect(within(section).getByText(/Includes buys and sells/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Exposure Breakdown" })).not.toBeInTheDocument();
  });

  it("hides cached scores, alerts, notionals and feed after a failed refresh", async () => {
    const recorded = assessment(90);
    recorded.alerts = [{ rule_code: "HISTORICAL_RULE", severity: "high", reason: "fixture", created_at: "2026-11-06T12:00:00Z" }];
    const client = open({ assessments: [recorded] });
    expect(screen.getByRole("img", { name: "Risk score 90 of 100, High" })).toBeInTheDocument();
    expect(screen.getByText("HISTORICAL_RULE")).toBeInTheDocument();
    fetchRisk.mockRejectedValue(new Error("offline"));
    await act(async () => { await client.refetchQueries({ queryKey: ["risk"] }, { throwOnError: false }); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument());
    expect(screen.queryByRole("img", { name: /Risk score/ })).not.toBeInTheDocument();
    expect(screen.queryByText("HISTORICAL_RULE")).not.toBeInTheDocument();
    expect(screen.queryByText("TRADE1")).not.toBeInTheDocument();
    expect(screen.queryByText("$20.00")).not.toBeInTheDocument();
    expect(screen.queryByText("No trade assessments yet.")).not.toBeInTheDocument();
  });
});
