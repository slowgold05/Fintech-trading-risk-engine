"""Cached canonical history and public market-data status.

Reads use one database snapshot and the existing quote-freshness policy.
No provider is called and nothing is written. Coverage is not a claim that
an exchange calendar or a two-year series has been verified.
"""

from datetime import date, datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.read_snapshot import SnapshotClockError, consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.price_history_daily import PriceHistoryDaily
from app.services.market_cache_service import _freshness

PRICE_QUANTUM = Decimal("0.000001")
SYMBOL_MAX_LENGTH = 20
PROVIDER_MAX_LENGTH = 32
QUOTE_CENSUS_BATCH = 500
SUPPORTED_INTERVALS = frozenset({"1d"})
SUPPORTED_RANGES = frozenset({"2y"})
SUPPORTED_ADJUSTMENTS = frozenset({"raw", "split_adjusted"})
FRESHNESS_STATUSES = ("live-ish", "delayed", "cached", "stale")
QUALITY_STATUSES = ("valid", "flagged", "rejected")
# Canonical-history ingestion is off. This does not describe quote refresh.
COLLECTION = "disabled"
COVERAGE_STATUS = "not_verified"


def two_calendar_years_before(day: date) -> date:
    """Inclusive start of a two-calendar-year window. 29 February falls back to 28 February."""
    try:
        return day.replace(year=day.year - 2)
    except ValueError:
        return date(day.year - 2, 2, 28)


def read_data_status(db: Session) -> dict:
    with consistent_read(db):
        return _data_status(db)


def read_symbol_history(
    db: Session,
    *,
    symbol: str,
    interval: str,
    range_token: str,
    provider: str,
    adjustment_type: str,
) -> dict:
    _validate_history_query(
        symbol=symbol,
        interval=interval,
        range_token=range_token,
        provider=provider,
        adjustment_type=adjustment_type,
    )
    with consistent_read(db):
        return _symbol_history(
            db,
            symbol=symbol,
            interval=interval,
            provider=provider,
            adjustment_type=adjustment_type,
        )


def _validate_history_query(
    *,
    symbol: str,
    interval: str,
    range_token: str,
    provider: str,
    adjustment_type: str,
) -> None:
    _require_unpadded(symbol, field="symbol", max_length=SYMBOL_MAX_LENGTH)
    _require_unpadded(provider, field="provider", max_length=PROVIDER_MAX_LENGTH)
    if interval not in SUPPORTED_INTERVALS:
        raise HTTPException(status_code=422, detail="interval must be 1d.")
    if range_token not in SUPPORTED_RANGES:
        raise HTTPException(status_code=422, detail="range must be 2y.")
    if adjustment_type not in SUPPORTED_ADJUSTMENTS:
        raise HTTPException(status_code=422, detail="adjustment_type must be raw or split_adjusted.")


def _require_unpadded(value: str, *, field: str, max_length: int) -> None:
    if not isinstance(value, str) or value == "" or value != value.strip() or len(value) > max_length:
        raise HTTPException(
            status_code=422,
            detail=f"{field} must be a nonempty unpadded value of at most {max_length} characters.",
        )


def _data_status(db: Session) -> dict:
    # Pin a precise clock first. Later aggregates stay on that snapshot.
    clock = _read_clock(db)
    universe_count = db.execute(
        select(func.count())
        .select_from(MarketSymbol)
        .where(MarketSymbol.is_active.is_(True), MarketSymbol.is_test.is_(False))
    ).scalar_one()

    quality_rows = db.execute(
        select(
            MarketBarDaily.provider,
            MarketBarDaily.adjustment_type,
            MarketBarDaily.quality_status,
            func.count(),
        )
        .group_by(
            MarketBarDaily.provider,
            MarketBarDaily.adjustment_type,
            MarketBarDaily.quality_status,
        )
        .order_by(
            MarketBarDaily.provider.asc(),
            MarketBarDaily.adjustment_type.asc(),
            MarketBarDaily.quality_status.asc(),
        )
    ).all()
    span_rows = db.execute(
        select(
            MarketBarDaily.provider,
            MarketBarDaily.adjustment_type,
            func.count(func.distinct(MarketBarDaily.symbol)),
            func.min(MarketBarDaily.session_date),
            func.max(MarketBarDaily.session_date),
        )
        .group_by(MarketBarDaily.provider, MarketBarDaily.adjustment_type)
        .order_by(MarketBarDaily.provider.asc(), MarketBarDaily.adjustment_type.asc())
    ).all()
    legacy_count = db.execute(select(func.count()).select_from(PriceHistoryDaily)).scalar_one()
    quote_census = _quote_census(db, clock)
    canonical = _canonical_history(quality_rows, span_rows)

    return {
        "read_at": _iso_z(clock),
        "collection": COLLECTION,
        "coverage_status": COVERAGE_STATUS,
        "expected_session_count": None,
        "universe": {"active_non_test_symbols": int(universe_count or 0)},
        "quote_census": quote_census,
        "canonical_history": canonical,
        "legacy_price_history_daily": {"row_count": int(legacy_count or 0)},
    }


