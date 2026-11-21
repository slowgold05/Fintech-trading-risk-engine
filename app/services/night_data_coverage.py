"""Coverage of stored market data at one read-only snapshot."""

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo

from sqlalchemy import distinct, func, or_, select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_filings_cache import MarketFilingsCache
from app.models.market_news_cache import MarketNewsCache
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.schemas.night_data_coverage import (
    Coverage, CoverageReport, HistoryCoverage, Provenance,
    QuoteCensus, ReferenceCoverage, ReferenceObservation, SymbolCoverage, SymbolHistory,
    SymbolQuote, UniverseCoverage,
)
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.market_cache_service import _freshness, latest_entitled_session
from app.services.market_history import QUOTE_CENSUS_BATCH, _invalid_quote
from app.services.simulated_liquidity import is_confirmed_close
from app.services.symbol_quote import SUPPORTED_DETAIL_SYMBOLS


_NEW_YORK = ZoneInfo("America/New_York")
_RAW_EOD_SOURCES = frozenset({"yahoo", "massive"})
_RECENT_SESSIONS = 20
_QuoteState = Literal["missing", "invalid", "fresh_eod", "stale", "unconfirmed_or_other"]


class UnknownSymbol(Exception):
    """The requested listing is absent from the stored universe."""


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _population():
    # Same US listing population as the market quote census.
    return (
        MarketSymbol.is_active.is_(True)
        & MarketSymbol.is_test.is_(False)
        & MarketSymbol.is_etf.is_(False)
    )


def _quote_state(quote, tier: str, clock: datetime, expected: date) -> tuple[_QuoteState, date | None]:
    if quote is None or quote.source is None:
        return "missing", None
    if _invalid_quote(quote.price, quote.quote_at, quote.fetched_at, clock):
        return "invalid", None
    if quote.source not in _RAW_EOD_SOURCES or not is_confirmed_close(quote):
        return "unconfirmed_or_other", None

    # Cache writers normalize daily quote dates to midnight UTC. That date is
    # the provider's session label, so a time-zone conversion would shift it.
    session = quote.quote_at.date()
    try:
        is_entitled_session = session <= expected and is_nyse_trading_day(session)
    except ValueError:
        # The standard calendar cannot verify this older observation.
        is_entitled_session = False
    if not is_entitled_session:
        return "unconfirmed_or_other", None
    freshness, _ = _freshness(quote, tier or "daily", now=clock)
    if session < expected or freshness == "stale":
        return "stale", session
    return "fresh_eod", session


def _quote_census(db: Session, clock: datetime, expected: date) -> tuple[int, QuoteCensus]:
    stmt = (
        select(
            MarketSymbol.refresh_tier, MarketQuoteCache.price, MarketQuoteCache.source,
            MarketQuoteCache.quote_at, MarketQuoteCache.fetched_at,
        )
        .select_from(MarketSymbol)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .where(_population())
        .execution_options(yield_per=QUOTE_CENSUS_BATCH)
    )
    counts: Counter[_QuoteState] = Counter()
    with db.execute(stmt) as rows:
        for row in rows:
            state, _ = _quote_state(row, row.refresh_tier, clock, expected)
            counts[state] += 1
    eligible = sum(counts.values())
    return eligible, QuoteCensus(present=eligible - counts["missing"], **{
        state: counts[state]
        for state in ("missing", "invalid", "fresh_eod", "stale", "unconfirmed_or_other")
    })


def _history_census(db: Session, clock: datetime, expected: date, symbol: str | None):
    bar = MarketBarDaily
    in_population = _population()
    selected = bar.symbol == symbol
    valid = in_population & (bar.quality_status == "valid")
    stmt = (
        select(
            bar.provider, bar.adjustment_type,
            func.count(distinct(bar.symbol)).filter(valid).label("valid_symbols"),
            func.count().filter(valid).label("valid_rows"),
            func.count().filter(in_population, bar.quality_status == "flagged").label("flagged_rows"),
            func.count().filter(in_population, bar.quality_status == "rejected").label("rejected_rows"),
            func.max(bar.session_date).filter(valid).label("latest_valid_session"),
            func.count(distinct(bar.symbol)).filter(valid, bar.session_date == expected)
            .label("valid_symbols_on_expected_session"),
            func.count().filter(selected).label("selected_rows"),
        )
        .join(MarketSymbol, MarketSymbol.symbol == bar.symbol)
        .where(or_(in_population, selected), bar.fetched_at <= _utc(clock))
        .group_by(bar.provider, bar.adjustment_type)
        .order_by(bar.provider, bar.adjustment_type)
    )
    history = []
    symbol_series = []
    for row in db.execute(stmt):
        if row.valid_rows or row.flagged_rows or row.rejected_rows:
            history.append(HistoryCoverage(
                provider=row.provider, basis=row.adjustment_type,
                valid_symbols=row.valid_symbols, valid_rows=row.valid_rows,
                flagged_rows=row.flagged_rows, rejected_rows=row.rejected_rows,
                latest_valid_session=row.latest_valid_session,
                valid_symbols_on_expected_session=row.valid_symbols_on_expected_session,
            ))
        if row.selected_rows:
            # Find even older series in the aggregate scan. The detail lookup
            # can then use the primary key on (symbol, session_date, ...).
            symbol_series.append((row.provider, row.adjustment_type))
    return history, symbol_series


