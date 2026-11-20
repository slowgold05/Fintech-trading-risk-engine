import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { DataCoverage } from "./DataCoverage";
import { readCoverage, type CoverageReport } from "./coverage";

vi.mock("./coverage", () => ({ readCoverage: vi.fn() }));
vi.mock("../../../api/market", () => ({ fetchMarketUniverse: async () => ({ items: [] }) }));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

const empty: CoverageReport = {
  expected_session: "2026-11-17", read_at: "2026-11-18T12:00:00Z", coverage: "missing",
  universe: { population: "active_non_test_non_etf", eligible: 1 },
  quotes: { present: 0, missing: 1, stale: 0, invalid: 0, fresh_eod: 0, unconfirmed_or_other: 0 },
  history: [], reference: { news: { cached_rows: 0, latest_observed_at: null }, filings: { cached_rows: 0, latest_observed_at: null },
    dividends_splits: { mode: "verified_events_only" } }, symbol: null,
};
function mount(url = "/market/data-coverage") {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><DataCoverage /></MemoryRouter></QueryClientProvider>);
  return client;
}
it("reads a shareable normalized ticker and keeps the quote session distinct from the delayed read", async () => {
  vi.mocked(readCoverage).mockResolvedValue({ ...empty, coverage: "stale", quotes: { ...empty.quotes, present: 1, missing: 0, stale: 1 },
    symbol: { symbol: "AAPL", history: [], reason: "No raw history.", quote: {
      execution_reference: "stale", price: "123.450000", source: {
        provider: "yahoo", basis: "raw", session_date: "2026-11-10", observed_at: "2026-11-11T10:00:00Z", coverage: "stale",
      },
    } } });
  const client = mount("/market/data-coverage?symbol=aapl");
  expect(await screen.findByText("123.450000")).toBeVisible();
  expect(screen.getByTestId("close-provenance")).toHaveTextContent("2026-11-10");
  expect(screen.getByText("2026-11-17")).toBeVisible();
  expect(screen.getByText("No raw history.")).toBeVisible();
  expect(client.getQueryData(["night","data-coverage",{symbol:"AAPL"}])).toBeDefined();
});
it("handles a failed lookup and retries the active query for an uncovered listing", async () => {
  const user = userEvent.setup();
  vi.mocked(readCoverage).mockResolvedValueOnce(empty).mockRejectedValueOnce({isAxiosError:true,response:{status:503}})
    .mockResolvedValueOnce({...empty, symbol:{symbol:"AA",quote:null,history:[],reason:"No raw history."}});
  mount();
  expect(await screen.findByText("No stored daily bars")).toBeVisible();
  const ticker = screen.getByLabelText("Inspect a symbol");
  await user.type(ticker, " aa {Enter}");
  expect(await screen.findByText("Coverage could not be loaded")).toBeVisible();
  expect(ticker).toHaveFocus();
  await user.click(screen.getByRole("button", {name:"Retry coverage"}));
  expect(await screen.findByText("Execution reference unavailable")).toBeVisible();
  expect(readCoverage).toHaveBeenLastCalledWith("AA", expect.any(AbortSignal));
  expect(screen.queryByRole("link")).toBeNull();
});

it("keeps zero counts inspectable against the entire eligible population", async () => {
  vi.mocked(readCoverage).mockResolvedValue(empty);
  mount();
  const missing = await screen.findByRole("button",{name:/^Missing/});
  await userEvent.click(missing);
  expect(screen.getByRole("img",{name:"Missing: 1 of 1 eligible listings"})).toBeVisible();
  await userEvent.click(screen.getByRole("button",{name:/^Fresh close/}));
  expect(screen.getByRole("img",{name:"Fresh close: 0 of 1 eligible listings"})).toBeVisible();
});

it("rests the census when there is no eligible population", async () => {
  vi.mocked(readCoverage).mockResolvedValue({...empty, universe:{...empty.universe,eligible:0},quotes:{...empty.quotes,missing:0}});
  mount();
  expect(await screen.findByText("No eligible listings in the quote census")).toBeVisible();
  expect(screen.queryByRole("button",{name:/^Missing/})).toBeNull();
  expect(screen.getByLabelText("Quote counts")).toHaveTextContent("Stored quotes0");
});
