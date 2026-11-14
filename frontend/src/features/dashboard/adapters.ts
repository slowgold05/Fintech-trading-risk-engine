import type {
  PortfolioResponse,
  RiskResponse,
  TradesResponse,
  UnavailableReason,
} from "../../types/schemas";
import { formatDateTime } from "../../utils/format";
import type { Position, Trade } from "./types";

const REASON_LABELS: Record<UnavailableReason, string> = {
  missing: "Quote missing",
  invalid: "Quote invalid",
  stale: "Quote stale",
  unsupported_asset: "Unsupported asset",
};

export function valuationReasonLabel(reason: string | null | undefined): string | null {
  if (
    reason === "missing" ||
    reason === "invalid" ||
    reason === "stale" ||
    reason === "unsupported_asset"
  ) {
    return REASON_LABELS[reason];
  }
  return null;
}

function isComplete(portfolio?: PortfolioResponse): portfolio is PortfolioResponse {
  return portfolio?.valuation_status === "complete";
}

export function getPortfolioValue(portfolio?: PortfolioResponse): number | null {
  if (!isComplete(portfolio) || portfolio.summary.total_account_value == null) {
    return null;
  }
  return portfolio.summary.total_account_value;
}

export function getCashBalance(portfolio?: PortfolioResponse) {
  return portfolio?.summary.cash_balance ?? 0;
}

export function getBuyingPower(portfolio?: PortfolioResponse) {
  return portfolio?.summary.buying_power ?? getCashBalance(portfolio);
}

export function getTotalPnl(portfolio?: PortfolioResponse): number | null {
  if (!isComplete(portfolio) || portfolio.summary.total_pnl == null) {
    return null;
  }
  return portfolio.summary.total_pnl;
}

export function getUnrealizedPnlPercent(portfolio?: PortfolioResponse): number | null {
  if (!isComplete(portfolio)) {
    return null;
  }
  return portfolio.summary.total_unrealized_pnl_pct;
}

function positionRisk(changePercent: number | null): Position["risk"] {
  if (changePercent == null) {
    return null;
  }
  const magnitude = Math.abs(changePercent);
  if (magnitude >= 10) {
    return "High";
  }
  if (magnitude >= 3) {
    return "Medium";
  }
  return "Low";
}

export function mapPortfolioPositions(
  portfolio?: PortfolioResponse,
): Position[] {
  const complete = isComplete(portfolio);
  const totalValue = complete ? portfolio.summary.total_portfolio_value : null;

  return (
    portfolio?.positions.map((position) => {
      const marketValue = position.position_value;
      const changePercent = position.unrealized_pnl_pct;
      const weight =
        !complete || marketValue == null || totalValue == null
          ? null
          : totalValue > 0
            ? (marketValue / totalValue) * 100
            : 0;
      return {
        symbol: position.symbol,
        name: position.asset_type.toUpperCase(),
        quantity: position.quantity,
        marketValue,
        weight,
        pnl: position.unrealized_pnl,
        changePercent,
        risk: complete ? positionRisk(changePercent) : null,
        unavailableReason:
          position.price_status === "unavailable"
            ? valuationReasonLabel(position.unavailable_reason)
            : null,
        quoteAt: position.quote_at,
      };
    }) ?? []
  );
}

export function mapRecentTrades(trades?: TradesResponse): Trade[] | null {
  if (!trades) {
    return null;
  }

  return trades.trades.map((trade) => ({
    id: `TRD-${trade.id}`,
    symbol: trade.symbol,
    side: trade.side.toUpperCase() as "BUY" | "SELL",
    quantity: trade.quantity,
    price: trade.price_at_execution,
    value: trade.notional,
    pnl: trade.realized_pnl,
    time: formatDateTime(trade.executed_at),
  }));
}

export function getRiskScore(risk?: RiskResponse): number | null {
  const score = risk?.assessments[0]?.risk_score;
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return null;
  }
  return score;
}

export function getRiskLabel(score: number) {
  if (score >= 80) {
    return "High";
  }

  if (score >= 50) {
    return "Medium";
  }

  return "Low";
}
