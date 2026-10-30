import type {
  PortfolioPnlResponse,
  PortfolioResponse,
  RiskResponse,
  TradesResponse,
} from "../../types/schemas";
import { formatDateTime } from "../../utils/format";
import type { PortfolioPoint, Position, Trade } from "./types";

export function getPortfolioValue(portfolio?: PortfolioResponse) {
  return (
    portfolio?.summary.total_account_value ??
    portfolio?.summary.total_portfolio_value ??
    0
  );
}

export function getCashBalance(portfolio?: PortfolioResponse) {
  return portfolio?.summary.cash_balance ?? 0;
}

export function getBuyingPower(portfolio?: PortfolioResponse) {
  return portfolio?.summary.buying_power ?? getCashBalance(portfolio);
}

export function getDayPnl(portfolio?: PortfolioResponse) {
  return portfolio?.summary.total_pnl ?? 0;
}

export function getDayPnlPercent(portfolio?: PortfolioResponse) {
  const summary = portfolio?.summary;
  if (!summary || summary.total_cost_basis <= 0) {
    return 0;
  }

  return (summary.total_pnl / summary.total_cost_basis) * 100;
}

export function getPortfolioChartPoints(
  portfolio?: PortfolioResponse,
  pnl?: PortfolioPnlResponse,
): PortfolioPoint[] {
  if (pnl?.points?.length) {
    return pnl.points.map((point) => ({
      label: point.label,
      value: point.value,
    }));
  }

  if (!portfolio) {
    return [];
  }

  const { total_cost_basis, total_pnl } = portfolio.summary;
  const totalValue = getPortfolioValue(portfolio);
  const step = (totalValue - total_cost_basis) / 4;

  return [
    { label: "Cost", value: total_cost_basis },
    { label: "25%", value: total_cost_basis + step },
    { label: "50%", value: total_cost_basis + step * 2 },
    { label: "75%", value: total_cost_basis + step * 3 },
    { label: total_pnl >= 0 ? "Gain" : "Loss", value: totalValue },
  ];
}

export function mapPortfolioPositions(
  portfolio?: PortfolioResponse,
): Position[] {
  const totalValue = portfolio?.summary.total_portfolio_value ?? 0;

  return (
    portfolio?.positions.map((position) => ({
      symbol: position.symbol,
      name: position.asset_type.toUpperCase(),
      quantity: position.quantity,
      marketValue: position.position_value,
      weight:
        totalValue > 0 ? (position.position_value / totalValue) * 100 : 0,
      pnl: position.unrealized_pnl,
      changePercent: position.unrealized_pnl_pct,
      risk:
        Math.abs(position.unrealized_pnl_pct) >= 10
          ? "High"
          : Math.abs(position.unrealized_pnl_pct) >= 3
            ? "Medium"
            : "Low",
    })) ?? []
  );
}

export function mapRecentTrades(trades?: TradesResponse): Trade[] {
  return (
    trades?.trades.map((trade) => ({
      id: `TRD-${trade.id}`,
      symbol: trade.symbol,
      side: trade.side.toUpperCase() as "BUY" | "SELL",
      quantity: trade.quantity,
      price: trade.price_at_execution,
      value: trade.notional,
      pnl: trade.realized_pnl,
      time: formatDateTime(trade.executed_at),
    })) ?? []
  );
}

export function getRiskScore(risk?: RiskResponse) {
  return risk?.assessments[0]?.risk_score ?? 0;
}

export function getRiskLabel(score: number) {
  if (score >= 80) {
    return "High";
  }

  if (score >= 50) {
    return "Medium";
  }

  if (score > 0) {
    return "Low";
  }

  return "No activity";
}
