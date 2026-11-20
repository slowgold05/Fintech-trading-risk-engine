import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { Compare } from "./Compare";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps a missing session unplotted and compares the same observation for both symbols", async () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-05", "2026-10-06"];
  const series = ["AAPL","SPY"].map((symbol,i) => ({ symbol, source: {provider:"yahoo",basis:"split_adjusted",coverage:"partial"},
    returns: i ? ["0","0.1","0.1","0.3"] : ["0",null,"-0.1","0.2"], missing_sessions: i ? 0 : 1 }));
  const read = vi.spyOn(apiClient,"get").mockResolvedValue({data:{ dates, series, coverage:"partial", base_date:dates[0], requested_start:dates[0], requested_end:dates[3] }});
  renderMarket(<Compare />);
  const plot = await screen.findByRole("img", {name:/AAPL price returns/});
  expect(plot.querySelector("polyline")?.getAttribute("points")?.split(" ")).toHaveLength(2);
  fireEvent.change(screen.getByLabelText("Inspect session"),{target:{value:dates[1]}});
  expect(screen.getByText("Unavailable")).toBeVisible();
  expect(screen.getByRole("slider", { name:"Inspect comparison session" })).toHaveAccessibleDescription(/SPY.*\+10\.00%/);
  const slider = screen.getByRole("slider", { name:"Inspect comparison session" });
  expect(slider).toHaveAttribute("aria-valuetext", dates[1]);
  fireEvent.change(slider, { target:{ value:"2" } });
  expect(screen.getByLabelText("Inspect session")).toHaveValue(dates[2]);
  fireEvent.change(screen.getByLabelText("Symbols (2–4)"),{target:{value:"aapl,AAPL"}});
  fireEvent.click(screen.getByRole("button",{name:"Compare"}));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(read).toHaveBeenCalledTimes(1);
});
