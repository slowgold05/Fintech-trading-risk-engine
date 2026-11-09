import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type InternalAxiosRequestConfig } from "axios";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CreateForecastJobBody } from "../api/forecasts";
import type { HistoryBar, HistoryResponse } from "../api/history";
import { ToastProvider } from "../context/ToastProvider";
import type {
  ForecastEvaluation,
  ForecastJob,
  ForecastModel,
  ForecastResult,
} from "../types/schemas";
import ForecastLab from "./ForecastLab";

const api = vi.hoisted(() => ({
  createForecastJob: vi.fn(),
  listForecastJobs: vi.fn(),
  cancelForecastJob: vi.fn(),
  listForecastResults: vi.fn(),
  listForecastModels: vi.fn(),
  listForecastEvaluations: vi.fn(),
  fetchDailyHistory: vi.fn(),
}));

vi.mock("../api/forecasts", () => ({
  createForecastJob: api.createForecastJob,
  listForecastJobs: api.listForecastJobs,
  cancelForecastJob: api.cancelForecastJob,
  listForecastResults: api.listForecastResults,
  listForecastModels: api.listForecastModels,
  listForecastEvaluations: api.listForecastEvaluations,
}));

vi.mock("../api/history", () => ({
  fetchDailyHistory: api.fetchDailyHistory,
}));

const clients: QueryClient[] = [];

