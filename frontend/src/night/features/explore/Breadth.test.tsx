import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { Breadth } from "./Breadth";
const data = { session_date:"2026-11-17", previous_session_date:"2026-11-16", coverage:"partial", covered_count:4, excluded_count:96,
  universe_count:100, advancing:1, declining:2, flat:1, items:[],
  sectors:[{sector:"Technology", covered:4, median_move:null, proxy:null, proxy_symbol:"XLK", proxy_coverage:"missing"}] };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("computes direction shares among covered stocks and discloses exclusions", async () => {
  vi.spyOn(apiClient,"get").mockResolvedValue({data});
  renderMarket(<Breadth />);
  expect(await screen.findByText("4 / 100")).toBeVisible();
  expect(screen.getByText("96")).toBeVisible();
  expect(screen.getByText("50.0%")).toBeVisible();
});
