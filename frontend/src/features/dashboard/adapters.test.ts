import { describe, expect, it } from "vitest";

import type { PortfolioResponse, RiskAssessmentResponse, TradesResponse } from "../../types/schemas";
import {
  getRiskLabel,
  getRiskScore,
  getTotalPnl,
  getUnrealizedPnlPercent,
  getPortfolioValue,
  mapPortfolioPositions,
  mapRecentTrades,
} from "./adapters";

function portfolio(overrides: Partial<PortfolioResponse> = {}): PortfolioResponse {
  return {
    user: { id: 1, email: "trader@example.com" },
    valuation_status: "complete",
    snapshot_read_at: "2026-11-05T15:00:00Z",
    unavailable_symbols: [],
    positions: [
      {
        symbol: "AAPL",
        asset_type: "stock",
        quantity: 2,
        avg_cost: 50,
        current_price: 50,
        position_value: 100,
        cost_basis: 100,
        unrealized_pnl: 0,
        unrealized_pnl_pct: 0,
        price_status: "available",
        unavailable_reason: null,
        source: "yahoo",
        quote_at: "2026-11-05T14:00:00Z",
        fetched_at: "2026-11-05T14:05:00Z",
      },
    ],
    summary: {
      cash_balance: 100000,
      buying_power: 80000,
      total_account_value: 100100,
      total_portfolio_value: 100,
      total_cost_basis: 100,
      total_unrealized_pnl: 0,
      total_unrealized_pnl_pct: 0,
      total_realized_pnl: 0,
      total_pnl: 0,
    },
    ...overrides,
  };
}

function incompleteBook(): PortfolioResponse {
  const book = portfolio({
    valuation_status: "incomplete",
    unavailable_symbols: ["MSFT"],
  });
  book.summary = {
    ...book.summary,
    total_account_value: null,
    total_portfolio_value: null,
    total_unrealized_pnl: null,
    total_unrealized_pnl_pct: null,
    total_pnl: null,
    total_cost_basis: 130,
    total_realized_pnl: 0,
  };
  book.positions = [
    book.positions[0],
    {
      symbol: "MSFT",
      asset_type: "stock",
      quantity: 3,
      avg_cost: 10,
      current_price: null,
      position_value: null,
      cost_basis: 30,
      unrealized_pnl: null,
      unrealized_pnl_pct: null,
      price_status: "unavailable",
      unavailable_reason: "missing",
      source: null,
      quote_at: null,
      fetched_at: null,
    },
  ];
  return book;
}

describe("portfolio valuation adapters", () => {
  it("keeps a complete book numeric, including an actual zero", () => {
    const book = portfolio();
    expect(getPortfolioValue(book)).toBe(100100);
    expect(getTotalPnl(book)).toBe(0);
    expect(getUnrealizedPnlPercent(book)).toBe(0);
    const [position] = mapPortfolioPositions(book);
    expect(position?.weight).toBe(100);
    expect(position?.risk).toBe("Low");
    expect(position?.pnl).toBe(0);
  });

  it("does not invent totals, weights, charts, or risk for an incomplete book", () => {
    const book = incompleteBook();
    expect(getPortfolioValue(book)).toBeNull();
    expect(getTotalPnl(book)).toBeNull();
    expect(getUnrealizedPnlPercent(book)).toBeNull();
    const [priced, missing] = mapPortfolioPositions(book);
    expect(priced?.weight).toBeNull();
    expect(priced?.pnl).toBe(0);
    expect(priced?.risk).toBeNull();
    expect(missing?.marketValue).toBeNull();
    expect(missing?.weight).toBeNull();
    expect(missing?.pnl).toBeNull();
    expect(missing?.risk).toBeNull();
    expect(missing?.unavailableReason).toBe("Quote missing");
  });
});

function assessment(score: number): RiskAssessmentResponse {
  return {
    assessment_id: 1,
    trade_id: 1,
    risk_score: score,
    created_at: "2026-11-05T15:00:00Z",
    trade: null,
    alerts: [],
  };
}

describe("risk and trade adapters", () => {
  it("returns null for a missing, empty, or non-finite assessment and keeps an actual zero", () => {
    expect(getRiskScore(undefined)).toBeNull();
    expect(getRiskScore({ assessments: [] })).toBeNull();
    expect(getRiskScore({ assessments: [assessment(Number.NaN)] })).toBeNull();
    expect(getRiskScore({ assessments: [assessment(Number.POSITIVE_INFINITY)] })).toBeNull();
    expect(getRiskScore({ assessments: [assessment(0)] })).toBe(0);
    expect(getRiskLabel(0)).toBe("Low");
    expect(getRiskLabel(12)).toBe("Low");
    expect(getRiskScore({ assessments: [assessment(64)] })).toBe(64);
    expect(getRiskLabel(64)).toBe("Medium");
    expect(getRiskLabel(91)).toBe("High");
  });

  it("does not turn a missing trade payload into an empty list and keeps a zero realized P&L", () => {
    expect(mapRecentTrades(undefined)).toBeNull();
    expect(mapRecentTrades({ trades: [] })).toEqual([]);
    const filled: TradesResponse = {
      trades: [
        {
          id: 4,
          symbol: "IBM",
          asset_type: "stock",
          side: "sell",
          quantity: 1,
          price_at_execution: 10,
          notional: 10,
          realized_pnl: 0,
          realized_pnl_pct: 0,
          executed_at: "2026-11-05T14:30:00Z",
        },
      ],
    };
    expect(mapRecentTrades(filled)?.[0]?.pnl).toBe(0);
  });
});
