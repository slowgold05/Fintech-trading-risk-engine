import time
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_fundamentals_cache import MarketFundamentalsCache
from app.models.market_symbol import MarketSymbol

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
_ticker_cache: tuple[dict[str, dict], float] | None = None


def _headers() -> dict[str, str]:
    return {
        "User-Agent": settings.sec_user_agent,
        "Accept-Encoding": "gzip, deflate",
    }


def _get_ticker_map() -> dict[str, dict]:
    global _ticker_cache
    if _ticker_cache and _ticker_cache[1] > time.time():
        return _ticker_cache[0]

    response = requests.get(SEC_TICKERS_URL, headers=_headers(), timeout=30)
    response.raise_for_status()
    ticker_map = {
        item["ticker"].upper(): item
        for item in response.json().values()
    }
    _ticker_cache = (ticker_map, time.time() + 86400)
    return ticker_map


def _latest_fact(facts: dict, concepts: list[str], unit: str = "USD") -> float | None:
    for concept in concepts:
        units = facts.get("us-gaap", {}).get(concept, {}).get("units", {})
        candidates = units.get(unit) or next(iter(units.values()), [])
        valid = [item for item in candidates if item.get("val") is not None and item.get("end")]
        if valid:
            latest = max(valid, key=lambda item: (item.get("end", ""), item.get("filed", "")))
            return float(latest["val"])
    return None


def _parse_company_facts(data: dict, ticker: str, cik: str) -> dict:
    facts = data.get("facts", {})
    revenue = _latest_fact(facts, ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet"])
    net_income = _latest_fact(facts, ["NetIncomeLoss", "ProfitLoss"])
    assets = _latest_fact(facts, ["Assets"])
    liabilities = _latest_fact(facts, ["Liabilities"])
    equity = _latest_fact(facts, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"])
    eps = _latest_fact(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares")

    return {
        "symbol": ticker,
        "cik": cik,
        "name": data.get("entityName"),
        "revenue": revenue,
        "net_income": net_income,
        "profit_margin": (net_income / revenue) if revenue and net_income is not None else None,
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "eps": eps,
        "source": "SEC EDGAR",
    }


def get_sec_company_fundamentals(symbol: str, db: Session) -> dict:
    symbol = symbol.upper().strip()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    cached = db.get(MarketFundamentalsCache, symbol)
    if cached and cached.fetched_at >= cutoff:
        return cached.payload

    ticker_record = _get_ticker_map().get(symbol)
    if not ticker_record:
        raise ValueError(f"SEC company record not found for {symbol}.")

    cik = str(ticker_record["cik_str"]).zfill(10)
    response = requests.get(
        SEC_COMPANY_FACTS_URL.format(cik=cik),
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    payload = _parse_company_facts(response.json(), symbol, cik)

    if cached is None:
        cached = MarketFundamentalsCache(symbol=symbol, cik=cik, payload=payload)
        db.add(cached)
    else:
        cached.cik = cik
        cached.payload = payload
        cached.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)

    market_symbol = db.get(MarketSymbol, symbol)
    if market_symbol:
        market_symbol.cik = cik

    db.commit()
    return payload
