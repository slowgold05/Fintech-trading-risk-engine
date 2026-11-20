import { cleanup, fireEvent, screen } from "@testing-library/react";
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

it("counts linked records on the same date and preserves empty days between them", async () => {
  const dates = ["2026-11-16","2026-11-14","2026-11-14"];
  const items = dates.map((date,i) => ({date,kind:"filing",title:"SEC filing",url:"https://www.sec.gov/"+i,source:{provider:"sec_edgar",basis:"filing"}}));
  vi.spyOn(apiClient,"get").mockResolvedValue({data:{symbol:"AAPL",coverage:"partial",coverage_by_kind:{filing:"available",dividend:"missing",split:"missing"},items}});
  renderMarket(<Routes><Route path="/market/:symbol" element={<Events/>}/></Routes>,"/market/AAPL?tab=events");
  const slider = await screen.findByRole("slider",{name:"Inspect company event date"});
  expect(slider).toHaveValue("2");
  fireEvent.change(slider,{target:{value:"0"}});
  expect(slider).toHaveAttribute("aria-valuetext",dates[1]);
  expect(screen.getByText("2 records",{exact:true})).toBeVisible();
  fireEvent.change(slider,{target:{value:"1"}});
  expect(screen.getByText("No linked records in this interval")).toBeVisible();
  expect(screen.getAllByRole("link",{name:"SEC filing"})).toHaveLength(3);
});
