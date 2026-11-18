from datetime import datetime, timezone
from math import isfinite

import requests
from fastapi import APIRouter, Depends, Header, Query
from sqlalchemy import and_, case, func, or_
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.services.featured_market import INDEX_SYMBOLS, SECTOR_SYMBOLS
from app.services.history_series import read_history_quotes
from app.services.market_cache_service import MASSIVE_EOD_NOTICE, get_cached_heatmap
from app.services.market_news_service import get_market_news
from app.services.price_service import (
    get_company_overview,
    get_stock_quote,
    get_top_gainers_losers,
)
from app.services.research_valuation import build_research_valuation
from app.services.sec_service import get_sec_company_fundamentals
from app.services.sector_classifier import infer_sector
from app.services.symbol_quote import SUPPORTED_DETAIL_SYMBOLS, detail_available_symbols

router = APIRouter()

def _to_float(value) -> float | None:
    if value in (None, "", "None", "-"):
        return None
    try:
        number = float(str(value).replace("%", ""))
        return number if isfinite(number) else None
    except ValueError:
        return None


def _format_mover(item: dict, detail_symbols: frozenset[str] = frozenset()) -> dict:
    price = _to_float(item.get("price"))
    volume = str(item.get("volume", "")).strip()
    return {
        "symbol": item.get("ticker", ""),
        "detail_available": item.get("ticker", "") in detail_symbols,
        "price": price if price is not None and price > 0 else None,
        "change_amount": _to_float(item.get("change_amount")),
        "change_percent": _to_float(item.get("change_percentage")),
        "volume": int(volume) if volume.isdecimal() else None,
    }


def _score_company_research(overview: dict, quote: dict | None) -> tuple[int | None, str | None, list[str]]:
    score = 50
    factors = []
    pe_ratio = _to_float(overview.get("PERatio"))
    profit_margin = _to_float(overview.get("ProfitMargin"))
    beta = _to_float(overview.get("Beta"))
    analyst_target = _to_float(overview.get("AnalystTargetPrice"))
    current_price = _to_float(quote.get("price")) if quote else None
    has_target_comparison = analyst_target is not None and analyst_target > 0 and current_price is not None and current_price > 0
    if not ((pe_ratio is not None and pe_ratio > 0) or profit_margin is not None or beta is not None or has_target_comparison):
        return None, None, []

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

    if has_target_comparison:
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
    massive_quotes = False
    requested_symbols = [item["symbol"] for item in INDEX_SYMBOLS + SECTOR_SYMBOLS]
    cached_quotes = {
        quote.symbol: quote
        for quote in db.query(MarketQuoteCache)
        .filter(MarketQuoteCache.symbol.in_(requested_symbols))
        .all()
    }
    cached_quotes.update(read_history_quotes(db, set(requested_symbols) - cached_quotes.keys()))
    latest = None

    for item in INDEX_SYMBOLS:
        quote = cached_quotes.get(item["symbol"])
        if quote is None:
            errors.append({"symbol": item["symbol"], "detail": "Cached quote is unavailable."})
            continue

        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        trend = {
            "symbol": item["display_symbol"],
            "source_symbol": item["symbol"],
            "name": item["name"],
            "value": round(float(quote.price), 2),
            "change": round(float(quote.change_amount), 4),
            "change_percent": round(float(quote.change_percent), 4),
        }
        if hasattr(quote, "adjustment_type"):
            trend.update(source=quote.source, adjustment_type=quote.adjustment_type, price_basis="end_of_day_open_to_close")
        elif quote.source == "massive":
            massive_quotes = True
            trend["price_basis"] = "end_of_day_previous_close"
        trends.append(trend)

    for item in SECTOR_SYMBOLS:
        quote = cached_quotes.get(item["symbol"])
        if quote is None:
            errors.append({"symbol": item["symbol"], "detail": "Cached quote is unavailable."})
            continue

        if quote.quote_at is not None:
            latest = max(latest, quote.quote_at) if latest else quote.quote_at
        sector = {
            "symbol": item["symbol"],
            "sector": item["sector"],
            "change_percent": round(float(quote.change_percent), 4),
            "weight": item["weight"],
            "leaders": item["leaders"],
        }
        if hasattr(quote, "adjustment_type"):
            sector.update(source=quote.source, adjustment_type=quote.adjustment_type, price_basis="end_of_day_open_to_close")
        elif quote.source == "massive":
            massive_quotes = True
            sector["price_basis"] = "end_of_day_previous_close"
        sectors.append(sector)

    payload = {
        "as_of": latest.replace(tzinfo=timezone.utc).isoformat() if latest else None,
        "trends": trends,
        "sectors": sectors,
        "errors": errors,
    }
    if massive_quotes:
        payload["data_notice"] = MASSIVE_EOD_NOTICE
    return payload


