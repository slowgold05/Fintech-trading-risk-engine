from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.schemas.night_data_coverage import CoverageReport, NightError
from app.services.night_data_coverage import UnknownSymbol, read_coverage
from app.services.symbol_quote import _normalize


router = APIRouter()


@router.get(
    "/night/data-coverage",
    response_model=CoverageReport,
    responses={status: {"model": NightError} for status in (404, 422, 503)},
)
def data_coverage(symbol: str | None = None, db: Session = Depends(get_db)) -> CoverageReport:
    if symbol is not None:
        try:
            symbol = _normalize(symbol)
        except HTTPException as exc:
            raise HTTPException(422, detail={
                "code": "invalid_request",
                "message": "Invalid symbol.",
                "fields": {"symbol": exc.detail},
            }) from None
    try:
        return read_coverage(db, symbol)
    except UnknownSymbol:
        raise HTTPException(404, detail={
            "code": "not_found",
            "message": "Unknown symbol.",
        }) from None
    except (SQLAlchemyError, SnapshotClockError):
        raise HTTPException(503, detail={
            "code": "storage_unavailable",
            "message": "Market coverage is temporarily unavailable.",
        }) from None
