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

it("counts signed and flat returns only for published aliases", async () => {
  vi.mocked(fetchMe).mockResolvedValue({ id: 1, email: "demo@example.com", role: "trader", is_demo: true });
  vi.mocked(api.fetchRanking).mockResolvedValue({
    start: "2026-10-20", end: "2026-11-17", excluded_count: 2, coverage: "partial",
    items: [
      { rank: 1, alias: "Elm", return_ratio: "0.02" },
      { rank: 2, alias: "Fir", return_ratio: "0.01" },
      { rank: 3, alias: "Oak", return_ratio: "0" },
      { rank: 4, alias: "Ash", return_ratio: "-0.01" },
    ],
    my_entry: { enabled: false, alias: null },
  });
  renderScreen(<Leaderboard />);
  expect(await screen.findByRole("button", {name: /Gained\s*2/})).toBeVisible();
  expect(screen.getByRole("button", {name: /Unchanged\s*1/})).toBeVisible();
  expect(screen.getByRole("button", {name: /Declined\s*1/})).toBeVisible();
  expect(screen.getByRole("cell", {name: "-1.00%"})).toBeVisible();
});