function renderPage(node: ReactNode = <ForecastLab />) {
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

function job(
  overrides: Partial<ForecastJob> & Pick<ForecastJob, "id" | "symbol" | "status">,
): ForecastJob {
  return {
    provider: "alpaca",
    adjustment_type: "split_adjusted",
    lookback: 64,
    horizon: 5,
    sample_count: 1,
    created_at: "2026-11-08T15:00:00Z",
    updated_at: "2026-11-08T15:00:00Z",
    error_message: null,
    ...overrides,
  };
}

function forecastResult(
  overrides: Partial<ForecastResult> & Pick<ForecastResult, "id" | "job_id">,
): ForecastResult {
  return {
    symbol: "AAPL",
    provider: "alpaca",
    adjustment_type: "split_adjusted",
    model_name: "NeoQuasar/Kronos-small",
    tokenizer_name: "NeoQuasar/Kronos-Tokenizer-base",
    lookback: 64,
    horizon: 5,
    sample_count: 1,
    input_cutoff: "2026-11-06",
    generated_at: "2026-11-08T16:30:00Z",
    bars: [
      { session_date: "2026-11-07", open: 102, high: 103, low: 101, close: 102.5, volume: 10 },
      { session_date: "2026-11-08", open: 102.5, high: 104, low: 102, close: 103.25, volume: 11 },
    ],
    ...overrides,
  };
}

function historyBar(sessionDate: string, close: string): HistoryBar {
  return {
    session_date: sessionDate,
    open: close,
    high: close,
    low: close,
    close,
    volume: "1000",
    fetched_at: "2026-11-08T16:00:00Z",
    provider: "alpaca",
    adjustment_type: "split_adjusted",
    quality_status: "valid",
  };
}

function historyResponse(bars: HistoryBar[]): HistoryResponse {
  return {
    symbol: "AAPL",
    interval: "1d",
    range: "2y",
    provider: "alpaca",
    adjustment_type: "split_adjusted",
    status: "partial",
    coverage_status: "not_verified",
    expected_session_count: null,
    collection: "disabled",
    read_at: "2026-11-08T16:00:00Z",
    requested_start: "2024-11-08",
    requested_end: "2026-11-08",
    available_start: "2024-11-08",
    available_end: "2026-11-06",
    excluded_row_count: 0,
    bars,
  };
}

function forecastModel(overrides: Partial<ForecastModel> = {}): ForecastModel {
  return {
    id: "kronos",
    model_name: "NeoQuasar/Kronos-small",
    tokenizer_name: "NeoQuasar/Kronos-Tokenizer-base",
    enabled: true,
    max_lookback: 512,
    max_horizon: 24,
    max_sample_count: 5,
    source_commit: "67b630e67f6a18c9e9be918d9b4337c960db1e9a",
    license: "MIT",
    ...overrides,
  };
}

function evaluation(
  overrides: Partial<ForecastEvaluation> & Pick<ForecastEvaluation, "id">,
): ForecastEvaluation {
  return {
    symbol: "AAPL",
    provider: "alpaca",
    adjustment_type: "split_adjusted",
    horizon: 5,
    window_count: 12,
    model_mae: 0.42,
    model_directional_accuracy: 0.61,
    baseline_type: "last_close",
    baseline_mae: 0.87,
    baseline_directional_accuracy: 0.5,
    weights_exercised: true,
    notes: null,
    created_at: "2026-11-08T18:00:00Z",
    ...overrides,
  };
}

function fillForecastForm(symbol: string) {
  fireEvent.change(screen.getByLabelText("Symbol"), { target: { value: symbol } });
  fireEvent.change(screen.getByLabelText("Provider"), { target: { value: "alpaca" } });
  fireEvent.change(screen.getByLabelText("Adjustment type"), {
    target: { value: "split_adjusted" },
  });
  fireEvent.change(screen.getByLabelText("Lookback"), { target: { value: "64" } });
  fireEvent.change(screen.getByLabelText("Horizon"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Sample count"), { target: { value: "1" } });
}

describe("Forecast lab", () => {
  beforeEach(() => {
    api.createForecastJob.mockReset();
    api.listForecastJobs.mockReset();
    api.cancelForecastJob.mockReset();
    api.listForecastResults.mockReset();
    api.listForecastModels.mockReset();
    api.listForecastEvaluations.mockReset();
    api.fetchDailyHistory.mockReset();
    api.listForecastJobs.mockResolvedValue({ jobs: [] });
    api.listForecastResults.mockResolvedValue({ results: [] });
    api.listForecastModels.mockResolvedValue({ models: [] });
    api.listForecastEvaluations.mockResolvedValue({ evaluations: [] });
    api.fetchDailyHistory.mockResolvedValue(historyResponse([]));
  });

  afterEach(() => {
    cleanup();
    clients.splice(0).forEach((client) => client.clear());
  });

  it("test_creates_a_job_and_it_appears_in_the_list", async () => {
    let listed: ForecastJob[] = [];
    api.listForecastJobs.mockImplementation(async () => ({ jobs: listed }));
    api.createForecastJob.mockImplementation(async (body: CreateForecastJobBody) => {
      const created = job({
        id: 11,
        symbol: body.symbol,
        provider: body.provider,
        adjustment_type: body.adjustment_type,
        lookback: body.lookback,
        horizon: body.horizon,
        sample_count: body.sample_count,
        status: "queued",
      });
      listed = [created];
      return created;
    });
    renderPage();

    expect(await screen.findByText("No forecast jobs yet.")).toBeInTheDocument();
    fillForecastForm("AAPL");
    fireEvent.click(screen.getByRole("button", { name: "Queue job" }));

    await waitFor(() => {
      expect(api.createForecastJob).toHaveBeenCalledWith({
        symbol: "AAPL",
        provider: "alpaca",
        adjustment_type: "split_adjusted",
        lookback: 64,
        horizon: 5,
        sample_count: 1,
      });
    });
    expect(await screen.findByText("queued")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Forecast job queued for AAPL.");
    expect(screen.getByLabelText("Symbol")).toHaveValue("");
    expect(screen.getByLabelText("Lookback")).toHaveValue(null);
  });

  it("test_shows_the_backend_s_own_error_message_on_create_failure", async () => {
    api.createForecastJob.mockRejectedValue(httpError("Unknown or inactive stock symbol"));
    renderPage();

    fillForecastForm("ZZZZ");
    fireEvent.click(await screen.findByRole("button", { name: "Queue job" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unknown or inactive stock symbol");
    expect(api.createForecastJob).toHaveBeenCalledWith({
      symbol: "ZZZZ",
      provider: "alpaca",
      adjustment_type: "split_adjusted",
      lookback: 64,
      horizon: 5,
      sample_count: 1,
    });
  });

  it("test_cancel_button_only_shows_for_queued_jobs", async () => {
    api.listForecastJobs.mockResolvedValue({
      jobs: [
        job({ id: 4, symbol: "AAPL", status: "queued" }),
        job({ id: 5, symbol: "MSFT", status: "completed" }),
        job({ id: 6, symbol: "NVDA", status: "running" }),
        job({ id: 7, symbol: "AMZN", status: "failed" }),
        job({ id: 8, symbol: "META", status: "cancelled" }),
      ],
    });
    renderPage();

    const queuedRow = (await screen.findByText("AAPL")).closest("li") as HTMLElement;
    const completedRow = screen.getByText("MSFT").closest("li") as HTMLElement;
    const runningRow = screen.getByText("NVDA").closest("li") as HTMLElement;
    expect(within(queuedRow).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(completedRow).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(completedRow).getByRole("button", { name: "View forecast" })).toBeInTheDocument();
    expect(within(runningRow).queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(within(runningRow).queryByRole("button", { name: "View forecast" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "View forecast" })).toHaveLength(1);
  });

  it("test_cancelling_a_job_calls_the_api_and_refreshes_the_list", async () => {
    const queued = job({ id: 4, symbol: "AAPL", status: "queued" });
    let listed = [queued];
    api.listForecastJobs.mockImplementation(async () => ({ jobs: listed }));
    api.cancelForecastJob.mockImplementation(async (jobId: number) => {
      const cancelled = { ...queued, id: jobId, status: "cancelled" as const };
      listed = [cancelled];
      return cancelled;
    });
    renderPage();

    const queuedRow = (await screen.findByText("AAPL")).closest("li") as HTMLElement;
    fireEvent.click(within(queuedRow).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(api.cancelForecastJob).toHaveBeenCalledWith(4);
    });
    expect(await screen.findByText("cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  });

  it("test_view_forecast_renders_the_chart_once_history_and_result_both_load", async () => {
    api.listForecastJobs.mockResolvedValue({
      jobs: [job({ id: 7, symbol: "AAPL", status: "completed" })],
    });
    api.listForecastResults.mockResolvedValue({
      results: [forecastResult({ id: 70, job_id: 7 })],
    });
    api.fetchDailyHistory.mockResolvedValue(
      historyResponse([
        historyBar("2026-11-05", "100.000000"),
        historyBar("2026-11-06", "101.000000"),
        historyBar("2026-11-07", "999.000000"),
      ]),
    );
    renderPage();

    expect(api.listForecastResults).not.toHaveBeenCalled();
    expect(api.fetchDailyHistory).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "View forecast" }));

    expect(await screen.findByTestId("forecast-chart")).toBeInTheDocument();
    expect(screen.getByText(/Observed through 2026-11-06/)).toBeInTheDocument();
    expect(screen.getByText(/Model NeoQuasar\/Kronos-small/)).toBeInTheDocument();
    expect(screen.getByText(/Tokenizer NeoQuasar\/Kronos-Tokenizer-base/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "This is one model-generated path, not a prediction and not a guaranteed future price.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Cached history through 2026-11-06/)).toBeInTheDocument();
    expect(api.listForecastResults).toHaveBeenCalledTimes(1);
    expect(api.fetchDailyHistory).toHaveBeenCalledWith("AAPL", "alpaca", "split_adjusted", "2y");
  });

  it("test_view_forecast_handles_a_result_not_yet_in_the_list", async () => {
    api.listForecastJobs.mockResolvedValue({
      jobs: [job({ id: 9, symbol: "NVDA", status: "completed" })],
    });
    api.listForecastResults.mockResolvedValue({ results: [] });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "View forecast" }));

    expect(
      await screen.findByText(
        "Forecast not found yet for this job. It may still be writing — try refreshing.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Forecast chart" })).toBeInTheDocument();
    expect(api.fetchDailyHistory).not.toHaveBeenCalled();
    expect(screen.queryByTestId("forecast-chart")).not.toBeInTheDocument();
  });

  it("test_models_card_shows_enabled_status_and_bounds", async () => {
    api.listForecastModels.mockResolvedValue({
      models: [forecastModel()],
    });
    renderPage();

    expect(await screen.findByText("NeoQuasar/Kronos-small")).toBeInTheDocument();
    expect(screen.getByText("enabled")).toBeInTheDocument();
    expect(screen.getByText("Max lookback 512")).toBeInTheDocument();
    expect(screen.getByText("Max horizon 24")).toBeInTheDocument();
    expect(screen.getByText("Max sample count 5")).toBeInTheDocument();
  });

  it("test_evaluations_card_shows_the_empty_state_when_none_exist", async () => {
    api.listForecastEvaluations.mockResolvedValue({ evaluations: [] });
    renderPage();

    expect(
      await screen.findByText(
        "No evaluations recorded yet. This model's forecasting accuracy has not been validated.",
      ),
    ).toBeInTheDocument();
  });

  it("test_evaluations_card_shows_a_row_when_one_exists", async () => {
    api.listForecastEvaluations.mockResolvedValue({
      evaluations: [evaluation({ id: 3 })],
    });
    renderPage();

    expect(await screen.findByText(/Model MAE 0\.42/)).toBeInTheDocument();
    expect(screen.getByText(/baseline MAE 0\.87/)).toBeInTheDocument();
    expect(screen.getByText("Weights exercised")).toBeInTheDocument();
    expect(
      screen.queryByText(
        "No evaluations recorded yet. This model's forecasting accuracy has not been validated.",
      ),
    ).not.toBeInTheDocument();
  });
});
