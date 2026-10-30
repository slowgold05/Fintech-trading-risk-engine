// Public, unauthenticated market snapshot placeholder.
// Replace this module with a backend-backed market data endpoint before using it
// for real-time or delayed production market data.
export type MarketTrend = {
  symbol: string;
  name: string;
  value: number;
  changePercent: number;
};

export type SectorHeatmapItem = {
  symbol: string;
  sector: string;
  changePercent: number;
  weight: "large" | "medium" | "small";
  leaders: string[];
};

export type MarketMover = {
  symbol: string;
  price: number;
  change_amount: number;
  change_percent: number;
  volume: number;
};

export type ResearchSnapshot = {
  symbol: string;
  name: string;
  exchange: string;
  sector: string;
  industry: string;
  market_cap: number;
  pe_ratio: number;
  profit_margin: number;
  beta: number;
  analyst_target_price: number;
  price: number;
  change_percent: number;
  research_risk_score: number;
  research_risk_label: "Low" | "Medium" | "High";
  risk_factors: string[];
  description: string;
  errors: Array<{ detail: string | null }>;
};

export type StockHeatmapItem = {
  symbol: string;
  company: string;
  sector: string;
  changePercent: number;
  size: "mega" | "large" | "medium" | "small" | "micro";
  dataStatus?: "live-ish" | "delayed" | "cached" | "stale";
  ageSeconds?: number | null;
  source?: string;
  asOf?: string | null;
};

export const marketTrends: MarketTrend[] = [
  { symbol: "SPX", name: "S&P 500", value: 5487.03, changePercent: 0.42 },
  { symbol: "NDX", name: "Nasdaq 100", value: 19812.55, changePercent: 0.68 },
  { symbol: "DJI", name: "Dow Jones", value: 39021.12, changePercent: -0.16 },
  { symbol: "RUT", name: "Russell 2000", value: 2037.48, changePercent: -0.31 },
  { symbol: "VIX", name: "Volatility", value: 13.72, changePercent: 2.14 },
];

export const sectorHeatmap: SectorHeatmapItem[] = [
  {
    symbol: "XLK",
    sector: "Technology",
    changePercent: 1.28,
    weight: "large",
    leaders: ["MSFT", "NVDA", "AAPL"],
  },
  {
    symbol: "XLF",
    sector: "Financials",
    changePercent: 0.34,
    weight: "medium",
    leaders: ["JPM", "BAC"],
  },
  {
    symbol: "XLV",
    sector: "Healthcare",
    changePercent: -0.22,
    weight: "medium",
    leaders: ["LLY", "UNH"],
  },
  {
    symbol: "XLY",
    sector: "Consumer Disc.",
    changePercent: 0.61,
    weight: "medium",
    leaders: ["HD", "MCD", "NKE"],
  },
  {
    symbol: "XLP",
    sector: "Consumer Staples",
    changePercent: 0.27,
    weight: "small",
    leaders: ["WMT", "COST", "PG"],
  },
  {
    symbol: "XLI",
    sector: "Industrials",
    changePercent: -0.48,
    weight: "small",
    leaders: ["CAT", "GE"],
  },
  {
    symbol: "XLE",
    sector: "Energy",
    changePercent: -1.12,
    weight: "small",
    leaders: ["XOM", "CVX"],
  },
  {
    symbol: "XLC",
    sector: "Communication",
    changePercent: 0.79,
    weight: "medium",
    leaders: ["META", "GOOGL"],
  },
  {
    symbol: "XLRE",
    sector: "Real Estate",
    changePercent: -0.67,
    weight: "small",
    leaders: ["PLD", "AMT"],
  },
  {
    symbol: "XLU",
    sector: "Utilities",
    changePercent: 0.18,
    weight: "small",
    leaders: ["NEE", "SO"],
  },
  {
    symbol: "XLB",
    sector: "Materials",
    changePercent: -0.09,
    weight: "small",
    leaders: ["LIN", "APD"],
  },
];

export const fallbackTrending: MarketMover[] = [
  { symbol: "NVDA", price: 143.85, change_amount: 3.14, change_percent: 2.23, volume: 42680000 },
  { symbol: "TSLA", price: 184.92, change_amount: 4.2, change_percent: 2.32, volume: 69320000 },
  { symbol: "AMD", price: 161.12, change_amount: -2.01, change_percent: -1.23, volume: 31840000 },
  { symbol: "AAPL", price: 214.18, change_amount: 1.58, change_percent: 0.74, volume: 28410000 },
  { symbol: "MSFT", price: 503.29, change_amount: -0.91, change_percent: -0.18, volume: 19720000 },
];

