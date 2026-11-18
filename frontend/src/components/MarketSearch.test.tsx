import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MarketSearch } from "./MarketSearch";
import type { MarketUniverseItem } from "../types/schemas";

const api = vi.hoisted(() => ({
  fetchMarketUniverse: vi.fn(),
}));

vi.mock("../api/market", () => api);

function item(overrides: Partial<MarketUniverseItem> & Pick<MarketUniverseItem, "symbol">): MarketUniverseItem {
  return {
    company_name: overrides.symbol,
    exchange: "NYSE",
    sector: null,
    is_etf: false,
    refresh_tier: "daily",
    in_featured_universe: true,
    universe_label: null,
    ...overrides,
  };
}

function open() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><MarketSearch /></MemoryRouter>
    </QueryClientProvider>,
  );
}

async function search(term: string) {
  fireEvent.change(screen.getByLabelText("Search symbols"), { target: { value: term } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

describe("MarketSearch", () => {
  beforeEach(() => {
    api.fetchMarketUniverse.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a featured member without the outside badge", async () => {
    api.fetchMarketUniverse.mockResolvedValue({
      total: 1,
      limit: 20,
      offset: 0,
      items: [item({ symbol: "MMM", company_name: "3M", in_featured_universe: true, universe_label: null })],
    });
    open();
    await search("MMM");
    expect(await screen.findByRole("link", { name: "MMM" })).toHaveAttribute("href", "/market/MMM");
    expect(screen.queryByText("Outside S&P 500")).not.toBeInTheDocument();
  });

  it("badges a symbol outside the featured universe", async () => {
    api.fetchMarketUniverse.mockResolvedValue({
      total: 1,
      limit: 20,
      offset: 0,
      items: [item({
        symbol: "ZZZFAKE",
        company_name: "Outsider Co",
        in_featured_universe: false,
        universe_label: "Outside S&P 500",
      })],
    });
    open();
    await search("ZZZFAKE");
    const badge = await screen.findByText("Outside S&P 500");
    expect(badge).toHaveClass("status-badge");
    expect(screen.getByText("ZZZFAKE")).toBeInTheDocument();
  });
});
