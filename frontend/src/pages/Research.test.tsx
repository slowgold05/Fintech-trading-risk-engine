import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ToastProvider } from "../context/ToastProvider";
import type { ResearchBrief, ResearchJob, ResearchReport } from "../types/schemas";
import { Research } from "./Research";

const api = vi.hoisted(() => ({
  createResearchJob: vi.fn(),
  listResearchJobs: vi.fn(),
  cancelResearchJob: vi.fn(),
  listResearchReports: vi.fn(),
  listResearchBriefs: vi.fn(),
}));

vi.mock("../api/research", () => ({
  createResearchJob: api.createResearchJob,
  listResearchJobs: api.listResearchJobs,
  cancelResearchJob: api.cancelResearchJob,
  listResearchReports: api.listResearchReports,
  listResearchBriefs: api.listResearchBriefs,
}));

const clients: QueryClient[] = [];

function renderPage(node: ReactNode = <Research />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ToastProvider>{node}</ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

function httpError(detail: string) {
  return new AxiosError("request failed", "400", undefined, undefined, {
    status: 400,
    data: { detail },
    statusText: "Bad Request",
    headers: {},
    config: {} as InternalAxiosRequestConfig,
  });
}

function job(overrides: Partial<ResearchJob> & Pick<ResearchJob, "id" | "symbol" | "status">): ResearchJob {
  return {
    created_at: "2026-11-08T15:00:00Z",
    updated_at: "2026-11-08T15:00:00Z",
    error_message: null,
    ...overrides,
  };
}

function report(
  overrides: Partial<ResearchReport> & Pick<ResearchReport, "id" | "job_id">,
): ResearchReport {
  return {
    symbol: "AAPL",
    created_at: "2026-11-08T16:00:00Z",
    sources: [{ type: "filing", status: "ok", detail: "10-K" }],
    bull_case: "Demand stays ahead of supply.",
    bear_case: "Margins compress if costs rise.",
    synthesis: "The base case is balanced growth.",
    risks: "A regulatory ruling could delay the launch.",
    model_version: "research-v1",
    prompt_version: "prompt-v1",
    backend_detail: null,
    ...overrides,
  };
}

function brief(overrides: Partial<ResearchBrief> & Pick<ResearchBrief, "id">): ResearchBrief {
  return {
    brief_date: "2026-11-08",
    created_at: "2026-11-08T18:00:00Z",
    entries: [],
    ...overrides,
  };
}

describe("Research desk", () => {
  beforeEach(() => {
    api.createResearchJob.mockReset();
    api.listResearchJobs.mockReset();
    api.cancelResearchJob.mockReset();
    api.listResearchReports.mockReset();
    api.listResearchBriefs.mockReset();
    api.listResearchJobs.mockResolvedValue({ jobs: [] });
    api.listResearchReports.mockResolvedValue({ reports: [] });
    api.listResearchBriefs.mockResolvedValue({ briefs: [] });
  });

  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
  });

  it("test_creates_a_job_and_it_appears_in_the_list", async () => {
    let listed: ResearchJob[] = [];
    api.listResearchJobs.mockImplementation(async () => ({ jobs: listed }));
    api.createResearchJob.mockImplementation(async (symbol: string) => {
      const created = job({ id: 11, symbol, status: "queued" });
      listed = [created];
      return created;
    });
    renderPage();

    expect(await screen.findByText("No research jobs yet.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: "AAPL" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue job" }));

    await waitFor(() => {
      expect(api.createResearchJob).toHaveBeenCalledWith("AAPL");
    });
    expect(await screen.findByText("queued")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Research job queued for AAPL.");
    expect(screen.getByLabelText("Symbol")).toHaveValue("");
  });

  it("test_shows_the_backend_s_own_error_message_on_create_failure", async () => {
    api.createResearchJob.mockRejectedValue(httpError("Unknown or inactive stock symbol"));
    renderPage();

    fireEvent.change(await screen.findByLabelText("Symbol"), { target: { value: "ZZZZ" } });
    fireEvent.click(screen.getByRole("button", { name: "Queue job" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown or inactive stock symbol");
    expect(api.createResearchJob).toHaveBeenCalledWith("ZZZZ");
  });

  it("test_cancel_button_only_shows_for_queued_jobs", async () => {
    api.listResearchJobs.mockResolvedValue({
      jobs: [
        job({ id: 4, symbol: "AAPL", status: "queued" }),
        job({ id: 5, symbol: "MSFT", status: "completed" }),
      ],
    });
    renderPage();

    const queuedRow = (await screen.findByText("AAPL")).closest("li") as HTMLElement;
    const completedRow = screen.getByText("MSFT").closest("li") as HTMLElement;
    expect(within(queuedRow).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(completedRow).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(completedRow).getByRole("button", { name: "View report" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
  });

  it("test_cancelling_a_job_calls_the_api_and_refreshes_the_list", async () => {
    const queued = job({ id: 4, symbol: "AAPL", status: "queued" });
    let listed = [queued];
    api.listResearchJobs.mockImplementation(async () => ({ jobs: listed }));
    api.cancelResearchJob.mockImplementation(async (jobId: number) => {
      const cancelled = { ...queued, id: jobId, status: "cancelled" as const };
      listed = [cancelled];
      return cancelled;
    });
    renderPage();

    const queuedRow = (await screen.findByText("AAPL")).closest("li") as HTMLElement;
    fireEvent.click(within(queuedRow).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(api.cancelResearchJob).toHaveBeenCalledWith(4);
    });
    expect(await screen.findByText("cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("test_view_report_shows_the_matching_report_by_job_id", async () => {
    api.listResearchJobs.mockResolvedValue({
      jobs: [job({ id: 7, symbol: "AAPL", status: "completed" })],
    });
    api.listResearchReports.mockResolvedValue({
      reports: [
        report({
          id: 70,
          job_id: 7,
          bull_case: "Demand stays ahead of supply.",
          bear_case: "Margins compress if costs rise.",
          synthesis: "The base case is balanced growth.",
          risks: "A regulatory ruling could delay the launch.",
        }),
      ],
    });
    renderPage();

    expect(api.listResearchReports).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View report" }));

    expect(await screen.findByText("Demand stays ahead of supply.")).toBeInTheDocument();
    expect(screen.getByText("Margins compress if costs rise.")).toBeInTheDocument();
    expect(screen.getByText("The base case is balanced growth.")).toBeInTheDocument();
    expect(screen.getByText("A regulatory ruling could delay the launch.")).toBeInTheDocument();
    expect(api.listResearchReports).toHaveBeenCalledTimes(1);
  });

  it("test_view_report_handles_a_report_not_yet_in_the_list", async () => {
    api.listResearchJobs.mockResolvedValue({
      jobs: [job({ id: 9, symbol: "NVDA", status: "completed" })],
    });
    api.listResearchReports.mockResolvedValue({ reports: [] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View report" }));

    expect(
      await screen.findByText(
        "Report not found yet for this job. It may still be writing — try refreshing.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Research report" })).toBeInTheDocument();
  });

  it("test_null_report_fields_render_as_unavailable_not_blank", async () => {
    api.listResearchJobs.mockResolvedValue({
      jobs: [job({ id: 7, symbol: "AAPL", status: "completed" })],
    });
    api.listResearchReports.mockResolvedValue({
      reports: [report({ id: 71, job_id: 7, bull_case: null })],
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View report" }));

    const unavailable = await screen.findByText("Unavailable");
    expect(unavailable.tagName).toBe("SPAN");
    expect(unavailable).toHaveClass("text-slate-400");
    expect(screen.getByText("Bull case").parentElement).toContainElement(unavailable);
    expect(screen.getByText("Margins compress if costs rise.")).toBeInTheDocument();
  });

  it("test_backend_detail_renders_when_present_for_a_tradingagents_report", async () => {
    api.listResearchJobs.mockResolvedValue({
      jobs: [job({ id: 7, symbol: "AAPL", status: "completed" })],
    });
    api.listResearchReports.mockResolvedValue({
      reports: [
        report({
          id: 72,
          job_id: 7,
          backend_detail: { signal: "Buy", market_report: "Momentum is positive." },
        }),
      ],
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View report" }));

    expect(await screen.findByText("Buy")).toBeInTheDocument();
    expect(screen.getByText("Momentum is positive.")).toBeInTheDocument();
    expect(screen.getByText("Signal")).toBeInTheDocument();
  });

  it("test_briefs_list_shows_a_report_id_or_no_report_yet_per_entry", async () => {
    api.listResearchBriefs.mockResolvedValue({
      briefs: [
        brief({
          id: 3,
          entries: [
            { symbol: "AAPL", report_id: 12 },
            { symbol: "MSFT", report_id: null },
          ],
        }),
      ],
    });
    renderPage();

    expect(await screen.findByText("AAPL: report #12")).toBeInTheDocument();
    expect(screen.getByText("MSFT: no report yet")).toBeInTheDocument();
  });
});