export const fallbackResearch: ResearchSnapshot = {
  symbol: "NVDA",
  name: "NVIDIA Corporation",
  exchange: "NASDAQ",
  sector: "Technology",
  industry: "Semiconductors",
  market_cap: 3500000000000,
  pe_ratio: 45.8,
  profit_margin: 0.55,
  beta: 1.66,
  analyst_target_price: 160,
  price: 143.85,
  change_percent: 2.23,
  research_risk_score: 54,
  research_risk_label: "Medium",
  risk_factors: ["High valuation multiple", "High beta volatility", "Healthy profit margin"],
  description:
    "Research snapshot placeholder. Live company overview loads from the backend when the market data provider is available.",
  errors: [],
};

export const stockHeatmapUniverse: StockHeatmapItem[] = [
  { symbol: "NVDA", company: "NVIDIA", sector: "Technology", changePercent: 1.76, size: "mega" },
  { symbol: "AAPL", company: "Apple", sector: "Technology", changePercent: 0.23, size: "mega" },
  { symbol: "MSFT", company: "Microsoft", sector: "Technology", changePercent: -0.63, size: "mega" },
  { symbol: "AVGO", company: "Broadcom", sector: "Technology", changePercent: 3.74, size: "large" },
  { symbol: "AMD", company: "AMD", sector: "Technology", changePercent: 3.35, size: "large" },
  { symbol: "MU", company: "Micron", sector: "Technology", changePercent: 7.64, size: "medium" },
  { symbol: "INTC", company: "Intel", sector: "Technology", changePercent: 8.38, size: "medium" },
  { symbol: "ORCL", company: "Oracle", sector: "Technology", changePercent: 0.25, size: "medium" },
  { symbol: "CRM", company: "Salesforce", sector: "Technology", changePercent: -1.97, size: "small" },
  { symbol: "ADBE", company: "Adobe", sector: "Technology", changePercent: 4.4, size: "small" },
  { symbol: "QCOM", company: "Qualcomm", sector: "Technology", changePercent: 3.19, size: "small" },
  { symbol: "TXN", company: "Texas Instruments", sector: "Technology", changePercent: 4.84, size: "small" },
  { symbol: "GOOGL", company: "Alphabet", sector: "Communication", changePercent: 0.47, size: "mega" },
  { symbol: "META", company: "Meta", sector: "Communication", changePercent: 1.41, size: "large" },
  { symbol: "NFLX", company: "Netflix", sector: "Communication", changePercent: 0.49, size: "medium" },
  { symbol: "DIS", company: "Disney", sector: "Communication", changePercent: -0.34, size: "medium" },
  { symbol: "TMUS", company: "T-Mobile", sector: "Communication", changePercent: 0.62, size: "small" },
  { symbol: "VZ", company: "Verizon", sector: "Communication", changePercent: -0.21, size: "small" },
  { symbol: "T", company: "AT&T", sector: "Communication", changePercent: 0.18, size: "small" },
  { symbol: "AMZN", company: "Amazon", sector: "Consumer Discretionary", changePercent: 2.51, size: "mega" },
  { symbol: "HD", company: "Home Depot", sector: "Consumer Discretionary", changePercent: 2.63, size: "large" },
  { symbol: "MCD", company: "McDonald's", sector: "Consumer Discretionary", changePercent: -0.86, size: "medium" },
  { symbol: "NKE", company: "Nike", sector: "Consumer Discretionary", changePercent: -0.42, size: "small" },
  { symbol: "SBUX", company: "Starbucks", sector: "Consumer Discretionary", changePercent: 1.15, size: "small" },
  { symbol: "LOW", company: "Lowe's", sector: "Consumer Discretionary", changePercent: 0.82, size: "small" },
  { symbol: "TSLA", company: "Tesla", sector: "Consumer Cyclical", changePercent: -1.88, size: "large" },
  { symbol: "F", company: "Ford", sector: "Consumer Cyclical", changePercent: 0.31, size: "small" },
  { symbol: "GM", company: "General Motors", sector: "Consumer Cyclical", changePercent: -0.54, size: "small" },
  { symbol: "WMT", company: "Walmart", sector: "Consumer Staples", changePercent: -0.63, size: "large" },
  { symbol: "COST", company: "Costco", sector: "Consumer Staples", changePercent: -1.25, size: "large" },
  { symbol: "PG", company: "Procter & Gamble", sector: "Consumer Staples", changePercent: 0.71, size: "medium" },
  { symbol: "KO", company: "Coca-Cola", sector: "Consumer Staples", changePercent: -1.09, size: "medium" },
  { symbol: "PEP", company: "PepsiCo", sector: "Consumer Staples", changePercent: 0.38, size: "small" },
  { symbol: "MO", company: "Altria", sector: "Consumer Staples", changePercent: 1.97, size: "small" },
  { symbol: "JPM", company: "JPMorgan", sector: "Financials", changePercent: -0.75, size: "large" },
  { symbol: "BRK.B", company: "Berkshire", sector: "Financials", changePercent: -0.54, size: "large" },
  { symbol: "V", company: "Visa", sector: "Financials", changePercent: -0.2, size: "large" },
  { symbol: "MA", company: "Mastercard", sector: "Financials", changePercent: -0.36, size: "medium" },
  { symbol: "BAC", company: "Bank of America", sector: "Financials", changePercent: 0.15, size: "medium" },
  { symbol: "WFC", company: "Wells Fargo", sector: "Financials", changePercent: -0.51, size: "small" },
  { symbol: "MS", company: "Morgan Stanley", sector: "Financials", changePercent: 1.27, size: "small" },
  { symbol: "GS", company: "Goldman Sachs", sector: "Financials", changePercent: 1.65, size: "small" },
  { symbol: "LLY", company: "Eli Lilly", sector: "Healthcare", changePercent: -1.45, size: "large" },
  { symbol: "JNJ", company: "Johnson & Johnson", sector: "Healthcare", changePercent: -2.51, size: "large" },
  { symbol: "UNH", company: "UnitedHealth", sector: "Healthcare", changePercent: 0.98, size: "large" },
  { symbol: "ABBV", company: "AbbVie", sector: "Healthcare", changePercent: -2.34, size: "medium" },
  { symbol: "MRK", company: "Merck", sector: "Healthcare", changePercent: -2.57, size: "medium" },
  { symbol: "PFE", company: "Pfizer", sector: "Healthcare", changePercent: 1.0, size: "small" },
  { symbol: "TMO", company: "Thermo Fisher", sector: "Healthcare", changePercent: 0.1, size: "small" },
  { symbol: "AMAT", company: "Applied Materials", sector: "Industrials", changePercent: 6.03, size: "medium" },
  { symbol: "LRCX", company: "Lam Research", sector: "Industrials", changePercent: 5.81, size: "medium" },
  { symbol: "CAT", company: "Caterpillar", sector: "Industrials", changePercent: 3.17, size: "medium" },
  { symbol: "GE", company: "GE Aerospace", sector: "Industrials", changePercent: 5.01, size: "small" },
  { symbol: "HON", company: "Honeywell", sector: "Industrials", changePercent: 1.48, size: "small" },
  { symbol: "UPS", company: "UPS", sector: "Industrials", changePercent: -0.91, size: "small" },
  { symbol: "XOM", company: "Exxon Mobil", sector: "Energy", changePercent: -2.72, size: "large" },
  { symbol: "CVX", company: "Chevron", sector: "Energy", changePercent: -2.24, size: "medium" },
  { symbol: "COP", company: "ConocoPhillips", sector: "Energy", changePercent: -3.0, size: "small" },
  { symbol: "SLB", company: "Schlumberger", sector: "Energy", changePercent: 0.6, size: "small" },
  { symbol: "NEE", company: "NextEra", sector: "Utilities", changePercent: 2.03, size: "medium" },
  { symbol: "SO", company: "Southern", sector: "Utilities", changePercent: 0.52, size: "small" },
  { symbol: "DUK", company: "Duke Energy", sector: "Utilities", changePercent: 0.36, size: "small" },
  { symbol: "PLD", company: "Prologis", sector: "Real Estate", changePercent: -0.67, size: "medium" },
  { symbol: "AMT", company: "American Tower", sector: "Real Estate", changePercent: -0.25, size: "small" },
  { symbol: "EQIX", company: "Equinix", sector: "Real Estate", changePercent: 0.43, size: "small" },
  { symbol: "LIN", company: "Linde", sector: "Materials", changePercent: 0.19, size: "medium" },
  { symbol: "APD", company: "Air Products", sector: "Materials", changePercent: -0.7, size: "small" },
  { symbol: "SHW", company: "Sherwin-Williams", sector: "Materials", changePercent: 0.44, size: "small" },
];