@router.get("/news")
def market_news(db: Session = Depends(get_db)):
    return get_market_news(db, settings.finnhub_api_key)


def _cached_trending(db: Session) -> dict:
    now = datetime.now(timezone.utc)
    quotes = (
        db.query(MarketQuoteCache)
        .join(MarketSymbol, MarketSymbol.symbol == MarketQuoteCache.symbol)
        .filter(
            MarketQuoteCache.symbol.in_(SUPPORTED_DETAIL_SYMBOLS),
            MarketQuoteCache.quote_at <= now.replace(tzinfo=None),
            MarketQuoteCache.fetched_at <= now.replace(tzinfo=None),
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
        )
        .all()
    )
    eligible = [quote for quote in quotes if (_to_float(quote.price) or 0) > 0]
    session = max((quote.quote_at.date() for quote in eligible), default=None)
    current = [quote for quote in eligible if quote.quote_at.date() == session]
    movers = [
        _format_mover({
            "ticker": quote.symbol, "price": quote.price, "change_amount": quote.change_amount,
            "change_percentage": quote.change_percent, "volume": quote.volume,
        }, SUPPORTED_DETAIL_SYMBOLS)
        for quote in current
    ]
    gainers = [mover for mover in movers if (mover["change_percent"] or 0) > 0]
    losers = [mover for mover in movers if (mover["change_percent"] or 0) < 0]
    active = [mover for mover in movers if (mover["volume"] or 0) > 0]
    return {
        "source": "featured_universe_cached_quotes",
        "session_date": session.isoformat() if session else None,
        "as_of": max((quote.fetched_at for quote in current)).replace(tzinfo=timezone.utc).isoformat() if current else None,
        "top_gainers": sorted(gainers, key=lambda mover: (-mover["change_percent"], mover["symbol"]))[:8],
        "top_losers": sorted(losers, key=lambda mover: (mover["change_percent"], mover["symbol"]))[:8],
        "most_active": sorted(active, key=lambda mover: (-mover["volume"], mover["symbol"]))[:8],
        "errors": [] if current else [{"detail": "Featured-universe cached quotes are unavailable."}],
    }


@router.get("/trending")
def market_trending(db: Session = Depends(get_db)):
    if not (settings.alpha_vantage_api_key or "").strip():
        return _cached_trending(db)
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

    groups = {
        "top_gainers": data.get("top_gainers", [])[:8],
        "top_losers": data.get("top_losers", [])[:8],
        "most_active": data.get("most_actively_traded", [])[:8],
    }
    # Provider movers are not limited to the symbols the detail page can read.
    detail_symbols = detail_available_symbols(
        db,
        [item.get("ticker") for items in groups.values() for item in items],
    )
    return {
        "as_of": datetime.now(timezone.utc).isoformat(),
        **{
            name: [_format_mover(item, detail_symbols) for item in items]
            for name, items in groups.items()
        },
        "errors": [],
    }


