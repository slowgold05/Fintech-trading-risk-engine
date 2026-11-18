"""Rank eligible stock price moves within a common session pair."""

from decimal import Decimal

from sqlalchemy.orm import Session

from app.schemas.night_market import Screener, ScreenerItem
from app.services.night_market_prices import read_session_moves
from app.services.symbol_quote import SUPPORTED_DETAIL_SYMBOLS

_SORT_KEY = {
    "move_desc": lambda row: (-row.move, row.symbol),
    "move_asc": lambda row: (row.move, row.symbol),
    "symbol": lambda row: row.symbol,
}


def read_screener(
    db: Session, *, sector: str, min_move: Decimal | None, sort: str, limit: int, offset: int
) -> Screener:
    snapshot = read_session_moves(db, sector)
    matched = [
        row for row in snapshot.stocks if min_move is None or row.move >= min_move
    ]
    matched.sort(key=_SORT_KEY[sort])
    return Screener(
        **snapshot.counts().model_dump(),
        matched_count=len(matched),
        items=[
            ScreenerItem(
                symbol=row.symbol, name=row.name, sector=row.sector, close=row.close, move=row.move,
                detail_available=row.symbol in SUPPORTED_DETAIL_SYMBOLS, source=row.source,
            )
            for row in matched[offset:offset + limit]
        ],
        limit=limit,
        offset=offset,
    )
