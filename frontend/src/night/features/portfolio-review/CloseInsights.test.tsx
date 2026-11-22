import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { CloseInsights } from "./CloseInsights";

vi.mock("../../../api/client", () => ({apiClient:{get:vi.fn()}}));
afterEach(() => {cleanup(); vi.resetAllMocks();});
const read = {surface:"today",coverage:"partial",read_at:"2026-11-18T13:00:00Z",
  items:[{rule:"close_change",text:"The account changed by 19.05 USD from 2026-11-12 to 2026-11-17.",
    evidence:[{label:"net_account_change",value:"19.05",unit:"usd",from_date:"2026-11-12",to_date:"2026-11-17",source:null}]}],
  omitted:[{rule:"spy_comparison",reason:"No compatible SPY series."}]};
function mount(surface:"today"|"portfolio") {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><CloseInsights owner={11} surface={surface} /></QueryClientProvider>);
  return client;
}
it("uses the dated server sentence and requests Today without a window",async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:read}); const client=mount("today");
  expect(await screen.findByText(read.items[0].text)).toBeVisible();
  expect(client.getQueryData(["acct",11,"close-insights","today",null])).toEqual(read);
  expect(vi.mocked(apiClient.get)).toHaveBeenCalledWith("/night/portfolio/insights",expect.objectContaining({params:{surface:"today"}}));
  fireEvent.click(screen.getByText("Close-to-close change evidence")); expect(screen.getByText("$19.05 USD")).toBeVisible();
  fireEvent.click(screen.getByText("Omitted figures (1)")); expect(screen.getByText(/No compatible SPY series/)).toBeVisible();
});
it("changes the Portfolio window and retains omission reasons when every figure is unavailable",async () => {
  vi.mocked(apiClient.get).mockResolvedValue({data:{...read,items:[]}});
  const client=mount("portfolio"); await screen.findByText(/No supported closing figures/);
  fireEvent.change(screen.getByLabelText("Insight period"),{target:{value:"3m"}});
  await screen.findByText(/No supported closing figures/);
  expect(client.getQueryData(["acct",11,"close-insights","portfolio","3m"])).toBeTruthy();
  expect(screen.queryByText(read.items[0].text)).toBeNull();
});
