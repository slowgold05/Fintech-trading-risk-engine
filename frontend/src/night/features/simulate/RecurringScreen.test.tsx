import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { RecurringScreen } from "./RecurringScreen";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("runs independently, enumerates skipped months and keeps outcome when price history fails", async () => {
  vi.spyOn(apiClient, "get").mockRejectedValue(new Error("Offline"));
  const post = vi.spyOn(apiClient, "post").mockResolvedValue({ data: {
    symbol: "SPY", mode: "recurring", coverage: "partial", source: {provider: "yahoo", basis: "split_adjusted", coverage: "partial", session_date: "2026-04-01"},
    start_used: "2026-02-01", end_used: "2026-04-01", price_return: "0.10", contributed_usd: "10050.00", end_value_usd: "11050.00",
    points: [{session_date: "2026-02-01"}, {session_date: "2026-04-01"}], assumptions: ["Missing sessions have no valuations."], skipped_months: ["2026-03"],
  }});
  render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><RecurringScreen /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByTestId("night-recurring")).toBeVisible();
  const monthly = screen.getByLabelText("Monthly contribution (USD)");
  expect(monthly).toHaveValue(250);
  fireEvent.change(monthly, { target: { value: "100001" } });
  fireEvent.click(screen.getByTestId("simulation-run"));
  expect(post).not.toHaveBeenCalled();
  fireEvent.change(monthly, { target: { value: "50" } });
  fireEvent.click(screen.getByTestId("simulation-run"));
  expect(await screen.findByText("Matching price history unavailable")).toBeVisible();
  expect(screen.getByText(/2026-03/)).toBeVisible();
  expect(screen.getByText("$11,050.00")).toBeVisible();
  expect(screen.getByText("$10,050.00")).toBeVisible();
  expect(screen.getByText("+10.00%")).toBeVisible();
  expect(post).toHaveBeenCalledExactlyOnceWith("/night/simulations/recurring", expect.objectContaining({monthly_usd: "50.00"}));
});
