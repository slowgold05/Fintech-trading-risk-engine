import { cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { Leaderboard } from "../Leaderboard";
import * as api from "../leaderboardApi";
import { fetchMe } from "../../../../api/auth";
import { renderScreen } from "./renderScreen";

vi.mock("../leaderboardApi");
vi.mock("../../../../api/auth");
afterEach(() => { cleanup(); vi.resetAllMocks(); });

it("omits ranks for a single qualifying demo and keeps the actual comparison dates", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 1, email: "demo@example.com", role: "trader", is_demo: true });
  vi.mocked(api.fetchRanking).mockResolvedValue({ start: "2026-10-20", end: "2026-11-17", excluded_count: 1, coverage: "missing",
    items: [], my_entry: { enabled: true, alias: "Elm" } });
  renderScreen(<Leaderboard />);
  expect(await screen.findByText("Waiting for eligible returns")).toBeInTheDocument();
  expect(screen.getByText("2026-10-20")).toBeInTheDocument();
  expect(screen.getByText("Opted in as Elm.")).toBeInTheDocument();
  expect(screen.queryByRole("table")).toBeNull();
});
it("never requests rankings for a regular trader", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 1, email: "fixture@example.com", role: "trader", is_demo: false });
  renderScreen(<Leaderboard />);
  expect(await screen.findByTestId("night-forbidden")).toBeInTheDocument();
  expect(api.fetchRanking).not.toHaveBeenCalled();
});
