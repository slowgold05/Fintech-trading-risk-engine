from datetime import datetime, timezone

import requests
from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.services.market_cache_service import get_cached_heatmap
from app.services.price_service import (
    get_company_overview,
    get_stock_quote,
    get_top_gainers_losers,
)
from app.services.sec_service import get_sec_company_fundamentals
from app.services.sector_classifier import infer_sector

router = APIRouter()

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


def _quote_or_error(symbol: str) -> tuple[dict | None, str | None]:
    try:
        return get_stock_quote(symbol), None
    except ValueError as exc:
        return None, str(exc)


def _to_float(value) -> float | None:
    if value in (None, "", "None", "-"):
        return None
    try:
        return float(str(value).replace("%", ""))
    except ValueError:
        return None


def _format_mover(item: dict) -> dict:
    return {
        "symbol": item.get("ticker", ""),
        "price": _to_float(item.get("price")) or 0.0,
        "change_amount": _to_float(item.get("change_amount")) or 0.0,
        "change_percent": _to_float(item.get("change_percentage")) or 0.0,
        "volume": int(_to_float(item.get("volume")) or 0),
    }


def _score_company_research(overview: dict, quote: dict | None) -> tuple[int, str, list[str]]:
    score = 50
    factors = []
    pe_ratio = _to_float(overview.get("PERatio"))
    profit_margin = _to_float(overview.get("ProfitMargin"))
    beta = _to_float(overview.get("Beta"))
    analyst_target = _to_float(overview.get("AnalystTargetPrice"))
    current_price = _to_float(quote.get("price")) if quote else None

    if pe_ratio is not None:
        if pe_ratio > 45:
            score += 12
            factors.append("High valuation multiple")
        elif 0 < pe_ratio < 18:
            score -= 6
            factors.append("Moderate valuation multiple")

    if profit_margin is not None:
        if profit_margin < 0:
            score += 14
            factors.append("Negative profit margin")
        elif profit_margin > 0.15:
            score -= 8
            factors.append("Healthy profit margin")

    if beta is not None:
        if beta > 1.5:
            score += 10
            factors.append("High beta volatility")
        elif beta < 0.9:
            score -= 4
            factors.append("Lower beta volatility")

    if analyst_target and current_price:
        upside = ((analyst_target - current_price) / current_price) * 100
        if upside < -10:
            score += 8
            factors.append("Analyst target below current price")
        elif upside > 15:
            score -= 5
            factors.append("Analyst target implies upside")

    score = max(0, min(100, score))
    label = "Low" if score < 40 else "Medium" if score < 70 else "High"
    return score, label, factors[:5]


@router.get("/overview")
def market_overview(db: Session = Depends(get_db)):
    trends = []
    sectors = []
    errors = []
    requested_symbols = [item["symbol"] for item in INDEX_SYMBOLS + SECTOR_SYMBOLS]
    cached_quotes = {
        quote.symbol: quote
        for quote in db.query(MarketQuoteCache)
        .filter(MarketQuoteCache.symbol.in_(requested_symbols))
        .all()
    }
    latest = None

    for item in INDEX_SYMBOLS:
        quote = cached_quotes.get(item["symbol"])
        if quote is None:
            errors.append({"symbol": item["symbol"], "detail": "Cached quote is unavailable."})
            continue

        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        trends.append({
            "symbol": item["display_symbol"],
            "source_symbol": item["symbol"],
            "name": item["name"],
            "value": round(float(quote.price), 2),
            "change": round(float(quote.change_amount), 4),
            "change_percent": round(float(quote.change_percent), 4),
        })

    for item in SECTOR_SYMBOLS:
        quote = cached_quotes.get(item["symbol"])
        if quote is None:
            errors.append({"symbol": item["symbol"], "detail": "Cached quote is unavailable."})
            continue

        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        sectors.append({
            "symbol": item["symbol"],
            "sector": item["sector"],
            "change_percent": round(float(quote.change_percent), 4),
            "weight": item["weight"],
            "leaders": item["leaders"],
        })

    return {
        "as_of": latest.replace(tzinfo=timezone.utc).isoformat() if latest else None,
        "trends": trends,
        "sectors": sectors,
        "errors": errors,
    }


