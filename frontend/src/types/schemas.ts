export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
}

export interface UserResponse {
  id: number;
  email: string;
  role: "trader" | "analyst" | "compliance_officer" | "admin" | "auditor";
}

export interface ControlStatusResponse {
  id: string;
  title: string;
  owner: string;
  frequency: string;
  status: "pass" | "fail" | "no_sample" | "not_run" | "evidence_error" | "unknown";
  run_at: string | null;
  checked: number | null;
  sha256: string | null;
}

export interface TradingHaltResponse {
  halted: boolean;
  operator_halted: boolean;
  emergency_override: boolean;
  actor_user_id: number | null;
  reason: string;
  changed_at: string;
}

export interface TradingHaltEventResponse {
  id: number;
  previous_halted: boolean;
  halted: boolean;
  actor_user_id: number | null;
  reason: string;
  changed_at: string;
}

export interface RoleChangeResponse {
  id: number;
  user_id: number;
  email: string;
  old_role: string;
  new_role: string;
  actor: string;
  reason: string;
  changed_at: string;
}

export interface RegisteredRiskResponse {
  id: string;
  title: string;
  owner: string;
  inherent_rating: "high" | "moderate" | "low";
  residual_rating: "high" | "moderate" | "low";
  controls: string[];
  control_health: "effective" | "failed" | "unverified";
}

export interface RoleRequestResponse {
  id: number;
  email: string;
  old_role: string;
  new_role: string;
  reason: string;
  requested_by_user_id: number;
  approved_by_user_id: number | null;
  status: "pending" | "approved" | "applied";
  requested_at: string;
  approved_at: string | null;
  applied_at: string | null;
}

export interface AccessReviewAccountResponse {
  user_id: number;
  email: string;
  role: string;
  status: "unreviewed" | "retain" | "remove";
  reviewer_user_id: number | null;
  reviewed_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
}

export type AssetType = "stock" | "crypto";
export type TradeSide = "buy" | "sell";
export type RiskLabel = "Low" | "Medium" | "High";

export interface TradeResponse {
  id: number;
  symbol: string;
  asset_type: AssetType;
  side: TradeSide;
  quantity: number;
  price_at_execution: number;
  notional: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  executed_at: string;
}

export interface TradesResponse {
  trades: TradeResponse[];
}

export interface CreateTradePayload {
  symbol: string;
  asset_type: AssetType;
  side: TradeSide;
  quantity: number;
  price?: number;
}

export interface CreateTradeResponse {
  trade_id: number;
  risk_score: number;
}

export interface OrderResponse {
  id: number;
  symbol: string;
  side: TradeSide;
  order_type: "limit" | "market";
  quantity: number;
  remaining_quantity: number;
  limit_price: number | null;
  status: "open" | "filled" | "canceled";
  created_at: string;
  trade_ids?: number[];
}

export interface CreateOrderPayload {
  symbol: string;
  side: TradeSide;
  quantity: number;
  order_type: "limit" | "market";
  limit_price?: number;
}

export interface PortfolioPositionResponse {
  symbol: string;
  asset_type: string;
  quantity: number;
  avg_cost: number;
  current_price: number;
  position_value: number;
  cost_basis: number;
  unrealized_pnl: number;
  unrealized_pnl_pct: number;
}

export interface PortfolioSummaryResponse {
  cash_balance: number;
  buying_power: number;
  total_account_value: number;
  total_portfolio_value: number;
  total_cost_basis: number;
  total_unrealized_pnl: number;
  total_unrealized_pnl_pct: number;
  total_realized_pnl: number;
  total_pnl: number;
}

export interface PortfolioResponse {
  user: {
    id: number;
    email: string;
  };
  positions: PortfolioPositionResponse[];
  summary: PortfolioSummaryResponse;
}

export interface PortfolioPnlPointResponse {
  label: string;
  value: number;
}

export interface PortfolioPnlResponse {
  points?: PortfolioPnlPointResponse[];
  total_pnl?: number;
  total_pnl_pct?: number;
  daily_pnl?: number;
  daily_pnl_pct?: number;
}

export interface RiskAlertResponse {
  rule_code: string;
  severity: string;
  reason: string;
  created_at: string;
}

export interface RiskAssessmentResponse {
  assessment_id: number;
  trade_id: number;
  risk_score: number;
  created_at: string;
  trade: {
    symbol: string;
    asset_type: string;
    side: string;
    quantity: number;
    price_at_execution: number;
    executed_at: string;
  } | null;
  alerts: RiskAlertResponse[];
}

export interface RiskResponse {
  assessments: RiskAssessmentResponse[];
}

export interface MarketTrendResponse {
  symbol: string;
  source_symbol: string;
  name: string;
  value: number;
  change: number;
  change_percent: number;
}

export interface MarketSectorResponse {
  symbol: string;
  sector: string;
  change_percent: number;
  weight: "large" | "medium" | "small";
  leaders: string[];
}

export interface MarketOverviewResponse {
  as_of: string | null;
  trends: MarketTrendResponse[];
  sectors: MarketSectorResponse[];
  errors: Array<{
    symbol: string;
    detail: string | null;
  }>;
}

export type MarketDataStatus = "live-ish" | "delayed" | "cached" | "stale";

export interface MarketHeatmapItemResponse {
  symbol: string;
  company: string;
  exchange: string;
  sector: string;
  price: number;
  change_percent: number;
  volume: number;
  size: "mega" | "large" | "medium" | "small" | "micro";
  refresh_tier: "hot" | "daily";
  data_status: MarketDataStatus;
  age_seconds: number | null;
  source: string;
  as_of: string | null;
}

export interface MarketHeatmapResponse {
  as_of: string | null;
  data_notice: string;
  status_counts: Record<MarketDataStatus, number>;
  items: MarketHeatmapItemResponse[];
}

export interface MarketMoverResponse {
  symbol: string;
  price: number;
  change_amount: number;
  change_percent: number;
  volume: number;
}

export interface MarketTrendingResponse {
  as_of: string;
  top_gainers: MarketMoverResponse[];
  top_losers: MarketMoverResponse[];
  most_active: MarketMoverResponse[];
  errors: Array<{
    detail: string | null;
  }>;
}

export interface MarketResearchResponse {
  symbol: string;
  name?: string | null;
  exchange?: string | null;
  sector?: string | null;
  industry?: string | null;
  market_cap?: number | null;
  pe_ratio?: number | null;
  profit_margin?: number | null;
  beta?: number | null;
  analyst_target_price?: number | null;
  price?: number | null;
  change_percent?: number | null;
  research_risk_score?: number;
  research_risk_label?: "Low" | "Medium" | "High";
  risk_factors?: string[];
  description?: string | null;
  fundamentals?: {
    revenue?: number | null;
    net_income?: number | null;
    assets?: number | null;
    liabilities?: number | null;
    equity?: number | null;
    eps?: number | null;
    source?: string | null;
  };
  errors: Array<{
    source?: string;
    detail: string | null;
  }>;
}
