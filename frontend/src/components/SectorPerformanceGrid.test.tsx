import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { MarketSectorResponse } from "../types/schemas";
import { SectorPerformanceGrid } from "./SectorPerformanceGrid";

function sector(
  partial: Pick<MarketSectorResponse, "symbol" | "sector" | "change_percent"> &
    Partial<MarketSectorResponse>,
): MarketSectorResponse {
  return {
    weight: "small",
    leaders: ["MSFT", "NVDA"],
    ...partial,
  };
}

const proxies = [
  sector({ symbol: "XLK", sector: "Technology", change_percent: -1.67, weight: "large" }),
  sector({ symbol: "XLF", sector: "Financials", change_percent: 1.6, weight: "medium" }),
  sector({ symbol: "XLC", sector: "Communication", change_percent: -0.16, weight: "medium" }),
  sector({ symbol: "XLP", sector: "Consumer Staples", change_percent: -0.4, weight: "small" }),
  sector({ symbol: "XLU", sector: "Utilities", change_percent: 0, weight: "small" }),
];

describe("SectorPerformanceGrid", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders returned sector ETF names and signed percents in order", () => {
    render(<SectorPerformanceGrid sectors={proxies} />);

    expect(screen.getByRole("heading", { name: "Sector ETF performance" })).toBeInTheDocument();
    expect(screen.getByText("ETF proxy moves, not sector or index returns.")).toBeInTheDocument();
    expect(screen.queryByText("Performance by Sector")).not.toBeInTheDocument();

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.getAttribute("aria-label"))).toEqual([
      "Technology, XLK, down -1.67%",
      "Financials, XLF, up +1.60%",
      "Communication, XLC, down -0.16%",
      "Consumer Staples, XLP, down -0.40%",
      "Utilities, XLU, flat +0.00%",
    ]);
    expect(items[0]).toHaveTextContent("Technology");
    expect(items[0]).toHaveTextContent("-1.67%");
    expect(items[3]).toHaveTextContent("Consumer Staples");
    expect(items[3]).toHaveTextContent("-0.40%");
    expect(screen.queryByText("MSFT")).not.toBeInTheDocument();
    expect(screen.queryByText("Telecom")).not.toBeInTheDocument();
    expect(screen.queryByText("Infrastructure")).not.toBeInTheDocument();
  });

  it("uses uniform tiles whose color intensity follows the move", () => {
    render(<SectorPerformanceGrid sectors={proxies} />);

    const technology = screen.getByRole("listitem", { name: /Technology, XLK, down -1\.67%/ });
    const financials = screen.getByRole("listitem", { name: /Financials, XLF, up \+1\.60%/ });
    const communication = screen.getByRole("listitem", { name: /Communication, XLC, down -0\.16%/ });
    const staples = screen.getByRole("listitem", { name: /Consumer Staples, XLP, down -0\.40%/ });
    const utilities = screen.getByRole("listitem", { name: /Utilities, XLU, flat \+0\.00%/ });

    expect(technology).toHaveClass("bg-rose-700", "text-white");
    expect(financials).toHaveClass("bg-emerald-700", "text-white");
    expect(staples).toHaveClass("bg-rose-900", "text-rose-50");
    expect(communication).toHaveClass("bg-rose-950", "text-rose-100");
    expect(utilities).toHaveClass("bg-slate-800", "text-slate-100");
    expect(technology.className).not.toMatch(/col-span|row-span|min-h-32|min-h-44/);
    expect(technology.className).toContain("min-h-12");
    expect(utilities.className).toContain("min-h-12");
    expect(screen.getByRole("list").className).toContain("minmax(min(100%,max(4.75rem,22%)),1fr)");
    expect(technology.className).not.toMatch(/truncate|overflow-hidden/);
    expect(screen.getByText("Communication").className).not.toMatch(/truncate|break-all/);
  });

  it("keeps the ETF symbol and end-of-day basis in the accessible name", () => {
    render(
      <SectorPerformanceGrid
        sectors={[
          sector({
            symbol: "XLE",
            sector: "Energy",
            change_percent: 0.2,
            price_basis: "end_of_day_previous_close",
          }),
          sector({ symbol: "XLB", sector: "Materials", change_percent: Number.NaN }),
        ]}
      />,
    );

    expect(
      screen.getByRole("listitem", {
        name: "Energy, XLE, up +0.20%, end-of-day previous close, not real-time",
      }),
    ).toHaveAttribute("title", "XLE");
    expect(screen.getByRole("listitem", { name: /Materials, XLB, flat n\/a/ })).toHaveTextContent("n/a");
  });

  it("does not invent proxies when none are returned", () => {
    render(<SectorPerformanceGrid sectors={[]} />);

    expect(screen.getByRole("heading", { name: "Sector ETF performance" })).toBeInTheDocument();
    expect(screen.getByText("No sector ETF proxies.")).toBeInTheDocument();
    expect(screen.queryByRole("listitem")).not.toBeInTheDocument();
  });
});
