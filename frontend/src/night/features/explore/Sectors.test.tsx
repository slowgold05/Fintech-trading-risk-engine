import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { Sectors } from "./Sectors";
const data = { session_date:"2026-11-17", previous_session_date:"2026-11-16", coverage:"partial", covered_count:4, excluded_count:96,
  universe_count:100, advancing:1, declining:2, flat:1, items:[],
  sectors:[{sector:"Technology", covered:4, median_move:null, proxy:null, proxy_symbol:"XLK", proxy_coverage:"missing"}] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("preserves unknown median and proxy moves and scopes a sector drilldown", async () => {
  const read = vi.spyOn(apiClient,"get").mockResolvedValue({data});
  renderMarket(<Sectors />);
  expect(await screen.findByText("Move unavailable")).toBeVisible();
  expect(screen.getByText("Unavailable")).toBeVisible();
  read.mockResolvedValue({data:{...data,covered_count:0,coverage:"missing",sectors:[]}});
  fireEvent.click(screen.getByRole("button",{name:"Show Technology coverage"}));
  expect(await screen.findByTestId("night-state-unavailable")).toBeVisible();
  expect(read).toHaveBeenLastCalledWith("/night/breadth",expect.objectContaining({params:{sector:"Technology"}}));
});
