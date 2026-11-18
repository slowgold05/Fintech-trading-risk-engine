import { cleanup, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { Events } from "./Events";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("uses the company route symbol and keeps filings separate from absent corporate-action evidence", async () => {
  const url="https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/filing.htm";
  const read=vi.spyOn(apiClient,"get").mockResolvedValue({data:{symbol:"AAPL",coverage:"partial",coverage_by_kind:{filing:"available",dividend:"missing",split:"missing"},
    items:[{kind:"filing",date:"2026-11-16",title:"SEC Form 10-Q",url,source:{provider:"sec_edgar",basis:"filing"}}]}});
  renderMarket(<Routes><Route path="/market/:symbol" element={<Events />} /></Routes>,"/market/aapl?tab=events");
  expect(await screen.findByRole("link",{name:"SEC Form 10-Q"})).toHaveAttribute("href",url);
  expect(screen.getAllByText("No stored coverage")).toHaveLength(2);
  expect(read).toHaveBeenCalledWith("/night/events/AAPL",expect.objectContaining({params:{limit:20}}));
});
