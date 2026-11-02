export type PortfolioPoint = {
  label: string;
  value: number;
};

export type Trade = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  value: number;
  pnl: number;
  time: string;
};

export type Position = {
  symbol: string;
  name: string;
  quantity: number;
  marketValue: number;
  weight: number;
  pnl: number;
  changePercent: number;
  risk: "Low" | "Medium" | "High";
};

export type DashboardData = {
  isLoading: boolean;
  portfolioValue: number;
  dayPnl: number;
  dayPnlPercent: number;
  cash: number;
  riskScore: number;
  riskLabel: string;
  chart: PortfolioPoint[];
  trades: Trade[];
  positions: Position[];
};

export type QuickTradeFormValues = {
  symbol: string;
  assetType: "stock" | "crypto";
  side: "buy" | "sell";
  quantity: number;
  price?: number;
};
