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
  marketValue: number | null;
  weight: number | null;
  pnl: number | null;
  changePercent: number | null;
  risk: "Low" | "Medium" | "High" | null;
  unavailableReason?: string | null;
  quoteAt?: string | null;
};

export type DashboardData = {
  isLoading: boolean;
  portfolioValue: number | null;
  dayPnl: number | null;
  dayPnlPercent: number | null;
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
