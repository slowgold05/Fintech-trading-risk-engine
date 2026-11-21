import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { BacktestScreen } from "./BacktestScreen";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function mount() {
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><BacktestScreen /></MemoryRouter></QueryClientProvider>);
}
it("sends one explicit run and distinguishes missing coverage from a zero valuation", async () => {
  const post = vi.spyOn(apiClient, "post").mockResolvedValue({data: {
    mode: "backtest", symbol: "SPY", coverage: "missing", points: [], source: null,
    assumptions: ["At least two usable sessions are required. Found 1."], skipped_months: [],
  }});
  mount();
  expect(screen.getByTestId("night-backtest")).toBeVisible();
  expect(screen.queryByLabelText(/Monthly contribution/)).toBeNull();
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("simulation-run"));
  expect(await screen.findByText("Insufficient stored closes")).toBeVisible();
  expect(post).toHaveBeenCalledExactlyOnceWith("/night/simulations/backtest",
    {symbol: "SPY", start: "2025-11-17", end: "2026-11-17", initial_usd: "10000.00"});
  expect(screen.queryByText("$0.00")).toBeNull();
  fireEvent.change(screen.getByLabelText("Symbol"), {target: {value: "aapl"}});
  expect(screen.queryByTestId("simulation-result")).toBeNull();
  expect(screen.getByLabelText("Symbol")).toHaveValue("AAPL");
});
it("prevents out-of-range amounts and dates from reaching the API", () => {
  const post = vi.spyOn(apiClient, "post");
  mount();
  const button = screen.getByTestId("simulation-run");
  const amount = screen.getByLabelText("Initial investment (USD)");
  for (const value of ["0", "0.001", "1000000.01"]) {
    fireEvent.change(amount, {target: {value}});
    expect(amount).toBeInvalid();
    fireEvent.click(button);
  }
  fireEvent.change(amount, {target: {value: "1.23"}});
  fireEvent.change(screen.getByLabelText("Start date"), {target: {value: "2020-01-01"}});
  expect(screen.getByLabelText("End date")).toBeInvalid();
  fireEvent.click(button);
  expect(post).not.toHaveBeenCalled();
});
it("retains the form and exposes the server's error for a retry", async () => {
  const post = vi.spyOn(apiClient, "post").mockRejectedValue({isAxiosError: true, response: {data: {detail: {code: "unknown_symbol", message: "Unknown symbol."}}}});
  mount();
  fireEvent.change(screen.getByLabelText("Symbol"), {target: {value: "NONE"}});
  fireEvent.click(screen.getByTestId("simulation-run"));
  expect(await screen.findByText("Unknown symbol.")).toBeVisible();
  expect(screen.getByLabelText("Symbol")).toHaveValue("NONE");
  expect(screen.getByTestId("simulation-run")).toBeEnabled();
  expect(post).toHaveBeenCalledTimes(1);
});