def _quote_census(db: Session, clock: datetime) -> dict:
    """Stream the non-ETF census once. Counters stay fixed-size as the universe grows."""
    quote_stmt = (
        select(
            MarketSymbol.refresh_tier,
            MarketQuoteCache.price,
            MarketQuoteCache.source,
            MarketQuoteCache.quote_at,
            MarketQuoteCache.fetched_at,
        )
        .select_from(MarketSymbol)
        .outerjoin(MarketQuoteCache, MarketQuoteCache.symbol == MarketSymbol.symbol)
        .where(
            MarketSymbol.is_active.is_(True),
            MarketSymbol.is_test.is_(False),
            MarketSymbol.is_etf.is_(False),
        )
    )
    eligible = 0
    cached = 0
    missing = 0
    invalid = 0
    status_counts = {name: 0 for name in FRESHNESS_STATUSES}
    # fetchmany keeps one batch resident. Do not unique() the rows: two symbols
    # can share a tier and an empty quote and must still count separately.
    result = db.execute(quote_stmt.execution_options(stream_results=True))
    try:
        while True:
            batch = result.fetchmany(QUOTE_CENSUS_BATCH)
            if not batch:
                break
            for row in batch:
                eligible += 1
                if row.price is None and row.source is None:
                    missing += 1
                    continue
                cached += 1
                if _invalid_quote(row.price, row.quote_at, row.fetched_at, clock):
                    invalid += 1
                    continue
                status, _age = _freshness(
                    SimpleNamespace(source=row.source, quote_at=_naive_utc(row.quote_at)),
                    row.refresh_tier or "daily",
                    now=clock,
                )
                status_counts[status if status in status_counts else "stale"] += 1
    finally:
        result.close()

    return {
        "population": "active_non_test_non_etf",
        "sector_filter_applied": False,
        "eligible_symbol_count": eligible,
        "cached_quote_rows": cached,
        "missing_cache_rows": missing,
        "invalid_quote_rows": invalid,
        "status_counts": status_counts,
    }


def _canonical_history(quality_rows, span_rows) -> dict:
    series: dict[tuple[str, str], dict] = {}
    totals = {name: 0 for name in QUALITY_STATUSES}
    row_count = 0
    for provider, adjustment_type, quality_status, count in quality_rows:
        count = int(count)
        entry = series.setdefault(
            (provider, adjustment_type),
            {
                "provider": provider,
                "adjustment_type": adjustment_type,
                "row_count": 0,
                "quality_counts": {name: 0 for name in QUALITY_STATUSES},
                "symbol_count": 0,
                "stored_session_start": None,
                "stored_session_end": None,
            },
        )
        entry["row_count"] += count
        row_count += count
        if quality_status not in entry["quality_counts"]:
            raise HTTPException(status_code=500, detail="Canonical quality status is not recognized.")
        entry["quality_counts"][quality_status] += count
        totals[quality_status] += count

    for provider, adjustment_type, symbol_count, session_start, session_end in span_rows:
        entry = series.setdefault(
            (provider, adjustment_type),
            {
                "provider": provider,
                "adjustment_type": adjustment_type,
                "row_count": 0,
                "quality_counts": {name: 0 for name in QUALITY_STATUSES},
                "symbol_count": 0,
                "stored_session_start": None,
                "stored_session_end": None,
            },
        )
        entry["symbol_count"] = int(symbol_count or 0)
        entry["stored_session_start"] = _date_text(session_start) if session_start is not None else None
        entry["stored_session_end"] = _date_text(session_end) if session_end is not None else None

    return {
        "row_count": row_count,
        "quality_counts": totals,
        "series": list(series.values()),
    }