@router.get("/heatmap")
def market_heatmap(
    limit: int = Query(default=1000, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    return get_cached_heatmap(db, limit=limit)


OUTSIDE_FEATURED_UNIVERSE_LABEL = "Outside S&P 500"


def _featured_universe_tickers() -> frozenset[str]:
    return SUPPORTED_DETAIL_SYMBOLS


def _universe_viewer(db: Session, authorization: str | None) -> User | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return None
    user_id = decode_access_token(token.strip())
    if user_id is None:
        return None
    return db.query(User).filter(User.id == user_id).one_or_none()


def _held_tickers(db: Session, user: User | None) -> set[str]:
    if user is None:
        return set()
    rows = (
        db.query(Asset.symbol)
        .join(Holding, Holding.asset_id == Asset.id)
        .filter(Holding.user_id == user.id, Holding.quantity > 0)
        .all()
    )
    return {symbol for (symbol,) in rows}


def _universe_item(item: MarketSymbol, featured: set[str]) -> dict:
    in_featured = item.symbol in featured
    return {
        "symbol": item.symbol,
        "company_name": item.company_name,
        "exchange": item.exchange,
        "sector": infer_sector(item.symbol, item.company_name, item.sector),
        "is_etf": item.is_etf,
        "refresh_tier": item.refresh_tier,
        "in_featured_universe": in_featured,
        "universe_label": None if in_featured else OUTSIDE_FEATURED_UNIVERSE_LABEL,
    }


@router.get("/universe")
def market_universe(
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None, max_length=50),
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    featured = _featured_universe_tickers()
    held = _held_tickers(db, _universe_viewer(db, authorization))
    visible = featured | held
    query = db.query(MarketSymbol).filter(MarketSymbol.is_active.is_(True))
    term = search.strip() if search else ""
    if term:
        pattern = f"%{term}%"
        name_or_symbol = or_(
            MarketSymbol.symbol.ilike(pattern),
            MarketSymbol.company_name.ilike(pattern),
        )
        # A non-member is returned only for an exact ticker, or when this user holds it.
        query = query.filter(
            or_(
                and_(MarketSymbol.symbol.in_(visible), name_or_symbol),
                and_(
                    func.upper(MarketSymbol.symbol) == term.upper(),
                    MarketSymbol.symbol.notin_(featured),
                ),
            )
        )
    else:
        query = query.filter(MarketSymbol.symbol.in_(visible))

    total = query.count()
    # Held names sort first so one offset/limit ordering never repeats a row.
    if held:
        query = query.order_by(
            case((MarketSymbol.symbol.in_(held), 0), else_=1),
            MarketSymbol.symbol,
        )
    else:
        query = query.order_by(MarketSymbol.symbol)
    rows = query.offset(offset).limit(limit).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [_universe_item(item, featured) for item in rows],
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

    valuation = build_research_valuation(
        db,
        normalized_symbol,
        overview,
        sec_fundamentals,
        quote_getter=get_stock_quote,
    )
    quote = valuation["quote"]
    errors.extend(valuation["errors"])
    profit_margin = _to_float(sec_fundamentals.get("profit_margin"))
    profit_margin_period = sec_fundamentals.get("profit_margin_period")
    if profit_margin is None or not isinstance(profit_margin_period, dict):
        profit_margin_period = None
    if profit_margin is None:
        profit_margin = _to_float(overview.get("ProfitMargin"))
        profit_margin_period = None
    scoring_overview = dict(overview, ProfitMargin=profit_margin)
    if valuation["pe_basis"] is not None:
        scoring_overview["PERatio"] = valuation["pe_ratio"]
    score, label, factors = _score_company_research(scoring_overview, quote)
    return {
        "symbol": normalized_symbol,
        "detail_available": normalized_symbol in detail_available_symbols(db, [normalized_symbol]),
        "name": sec_fundamentals.get("name") or overview.get("Name"),
        "exchange": overview.get("Exchange"),
        "sector": overview.get("Sector"),
        "industry": overview.get("Industry"),
        "market_cap": valuation["market_cap"],
        "market_cap_basis": valuation["market_cap_basis"],
        "pe_ratio": valuation["pe_ratio"],
        "pe_basis": valuation["pe_basis"],
        "price_basis": valuation["price_basis"],
        "price_as_of": valuation["price_as_of"],
        **({key: valuation[key] for key in ("price_source", "adjustment_type")} if "price_source" in valuation else {}),
        "valuation_notice": valuation["valuation_notice"],
        "profit_margin": profit_margin,
        "profit_margin_period": profit_margin_period,
        "beta": _to_float(overview.get("Beta")),
        "analyst_target_price": _to_float(overview.get("AnalystTargetPrice")),
        "price": valuation["price"],
        "change_percent": valuation["change_percent"],
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
