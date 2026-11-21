import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMe } from "../../../api/auth";
import { apiClient } from "../../../api/client";
import { PortfolioReview } from "./PortfolioReview";
import type { Review } from "./review";

vi.mock("../../../api/auth", () => ({fetchMe:vi.fn()}));
vi.mock("../../../api/client", () => ({apiClient:{get:vi.fn()}}));
afterEach(() => {cleanup(); vi.resetAllMocks();});
const body: Review = {
  window:"1m",read_at:"2026-11-18T12:00:00Z",coverage:"partial",requested_start:"2026-10-17",requested_end:"2026-11-17",
  start_used:"2026-11-13",end_used:"2026-11-17",expected_sessions:22,valued_sessions:2,missing_sessions:["2026-11-16"],
  observations:[], assumptions:["Unrecorded dividends excluded."],
  points:[{session_date:"2026-11-13",portfolio_return_ratio:"0",spy_return_ratio:null,drawdown_ratio:"0"},
    {session_date:"2026-11-16",portfolio_return_ratio:null,spy_return_ratio:null,drawdown_ratio:null},
    {session_date:"2026-11-17",portfolio_return_ratio:"0.025",spy_return_ratio:null,drawdown_ratio:"0"}],
  metrics:{return_ratio:"0.025",spy_return_ratio:null,excess_return_ratio:null,max_drawdown_ratio:"0",annualized_volatility_ratio:null,
    beta_to_spy:null,correlation_to_spy:null,daily_sample_count:0,paired_sample_count:0},
  exposure:{as_of:null,coverage:"stale",cash_weight_ratio:null,sectors:[],unpriced_symbols:["AAPL"]},
  contribution:{coverage:"missing",scope:"period",items:[],residual_usd:null,reason:"Incompatible share basis."},
};
function mount() {
  vi.mocked(fetchMe).mockResolvedValue({id:7,role:"trader",email:"fixture@example.test"});
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/portfolio/review?returnTo=%2Fportfolio%23holdings"]}><PortfolioReview /></MemoryRouter></QueryClientProvider>);
  return client;
}
it("preserves an account series across SPY and account gaps and separates snapshot and period coverage", async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:body});
  const client = mount();
  const metrics = await screen.findByTestId("portfolio-review-metrics");
  expect(within(metrics).getByText("2.50%")).toBeVisible();
  expect(within(metrics).getByText(/2 of 22/)).toBeVisible();
  expect(screen.getByText(/Market coverage stale/)).toBeVisible();
  expect(screen.getByText(body.contribution.reason!)).toBeVisible();
  expect(screen.getByRole("link",{name:"Back to portfolio"})).toHaveAttribute("href","/portfolio#holdings");
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext","2026-11-17");
  expect(within(document.querySelector<HTMLElement>(".ins-readings")!).getByText("+2.50%")).toBeVisible();
  fireEvent.change(screen.getByRole("slider"),{target:{value:"1"}});
  expect(screen.getByRole("slider")).toHaveAttribute("aria-valuetext","2026-11-16");
  expect(within(document.querySelector<HTMLElement>(".ins-readings")!).getAllByText("—")).toHaveLength(2);
  expect(client.getQueryData(["acct",7,"portfolio-review","1m"])).toEqual(body);
  fireEvent.change(screen.getByRole("combobox"),{target:{value:"ytd"}});
  expect(vi.mocked(apiClient.get)).toHaveBeenLastCalledWith("/night/portfolio/review",expect.objectContaining({params:{window:"ytd"}}));
});
it("recovers after a failed read without showing a fabricated zero", async () => {
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error()).mockResolvedValueOnce({data:{...body, points:[]}});
  mount();
  fireEvent.click(await screen.findByRole("button",{name:"Retry review"}));
  expect(await screen.findByText("No priced returns in this period")).toBeVisible();
});
