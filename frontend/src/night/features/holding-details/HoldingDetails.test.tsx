import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { fetchMe } from "../../../api/auth";
import { apiClient } from "../../../api/client";
import { HoldingDetails } from "./HoldingDetails";
import type { HoldingLots } from "./lots";

vi.mock("../../../api/auth",() => ({fetchMe:vi.fn()}));
vi.mock("../../../api/client",() => ({apiClient:{get:vi.fn()}}));
afterEach(() => {cleanup();vi.resetAllMocks();});
const book: HoldingLots = {symbol:"AAPL",read_at:"2026-11-18T14:00:00Z",book_started_on:"2026-10-01",coverage:"stale",
  quantity:"1.25",cost_basis_usd:"20",unrealized_pnl_usd:null,realized_pnl_usd:"4.50",market_value_usd:null,mark:null,reason:"Cached mark is stale.",
  lots:{items:[{id:1,recorded_at:"2026-10-24T12:00:00Z",quantity_remaining:"1.25",cost_per_share:"16",cost_basis_usd:"20",unrealized_pnl_usd:null}],next_cursor:"more"},
  sales:{items:[{trade_id:22,order_id:19,executed_at:"2026-11-07T12:00:00Z",quantity:"0.25",fill_price:"34",proceeds_usd:"8.50",realized_pnl_usd:"4.50",demo_seed:false}],next_cursor:"sales2"}};
function mount(role: "trader" | "analyst" = "trader") {
  vi.mocked(fetchMe).mockResolvedValue({id:8,role,email:"fixture@example.test"});
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/portfolio/holdings?symbol=aapl&returnTo=%2Fportfolio%23holding-AAPL"]}>
    <HoldingDetails Note={() => <p>Trader note editor</p>} /></MemoryRouter></QueryClientProvider>);
  return client;
}
it("keeps basis, separate posted sale and owned receipt available with a stale mark", async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:book});
  const client = mount("analyst");
  const lots = await screen.findByTestId("holding-lots-table");
  expect(within(lots).getByText("$20.00")).toBeVisible();
  expect(within(lots).getByText("Unavailable")).toBeVisible();
  expect(screen.getByText("Current mark unavailable")).toBeVisible();
  const href = new URL(screen.getByRole("link",{name:"Order 19"}).getAttribute("href")!,"http://localhost");
  expect(href.searchParams.get("order")).toBe("19");
  expect(href.searchParams.get("returnTo")).toContain("/portfolio/holdings?symbol=aapl");
  expect(screen.getByRole("link",{name:"Back to portfolio"})).toHaveAttribute("href","/portfolio#holding-AAPL");
  expect(screen.queryByText("Trader note editor")).toBeNull();
  expect(client.getQueryData(["acct",8,"holding-lots","AAPL",null,null,25])).toEqual(book);
});
it("pages the two lists independently and allows a fully sold holding to retain its sales", async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:book});
  mount();
  fireEvent.click(await screen.findByRole("button",{name:"Next sales"}));
  await screen.findByRole("button",{name:"First sales"});
  fireEvent.click(screen.getByRole("button",{name:"Next lots"}));
  await screen.findByRole("button",{name:"First lots"});
  expect(vi.mocked(apiClient.get)).toHaveBeenLastCalledWith("/night/holdings/AAPL/lots",expect.objectContaining({params:{limit:25,lot_cursor:"more",sale_cursor:"sales2"}}));
  vi.mocked(apiClient.get).mockResolvedValue({data:{...book,quantity:"0",lots:{items:[],next_cursor:null}}});
  fireEvent.click(screen.getByRole("button",{name:"First sales"}));
  await screen.findByText("No open lots in this book.");
  expect(screen.getByRole("link",{name:"Order 19"})).toBeVisible();
});
