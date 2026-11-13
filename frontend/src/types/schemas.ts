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

export interface SurveillanceRuleResponse {
  id: string;
  title: string;
  version: number;
  model_type: string;
  sla_hours: number;
  activation_status: "inactive" | "pending" | "active" | "rejected" | "retired";
  request_id: number | null;
  requested_by_user_id: number | null;
}

export interface SurveillanceCaseResponse {
  id: number;
  rule_id: string;
  rule_version: number;
  subject_user_id: number;
  symbol: string;
  status: "open" | "closed";
  disposition: "true_positive" | "false_positive" | "inconclusive" | null;
  summary: string;
  opened_at: string;
  due_at: string;
  closed_at: string | null;
}

export interface OpsHealthResponse {
  generated_at: string;
  market_data_freshness: {
    "live-ish": number;
    delayed: number;
    cached: number;
    stale: number;
  };
  job_queues: {
    research: {
      queued_count: number;
      running_count: number;
      oldest_queued_age_seconds: number | null;
      failed_last_24h_count: number;
    };
    forecast: {
      queued_count: number;
      running_count: number;
      oldest_queued_age_seconds: number | null;
      failed_last_24h_count: number;
    };
  };
  ai_usage: {
    research_jobs_with_token_counts: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    avg_duration_ms: number;
  };
  massive_ingestion: {
    symbols_covered: number;
    latest_session_date: string | null;
    flagged_last_30d_count: number;
  };
  kronos_worker: {
    weights_cache_dir_exists: boolean;
    weights_cache_bytes: number;
  };
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
  quantity: number | string;
  order_type: "limit" | "market";
  limit_price?: number | string;
}

export type ValuationStatus = "complete" | "incomplete";

export type PriceStatus = "available" | "unavailable";

export type UnavailableReason = "missing" | "invalid" | "stale" | "unsupported_asset";

export interface PortfolioPositionResponse {
  symbol: string;
  asset_type: string;
  quantity: number;
  avg_cost: number;
  current_price: number | null;
  position_value: number | null;
  cost_basis: number;
  unrealized_pnl: number | null;
  unrealized_pnl_pct: number | null;
  price_status: PriceStatus;
  unavailable_reason: UnavailableReason | null;
  source: string | null;
  quote_at: string | null;
  fetched_at: string | null;
}

export interface PortfolioSummaryResponse {
  cash_balance: number;
  buying_power: number;
  total_account_value: number | null;
  total_portfolio_value: number | null;
  total_cost_basis: number;
  total_unrealized_pnl: number | null;
  total_unrealized_pnl_pct: number | null;
  total_realized_pnl: number;
  total_pnl: number | null;
}

export interface PortfolioResponse {
  user: {
    id: number;
    email: string;
  };
  valuation_status: ValuationStatus;
  snapshot_read_at: string;
  unavailable_symbols: string[];
  positions: PortfolioPositionResponse[];
  summary: PortfolioSummaryResponse;
}

export interface AllocationSecurity {
  symbol: string;
  sector: string;
  position_value: string | null;
  weight_pct: string | null;
  price_status: PriceStatus;
}

export interface AllocationSector {
  sector: string;
  value: string;
  weight_pct: string;
}

export interface AllocationResponse {
  user: { id: number; email: string };
  read_at: string;
  status: "complete" | "incomplete";
  cash_balance: string;
  cash_weight_pct: string | null;
  total_account_value: string | null;
  unavailable_symbols: string[];
  securities: AllocationSecurity[];
  sectors: AllocationSector[] | null;
}

export interface AttributionSecurity {
  symbol: string;
  sector: string;
  realized_pnl: string;
  unrealized_pnl: string | null;
  total_pnl: string | null;
  pnl_contribution_pct: string | null;
}

export interface AttributionSector {
  sector: string;
  total_pnl: string;
  pnl_contribution_pct: string | null;
}

export interface AttributionResponse {
  user: { id: number; email: string };
  read_at: string;
  status: "complete" | "incomplete";
  total_pnl: string | null;
  securities: AttributionSecurity[];
  sectors: AttributionSector[] | null;
}

export interface StressScenario {
  scenario:
    | "broad_market_selloff"
    | "technology_sector_selloff"
    | "single_security_worst_holding";
  shock_pct: string;
  loss: string | null;
  loss_pct: string | null;
  affected_symbol?: string | null;
}

export interface RiskCorrelation {
  symbols: [string, string];
  return_count: number;
  correlation: string | null;
}

export interface RiskContribution {
  symbol: string;
  weight_pct: string;
  risk_contribution_pct: string;
}

