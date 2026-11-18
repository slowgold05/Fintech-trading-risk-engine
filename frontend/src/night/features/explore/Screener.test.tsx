import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { apiClient } from "../../../api/client";
import { renderMarket } from "./testSupport";
import { Screener } from "./Screener";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("applies percentage units, scopes denominators and separates zero matches from missing prices", async () => {
  const data = { items: [], matched_count: 0, covered_count: 8, universe_count: 130, limit: 25, offset: 0, coverage: "partial" };
  const read = vi.spyOn(apiClient, "get").mockResolvedValue({ data });
  renderMarket(<Screener />);
  expect(await screen.findByText("No stocks match these filters.")).toBeVisible();
  expect(screen.getByText("8 / 130")).toBeVisible();
  read.mockResolvedValue({ data: { ...data, covered_count: 0, coverage: "missing" } });
  fireEvent.change(screen.getByLabelText("Minimum move (%)"), { target: { value: "2.5" } });
  fireEvent.change(screen.getByLabelText("Sector"), { target: { value: "Technology" } });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));
  await waitFor(() => expect(read).toHaveBeenLastCalledWith("/night/screener", expect.objectContaining({ params: {
    sector: "Technology", min_move: 0.025, sort: "move_desc", limit: 25, offset: 0,
  } })));
  expect(await screen.findByTestId("night-state-unavailable")).toBeVisible();
});
