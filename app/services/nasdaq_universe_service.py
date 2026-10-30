import csv
from datetime import datetime, timezone
from io import StringIO

import requests
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.services.sector_classifier import infer_sector

NASDAQ_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"

EXCHANGE_NAMES = {
    "A": "NYSE American",
    "N": "NYSE",
    "P": "NYSE Arca",
    "V": "IEX",
    "Z": "Cboe BZX",
}

# These liquid names get the frequent refresh tier and sector placement first.
FEATURED_SECTORS = {
    "Technology": ["NVDA", "AAPL", "MSFT", "AVGO", "AMD", "MU", "INTC", "ORCL", "CRM", "ADBE", "QCOM", "TXN", "AMAT", "LRCX"],
    "Communication": ["GOOGL", "META", "NFLX", "DIS", "TMUS", "VZ", "T"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE", "SBUX", "LOW", "F", "GM"],
    "Consumer Staples": ["WMT", "COST", "PG", "KO", "PEP", "MO"],
    "Financials": ["JPM", "BRK.B", "V", "MA", "BAC", "WFC", "MS", "GS"],
    "Healthcare": ["LLY", "JNJ", "UNH", "ABBV", "MRK", "PFE", "TMO"],
    "Industrials": ["CAT", "GE", "HON", "UPS"],
    "Energy": ["XOM", "CVX", "COP", "SLB"],
    "Utilities": ["NEE", "SO", "DUK"],
    "Real Estate": ["PLD", "AMT", "EQIX"],
    "Materials": ["LIN", "APD", "SHW"],
}

HOT_SYMBOLS = {
    symbol
    for symbols in FEATURED_SECTORS.values()
    for symbol in symbols
}
HOT_SYMBOLS.update({
    "SPY", "QQQ", "DIA", "IWM",
    "XLK", "XLF", "XLV", "XLY", "XLP", "XLI",
    "XLE", "XLC", "XLRE", "XLU", "XLB",
})


def _heatmap_size(symbol: str, position: int) -> str:
    if symbol in {"NVDA", "AAPL", "MSFT", "GOOGL", "AMZN"}:
        return "mega"
    if position < 3:
        return "large"
    if position < 6:
        return "medium"
    return "small"


FEATURED_METADATA = {
    symbol: {"sector": sector, "heatmap_size": _heatmap_size(symbol, position)}
    for sector, symbols in FEATURED_SECTORS.items()
    for position, symbol in enumerate(symbols)
}


def _download_rows(url: str) -> list[dict[str, str]]:
    response = requests.get(url, timeout=30)
    response.raise_for_status()
    reader = csv.DictReader(StringIO(response.text), delimiter="|")
    return [row for row in reader if row and "File Creation Time" not in str(row)]


def _normalize_rows() -> list[dict]:
    normalized = []

    for row in _download_rows(NASDAQ_LISTED_URL):
        symbol = (row.get("Symbol") or "").strip()
        if not symbol:
            continue
        normalized.append({
            "symbol": symbol,
            "company_name": (row.get("Security Name") or symbol).strip(),
            "exchange": "Nasdaq",
            "is_etf": row.get("ETF") == "Y",
            "is_test": row.get("Test Issue") == "Y",
        })

    for row in _download_rows(OTHER_LISTED_URL):
        symbol = (row.get("NASDAQ Symbol") or row.get("ACT Symbol") or "").strip()
        if not symbol:
            continue
        exchange_code = (row.get("Exchange") or "").strip()
        normalized.append({
            "symbol": symbol,
            "company_name": (row.get("Security Name") or symbol).strip(),
            "exchange": EXCHANGE_NAMES.get(exchange_code, exchange_code or "Other"),
            "is_etf": row.get("ETF") == "Y",
            "is_test": row.get("Test Issue") == "Y",
        })

    return normalized


def sync_nasdaq_universe(db: Session) -> dict[str, int]:
    rows = _normalize_rows()
    existing = {item.symbol: item for item in db.query(MarketSymbol).all()}
    seen = set()
    created = 0
    updated = 0
    synced_at = datetime.now(timezone.utc).replace(tzinfo=None)

    for row in rows:
        symbol = row["symbol"]
        seen.add(symbol)
        metadata = FEATURED_METADATA.get(symbol, {})
        item = existing.get(symbol)
        if item is None:
            item = MarketSymbol(symbol=symbol)
            db.add(item)
            created += 1
        else:
            updated += 1

        item.company_name = row["company_name"]
        item.exchange = row["exchange"]
        item.is_etf = row["is_etf"]
        item.is_test = row["is_test"]
        item.is_active = not row["is_test"]
        item.refresh_tier = "hot" if symbol in HOT_SYMBOLS else "daily"
        item.sector = metadata.get("sector") or infer_sector(symbol, row["company_name"], item.sector)
        item.heatmap_size = metadata.get("heatmap_size", item.heatmap_size or "micro")
        item.source = "nasdaq_trader"
        item.synced_at = synced_at

    for symbol, item in existing.items():
        if item.source == "nasdaq_trader" and symbol not in seen:
            item.is_active = False

    db.commit()
    return {"created": created, "updated": updated, "total": len(rows)}
