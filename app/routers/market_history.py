"""Public cached market status and daily history. No provider and no writes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.history_series import AUTO
from app.services.market_history import read_data_status, read_symbol_history
from app.services.market_indicators import read_symbol_indicators
from app.services.symbol_quote import read_symbol_quote

router = APIRouter()


@router.get("/data-status")
def data_status(db: Session = Depends(get_db)):
    return read_data_status(db)


@router.get("/symbols/{symbol}/quote")
def symbol_quote(symbol: str, db: Session = Depends(get_db)):
    """Identity plus the latest MarketQuoteCache row. No provider call and no write."""
    return read_symbol_quote(db, symbol)


@router.get("/symbols/{symbol}/history")
def symbol_history(
    symbol: str,
    interval: str = Query(...),
    range_token: str = Query(..., alias="range"),
    provider: str = Query(AUTO),
    adjustment_type: str = Query(...),
    db: Session = Depends(get_db),
):
    return read_symbol_history(
        db,
        symbol=symbol,
        interval=interval,
        range_token=range_token,
        provider=provider,
        adjustment_type=adjustment_type,
    )


@router.get("/symbols/{symbol}/indicators")
def symbol_indicators(
    symbol: str,
    interval: str = Query(...),
    range_token: str = Query(..., alias="range"),
    provider: str = Query(AUTO),
    adjustment_type: str = Query(...),
    name: str = Query(...),
    period: str = Query(...),
    db: Session = Depends(get_db),
):
    return read_symbol_indicators(
        db,
        symbol=symbol,
        interval=interval,
        range_token=range_token,
        provider=provider,
        adjustment_type=adjustment_type,
        name=name,
        period=period,
    )
