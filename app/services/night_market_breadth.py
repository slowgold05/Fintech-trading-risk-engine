"""Read stock breadth and compatible sector ETF price moves."""

from collections import defaultdict
from statistics import median

from sqlalchemy.orm import Session

from app.schemas.night_market import Breadth, BreadthItem, SectorBreadth
from app.services.featured_market import SECTOR_SYMBOLS
from app.services.night_market_prices import Move, read_session_moves
from app.services.sector_classifier import SECTOR_ORDER

_PROXIES = {
    ("Consumer Discretionary" if item["symbol"] == "XLY" else item["sector"]): item["symbol"]
    for item in SECTOR_SYMBOLS
}
_SECTOR_RANK = {name: index for index, name in enumerate(SECTOR_ORDER)}


def _breadth_item(row: Move) -> BreadthItem:
    return BreadthItem(symbol=row.symbol, move=row.move, source=row.source)


def read_breadth(db: Session, *, sector: str) -> Breadth:
    snapshot = read_session_moves(db, sector, proxy_symbols=tuple(_PROXIES.values()))
    totals = snapshot.counts()
    stocks = sorted(snapshot.stocks, key=lambda row: row.symbol)
    advancing = sum(row.move > 0 for row in stocks)
    declining = sum(row.move < 0 for row in stocks)
    moves_by_sector = defaultdict(list)
    for row in stocks:
        moves_by_sector[row.sector or "Other"].append(row.move)

    sectors = []
    names = {name or "Other" for name in snapshot.universe}
    for name in sorted(names, key=lambda label: (_SECTOR_RANK.get(label, len(_SECTOR_RANK)), label)):
        moves = moves_by_sector[name]
        proxy_symbol = _PROXIES.get(name)
        proxy = snapshot.proxies.get(proxy_symbol) if proxy_symbol else None
        sectors.append(SectorBreadth(
            sector=name, covered=len(moves), median_move=median(moves) if moves else None,
            proxy=_breadth_item(proxy) if proxy else None,
            proxy_symbol=proxy_symbol, proxy_coverage="available" if proxy else "missing",
        ))

    return Breadth(
        **totals.model_dump(),
        excluded_count=totals.universe_count - totals.covered_count,
        advancing=advancing, declining=declining, flat=totals.covered_count - advancing - declining,
        sectors=sectors, items=[_breadth_item(row) for row in stocks],
    )
