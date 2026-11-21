"""A consistent end-of-day session pair for screener and breadth."""

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily as Bar
from app.models.market_symbol import MarketSymbol
from app.schemas.night_market import PriceBasis, Provenance, SessionCoverage
from app.services.night_market_common import counted_coverage, market_error, price_return, utc

_EXCHANGE_ZONE = ZoneInfo("America/New_York")
_STOCK = (
    MarketSymbol.is_active.is_(True),
    MarketSymbol.is_test.is_(False),
    MarketSymbol.is_etf.is_(False),
)


@dataclass(frozen=True)
class Move:
    symbol: str
    name: str
    sector: str | None
    close: Decimal
    move: Decimal
    source: Provenance


@dataclass(frozen=True)
class SessionMoves:
    session_date: date | None
    previous_session_date: date | None
    universe: dict[str | None, int]
    sector: str | None
    stocks: list[Move]
    proxies: dict[str, Move]

    def counts(self) -> SessionCoverage:
        total = sum(self.universe.values())
        return SessionCoverage(
            session_date=self.session_date,
            previous_session_date=self.previous_session_date,
            universe_count=total,
            covered_count=len(self.stocks),
            coverage=counted_coverage(len(self.stocks), total),
        )


def usable_bars(clock: datetime):
    # The daily bar constraints guarantee finite, positive OHLC values.
    return (
        Bar.quality_status == "valid",
        Bar.fetched_at <= utc(clock),
        Bar.session_date <= utc(clock).astimezone(_EXCHANGE_ZONE).date(),
    )


def _scope_sector(universe: dict[str | None, int], sector: str) -> str | None:
    if not sector:
        return None
    # "Other" includes stocks without a stored classification.
    names = {(name or "Other").casefold(): name or "Other" for name in universe}
    name = names.get(sector.strip().casefold())
    if name is None:
        message = "Choose a sector from the current stock universe."
        raise market_error(422, "invalid_request", message, {"sector": message})
    return name


def _series_rank(series: tuple[str, PriceBasis], count: int):
    provider, basis = series
    return (-count, basis != "split_adjusted", provider != "massive", provider)


def read_session_moves(
    db: Session, sector: str, *, proxy_symbols: tuple[str, ...] = ()
) -> SessionMoves:
    with consistent_read(db):
        universe = dict(db.execute(
            select(MarketSymbol.sector, func.count()).where(*_STOCK).group_by(MarketSymbol.sector)
        ).all())
        selected_sector = _scope_sector(universe, sector)
        scoped_universe = {
            name: count for name, count in universe.items()
            if selected_sector is None or (name or "Other") == selected_sector
        }

        usable = usable_bars(snapshot_clock(db))
        days = list(db.scalars(
            select(Bar.session_date)
            .join(MarketSymbol, MarketSymbol.symbol == Bar.symbol)
            .where(*_STOCK, *usable)
            .distinct()
            .order_by(Bar.session_date.desc())
            .limit(2)
        ))
        if len(days) < 2:
            return SessionMoves(days[0] if days else None, None, scoped_universe, selected_sector, [], {})

        latest, previous = days
        rows = db.execute(
            select(
                Bar.symbol, Bar.provider, Bar.adjustment_type, Bar.session_date,
                Bar.close, Bar.fetched_at, MarketSymbol.company_name, MarketSymbol.sector, MarketSymbol.is_etf,
            )
            .join(MarketSymbol, MarketSymbol.symbol == Bar.symbol)
            .where(
                *usable, Bar.session_date.in_(days),
                MarketSymbol.is_active.is_(True), MarketSymbol.is_test.is_(False),
                (~MarketSymbol.is_etf) | (MarketSymbol.is_etf & Bar.symbol.in_(proxy_symbols)),
            )
        )
        by_series = defaultdict(dict)
        for row in rows:
            by_series[(row.symbol, row.provider, row.adjustment_type)][row.session_date] = row

        stocks_by_series = Counter()
        for (_, provider, basis), dated in by_series.items():
            if len(dated) == 2 and not dated[latest].is_etf:
                stocks_by_series[provider, basis] += 1
        if not stocks_by_series:
            return SessionMoves(latest, previous, scoped_universe, selected_sector, [], {})

        provider, basis = min(stocks_by_series, key=lambda series: _series_rank(series, stocks_by_series[series]))
        stocks, proxies = [], {}
        for (symbol, row_provider, row_basis), dated in by_series.items():
            if (row_provider, row_basis) != (provider, basis) or len(dated) != 2:
                continue
            current, prior = dated[latest], dated[previous]
            if not current.is_etf and current.sector not in scoped_universe:
                continue
            move = Move(
                symbol=symbol, name=current.company_name, sector=current.sector, close=current.close,
                move=price_return(current.close, prior.close),
                source=Provenance(
                    provider=provider, basis=basis, session_date=latest,
                    observed_at=utc(max(current.fetched_at, prior.fetched_at)), coverage="available",
                ),
            )
            if current.is_etf:
                proxies[symbol] = move
            else:
                stocks.append(move)

        return SessionMoves(latest, previous, scoped_universe, selected_sector, stocks, proxies)
