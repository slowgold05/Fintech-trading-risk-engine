"""Public cached market status and daily history. No provider and no writes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.services.market_history import read_data_status, read_symbol_history

router = APIRouter()


@router.get("/data-status")
def data_status(db: Session = Depends(get_db)):
    return read_data_status(db)


@router.get("/symbols/{symbol}/history")
def symbol_history(
    symbol: str,
    interval: str = Query(...),
    range_token: str = Query(..., alias="range"),
    provider: str = Query(...),
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
