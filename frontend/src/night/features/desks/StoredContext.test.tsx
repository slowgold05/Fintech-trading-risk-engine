import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { fetchDailyHistory, type HistoryBar } from "../../../api/history";
import { StoredContext } from "./StoredContext";

vi.mock("../../../api/history", () => ({fetchDailyHistory:vi.fn()}));
afterEach(cleanup);

it("selects the last priced close and keeps uncovered weekdays inspectable at both ends", async () => {
  const bar: HistoryBar = {
    session_date:"2026-11-17", close:"101", open:"99", low:"99", high:"102", volume:"15",
    fetched_at:"2026-11-17T21:00:00Z", provider:"yahoo", adjustment_type:"split_adjusted", quality_status:"valid",
  };
  vi.mocked(fetchDailyHistory).mockResolvedValue({
    symbol:"AAPL", provider:"yahoo", adjustment_type:"split_adjusted", interval:"1d", range:"1m", status:"partial",
    coverage_status:"gaps", expected_session_count:3, collection:"disabled", excluded_row_count:0,
    requested_start:"2026-11-16", requested_end:"2026-11-18", available_start:bar.session_date,
    available_end:bar.session_date, read_at:"2026-11-18T21:00:00Z", bars:[bar],
  });
  render(<QueryClientProvider client={new QueryClient()}><StoredContext symbol="AAPL" onSymbol={() => {}}/></QueryClientProvider>);
  const slider = await screen.findByRole("slider", {name:"AAPL daily close"});
  expect(slider).toHaveValue("1");
  expect(slider).toHaveAttribute("aria-valuetext",bar.session_date);
  fireEvent.change(slider, {target:{value:"2"}});
  expect(slider).toHaveAttribute("aria-valuetext","2026-11-18");
  expect(screen.getByText("—")).toBeVisible();
});
