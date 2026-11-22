"""Index and sector proxies used by market discovery and ingestion."""

INDEX_SYMBOLS = [
    {"symbol": "SPY", "name": "S&P 500", "display_symbol": "SPX"},
    {"symbol": "QQQ", "name": "Nasdaq 100", "display_symbol": "NDX"},
    {"symbol": "DIA", "name": "Dow Jones", "display_symbol": "DJI"},
    {"symbol": "IWM", "name": "Russell 2000", "display_symbol": "RUT"},
]

SECTOR_SYMBOLS = [
    {"symbol": "XLK", "sector": "Technology", "weight": "large", "leaders": ["MSFT", "NVDA", "AAPL"]},
    {"symbol": "XLF", "sector": "Financials", "weight": "medium", "leaders": ["JPM", "BAC"]},
    {"symbol": "XLV", "sector": "Healthcare", "weight": "medium", "leaders": ["LLY", "UNH"]},
    {"symbol": "XLY", "sector": "Consumer Disc.", "weight": "medium", "leaders": ["HD", "MCD", "NKE"]},
    {"symbol": "XLP", "sector": "Consumer Staples", "weight": "small", "leaders": ["WMT", "COST", "PG"]},
    {"symbol": "XLI", "sector": "Industrials", "weight": "small", "leaders": ["CAT", "GE"]},
    {"symbol": "XLE", "sector": "Energy", "weight": "small", "leaders": ["XOM", "CVX"]},
    {"symbol": "XLC", "sector": "Communication", "weight": "medium", "leaders": ["META", "GOOGL"]},
    {"symbol": "XLRE", "sector": "Real Estate", "weight": "small", "leaders": ["PLD", "AMT"]},
    {"symbol": "XLU", "sector": "Utilities", "weight": "small", "leaders": ["NEE", "SO"]},
    {"symbol": "XLB", "sector": "Materials", "weight": "small", "leaders": ["LIN", "APD"]},
]