def _symbol_history(
    db: Session,
    *,
    symbol: str,
    interval: str,
    provider: str,
    adjustment_type: str,
) -> dict:
    clock = _read_clock(db)
    known = db.execute(
        select(MarketSymbol.symbol).where(MarketSymbol.symbol == symbol)
    ).first()
    if known is None:
        raise HTTPException(status_code=404, detail="Unknown symbol.")

    end = clock.date()
    start = two_calendar_years_before(end)
    # Inclusive session bounds stay in SQL. The primary key already makes a
    # session unique for this symbol, provider, and adjustment.
    rows = db.execute(
        select(
            MarketBarDaily.session_date,
            MarketBarDaily.open.label("open_price"),
            MarketBarDaily.high.label("high_price"),
            MarketBarDaily.low.label("low_price"),
            MarketBarDaily.close.label("close_price"),
            MarketBarDaily.volume.label("volume_shares"),
            MarketBarDaily.fetched_at,
            MarketBarDaily.quality_status,
            MarketBarDaily.provider,
            MarketBarDaily.adjustment_type,
        )
        .where(
            MarketBarDaily.symbol == symbol,
            MarketBarDaily.provider == provider,
            MarketBarDaily.adjustment_type == adjustment_type,
            MarketBarDaily.session_date >= start,
            MarketBarDaily.session_date <= end,
        )
        .order_by(MarketBarDaily.session_date.asc())
    )

    bars = []
    excluded = 0
    for row in rows:
        session_date = _as_date(row.session_date)
        fetched_at = _naive_utc(row.fetched_at)
        if row.quality_status != "valid" or session_date is None or fetched_at is None or fetched_at > clock:
            excluded += 1
            continue
        bars.append({
            "session_date": session_date.isoformat(),
            "open": _price_text(row.open_price),
            "high": _price_text(row.high_price),
            "low": _price_text(row.low_price),
            "close": _price_text(row.close_price),
            "volume": _volume_text(row.volume_shares),
            "fetched_at": _iso_z(row.fetched_at),
            "provider": row.provider,
            "adjustment_type": row.adjustment_type,
            "quality_status": "valid",
        })

    available_start = bars[0]["session_date"] if bars else None
    available_end = bars[-1]["session_date"] if bars else None
    return {
        "symbol": symbol,
        "interval": interval,
        "range": "2y",
        "provider": provider,
        "adjustment_type": adjustment_type,
        "status": "partial" if bars else "unavailable",
        "coverage_status": COVERAGE_STATUS,
        "expected_session_count": None,
        "collection": COLLECTION,
        "read_at": _iso_z(clock),
        "requested_start": start.isoformat(),
        "requested_end": end.isoformat(),
        "available_start": available_start,
        "available_end": available_end,
        "excluded_row_count": excluded,
        "bars": bars,
    }


def _invalid_quote(price, quote_at, fetched_at, clock: datetime) -> bool:
    try:
        number = price if isinstance(price, Decimal) else Decimal(str(price))
    except (InvalidOperation, ValueError, TypeError):
        return True
    if not number.is_finite() or number <= 0:
        return True
    for stamp in (quote_at, fetched_at):
        observed = _naive_utc(stamp)
        if observed is not None and observed > clock:
            return True
    return False


def _read_clock(db: Session) -> datetime:
    try:
        return snapshot_clock(db)
    except SnapshotClockError as exc:
        raise HTTPException(status_code=500, detail="Market read clock is missing.") from exc


def _naive_utc(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = value.strip().replace("Z", "+00:00")
        if " " in parsed and "T" not in parsed:
            parsed = parsed.replace(" ", "T", 1)
        try:
            value = datetime.fromisoformat(parsed)
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _as_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def _date_text(value: object) -> str:
    parsed = _as_date(value)
    if parsed is None:
        raise HTTPException(status_code=500, detail="Canonical session date is missing.")
    return parsed.isoformat()


def _iso_z(value: object) -> str:
    naive = _naive_utc(value)
    if naive is None:
        raise HTTPException(status_code=500, detail="Canonical fetch time is missing.")
    return naive.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")


def _price_text(value: object) -> str:
    try:
        number = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail="Canonical price is not a decimal.") from exc
    if not number.is_finite():
        raise HTTPException(status_code=500, detail="Canonical price is not a finite decimal.")
    return format(number.quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _volume_text(value: object) -> str:
    try:
        number = int(value)
    except (TypeError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="Canonical volume is not an integer.") from exc
    if number < 0:
        raise HTTPException(status_code=500, detail="Canonical volume is negative.")
    return str(number)