@router.get("/trending")
def market_trending():
    try:
        data = get_top_gainers_losers()
    except ValueError as exc:
        return {
            "as_of": datetime.now(timezone.utc).isoformat(),
            "top_gainers": [],
            "top_losers": [],
            "most_active": [],
            "errors": [{"detail": str(exc)}],
        }

    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        "top_gainers": [_format_mover(item) for item in data.get("top_gainers", [])[:8]],
        "top_losers": [_format_mover(item) for item in data.get("top_losers", [])[:8]],
        "most_active": [_format_mover(item) for item in data.get("most_actively_traded", [])[:8]],
        "errors": [],
    }


@router.get("/heatmap")
def market_heatmap(
    limit: int = Query(default=1000, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return get_cached_heatmap(db, limit=limit)


@router.get("/universe")
def market_universe(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=50),
    db: Session = Depends(get_db),
):
    query = db.query(MarketSymbol).filter(MarketSymbol.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        query = query.filter(
            or_(
                MarketSymbol.symbol.like(pattern),
                MarketSymbol.company_name.like(pattern),
            )
        )

    total = query.count()
    rows = query.order_by(MarketSymbol.symbol).offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "symbol": item.symbol,
                "company_name": item.company_name,
                "exchange": item.exchange,
                "sector": infer_sector(item.symbol, item.company_name, item.sector),
                "is_etf": item.is_etf,
                "refresh_tier": item.refresh_tier,
            }
            for item in rows
        ],
    }


@router.get("/research/{symbol}")
def market_research(symbol: str, db: Session = Depends(get_db)):
    normalized_symbol = symbol.upper().strip()
    quote = None
    overview = {}
    sec_fundamentals = {}
    errors = []

    try:
        overview = get_company_overview(normalized_symbol)
    except ValueError as exc:
        errors.append({"source": "Alpha Vantage", "detail": str(exc)})

    try:
        sec_fundamentals = get_sec_company_fundamentals(normalized_symbol, db)
    except (ValueError, requests.RequestException) as exc:
        errors.append({"source": "SEC EDGAR", "detail": str(exc)})

    quote, quote_error = _quote_or_error(normalized_symbol)
    scoring_overview = dict(overview)
    if not scoring_overview.get("ProfitMargin") and sec_fundamentals.get("profit_margin") is not None:
        scoring_overview["ProfitMargin"] = sec_fundamentals["profit_margin"]
    score, label, factors = _score_company_research(scoring_overview, quote)
    if quote_error:
        errors.append({"source": "Alpha Vantage quote", "detail": quote_error})

    return {
        "symbol": normalized_symbol,
        "name": sec_fundamentals.get("name") or overview.get("Name"),
        "exchange": overview.get("Exchange"),
        "sector": overview.get("Sector"),
        "industry": overview.get("Industry"),
        "market_cap": _to_float(overview.get("MarketCapitalization")),
        "pe_ratio": _to_float(overview.get("PERatio")),
        "profit_margin": sec_fundamentals.get("profit_margin") or _to_float(overview.get("ProfitMargin")),
        "beta": _to_float(overview.get("Beta")),
        "analyst_target_price": _to_float(overview.get("AnalystTargetPrice")),
        "price": quote.get("price") if quote else None,
        "change_percent": quote.get("change_percent") if quote else None,
        "research_risk_score": score,
        "research_risk_label": label,
        "risk_factors": factors,
        "description": overview.get("Description"),
        "fundamentals": {
            "revenue": sec_fundamentals.get("revenue"),
            "net_income": sec_fundamentals.get("net_income"),
            "assets": sec_fundamentals.get("assets"),
            "liabilities": sec_fundamentals.get("liabilities"),
            "equity": sec_fundamentals.get("equity"),
            "eps": sec_fundamentals.get("eps"),
            "source": sec_fundamentals.get("source"),
        },
        "errors": errors,
    }