def _reference_observation(db: Session, model, clock: datetime) -> ReferenceObservation:
    count, latest = db.execute(
        select(func.count(), func.max(model.fetched_at)).where(model.fetched_at <= clock)
    ).one()
    return ReferenceObservation(cached_rows=count, latest_observed_at=_utc(latest) if latest else None)


def _recent_sessions(expected: date) -> list[date]:
    sessions = []
    day = expected
    while len(sessions) < _RECENT_SESSIONS:
        if is_nyse_trading_day(day):
            sessions.append(day)
        day -= timedelta(days=1)
    return list(reversed(sessions))


def _symbol_history(db: Session, symbol: str, series, clock: datetime, expected: date) -> list[SymbolHistory]:
    if not series:
        return []
    sessions = _recent_sessions(expected)
    bar = MarketBarDaily
    stmt = select(bar.provider, bar.adjustment_type, bar.session_date, bar.quality_status).where(
        bar.symbol == symbol, bar.session_date.in_(sessions), bar.fetched_at <= _utc(clock),
    )
    observed = {key: set() for key in series}
    flagged = {key: set() for key in series}
    for provider, basis, session, quality in db.execute(stmt):
        key = (provider, basis)
        if quality == "valid":
            observed[key].add(session)
        else:
            flagged[key].add(session)
    return [
        SymbolHistory(
            provider=key[0], basis=key[1], start=sessions[0], end=sessions[-1],
            expected_sessions=len(sessions), observed_sessions=len(observed[key]),
            missing_recent_sessions=[session for session in sessions if session not in observed[key]],
            flagged_or_rejected_sessions=len(flagged[key]),
        )
        for key in series
    ]


def _symbol_coverage(db: Session, listing: MarketSymbol, series, clock: datetime, expected: date) -> SymbolCoverage:
    supported = listing.is_active and not listing.is_test and listing.symbol in SUPPORTED_DETAIL_SYMBOLS
    quote = db.get(MarketQuoteCache, listing.symbol)
    state, session = _quote_state(quote, listing.refresh_tier, clock, expected)
    reasons = []
    detail_quote = None
    if state == "missing":
        reasons.append("No stored execution reference quote.")
    elif state == "invalid":
        reasons.append("The stored execution reference quote is invalid.")
    else:
        execution_reference, coverage = {
            "fresh_eod": ("eligible", "available"),
            "stale": ("stale", "stale"),
            "unconfirmed_or_other": ("unconfirmed", "partial"),
        }[state]
        if supported and state == "stale":
            reasons.append("The raw execution reference is stale.")
        elif supported and state == "unconfirmed_or_other":
            reasons.append("No confirmed raw execution reference.")
        detail_quote = SymbolQuote(
            price=quote.price,
            source=Provenance(
                provider=quote.source, basis="raw", session_date=session,
                observed_at=_utc(quote.fetched_at), coverage=coverage,
            ),
            execution_reference=execution_reference if supported else "unsupported",
        )
    if not supported:
        reasons.append("This listing is outside the supported company universe.")
    if all(basis != "raw" for _, basis in series):
        reasons.append("No raw history.")
    return SymbolCoverage(
        symbol=listing.symbol, quote=detail_quote,
        history=_symbol_history(db, listing.symbol, series, clock, expected),
        reason=" ".join(reasons) or None,
    )


def _coverage(eligible: int, quotes: QuoteCensus, history: list[HistoryCoverage]) -> Coverage:
    dated_symbols = max((row.valid_symbols_on_expected_session for row in history), default=0)
    if eligible and quotes.fresh_eod == dated_symbols == eligible:
        return "available"
    if quotes.fresh_eod or dated_symbols:
        return "partial"
    if quotes.stale or any(row.valid_rows for row in history):
        return "stale"
    return "partial" if quotes.unconfirmed_or_other else "missing"


def read_coverage(db: Session, symbol: str | None) -> CoverageReport:
    with consistent_read(db):
        clock = snapshot_clock(db)
        expected = latest_entitled_session(_utc(clock).astimezone(_NEW_YORK).date())
        listing = None
        if symbol is not None:
            listing = db.get(MarketSymbol, symbol)
            if listing is None:
                raise UnknownSymbol

        eligible, quotes = _quote_census(db, clock, expected)
        history, symbol_series = _history_census(db, clock, expected, symbol)
        return CoverageReport(
            read_at=_utc(clock), expected_session=expected,
            coverage=_coverage(eligible, quotes, history),
            universe=UniverseCoverage(eligible=eligible), quotes=quotes, history=history,
            reference=ReferenceCoverage(
                news=_reference_observation(db, MarketNewsCache, clock),
                filings=_reference_observation(db, MarketFilingsCache, clock),
            ),
            symbol=_symbol_coverage(db, listing, symbol_series, clock, expected) if listing is not None else None,
        )