export interface RiskMetricsResponse {
  user: { id: number; email: string };
  range: "1y" | "2y";
  requested_start: string;
  requested_end: string;
  read_at: string;
  status: "complete" | "incomplete";
  observed_periods: number;
  return_count: number;
  historical_volatility_pct: string | null;
  max_drawdown_pct: string | null;
  beta_pair_count: number;
  portfolio_beta: string | null;
  historical_var_95_pct: string | null;
  historical_var_99_pct: string | null;
  expected_shortfall_95_pct: string | null;
  expected_shortfall_99_pct: string | null;
  correlations: RiskCorrelation[] | null;
  stress_scenarios: StressScenario[] | null;
  risk_contributions: RiskContribution[] | null;
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
  price: number | null;
  change_amount: number | null;
  change_percent: number | null;
  volume: number | null;
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
  research_risk_score?: number | null;
  research_risk_label?: "Low" | "Medium" | "High" | null;
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

export interface ResearchFiling {
  form: string | null;
  filing_date: string | null;
  report_date: string | null;
  accession_number: string;
  primary_document: string;
  document_url: string;
}

export interface ResearchFilingsResponse {
  symbol: string;
  cik: string;
  name: string | null;
  filings: ResearchFiling[];
  source: string;
  fetched_at: string;
}

export interface ResearchNewsArticle {
  headline: string;
  summary: string;
  source: string;
  url: string;
  published_at: string;
}

export interface ResearchNewsResponse {
  symbol: string;
  articles: ResearchNewsArticle[];
  error: string | null;
}

export interface TradeImpactLevel {
  cash_balance: string | null;
  buying_power: string | null;
  total_account_value: string | null;
  cash_weight_pct: string | null;
  symbol_position_value: string | null;
  symbol_weight_pct: string | null;
}

export interface TradeImpactChanges {
  cash_balance: string | null;
  total_account_value: string | null;
  cash_weight_pct: string | null;
  symbol_weight_pct: string | null;
}

export interface TradeImpactResponse {
  user: { id: number; email: string };
  read_at: string;
  status: "complete" | "incomplete";
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  reference_price: string;
  order_type: "market" | "limit";
  warnings: string[];
  before: TradeImpactLevel;
  after: TradeImpactLevel;
  changes: TradeImpactChanges;
}

export interface TradeImpactRequestBody {
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  reference_price: string;
  order_type: "market" | "limit";
}

export interface RiskScenarioShock {
  target_type: "symbol" | "sector";
  target: string;
  shock_pct: string;
}

export interface RiskScenarioSecurity {
  symbol: string;
  sector: string;
  position_value_before: string;
  position_value_after: string;
}

export interface RiskScenariosResponse {
  user: { id: number; email: string };
  read_at: string;
  status: "complete" | "incomplete";
  shocks: RiskScenarioShock[];
  total_account_value_before: string | null;
  total_account_value_after: string | null;
  loss: string | null;
  loss_pct: string | null;
  securities: RiskScenarioSecurity[];
}

export interface ResearchJob {
  id: number;
  symbol: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface ResearchReportSource {
  type: string;
  status: string;
  detail: string;
}

export interface ResearchReport {
  id: number;
  job_id: number;
  symbol: string;
  created_at: string;
  sources: ResearchReportSource[];
  bull_case: string | null;
  bear_case: string | null;
  synthesis: string | null;
  risks: string | null;
  model_version: string | null;
  prompt_version: string | null;
  backend_detail: Record<string, unknown> | null;
}

export interface ResearchBriefEntry {
  symbol: string;
  report_id: number | null;
}

export interface ResearchBrief {
  id: number;
  brief_date: string;
  created_at: string;
  entries: ResearchBriefEntry[];
}

export interface ForecastJob {
  id: number;
  symbol: string;
  provider: string;
  adjustment_type: string;
  lookback: number;
  horizon: number;
  sample_count: number;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  created_at: string;
  updated_at: string;
  error_message: string | null;
}

export interface ForecastBar {
  session_date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface ForecastResult {
  id: number;
  job_id: number;
  symbol: string;
  provider: string;
  adjustment_type: string;
  model_name: string;
  tokenizer_name: string;
  lookback: number;
  horizon: number;
  sample_count: number;
  input_cutoff: string;
  generated_at: string;
  bars: ForecastBar[];
}

export interface ForecastModel {
  id: string;
  model_name: string;
  tokenizer_name: string;
  enabled: boolean;
  max_lookback: number;
  max_horizon: number;
  max_sample_count: number;
  source_commit: string;
  license: string;
}

export interface ForecastEvaluation {
  id: number;
  symbol: string;
  provider: string;
  adjustment_type: string;
  horizon: number;
  window_count: number;
  model_mae: number;
  model_directional_accuracy: number;
  baseline_type: string;
  baseline_mae: number;
  baseline_directional_accuracy: number;
  weights_exercised: boolean;
  notes: string | null;
  created_at: string;
}
