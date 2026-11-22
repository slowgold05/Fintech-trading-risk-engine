from typing import Annotated

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_trader
from app.models.user import User
from app.routers.night_holding_errors import NightHoldingRoute, holding_not_found, holding_symbol
from app.schemas.night_holding_notes import HoldingNote, HoldingNotePut
from app.services.night_holding_notes import (
    IneligibleHoldingNote, delete_holding_note, read_holding_note, save_holding_note,
)


router = APIRouter(prefix="/night/holdings", route_class=NightHoldingRoute, tags=["Holding details"])


@router.get("/{symbol}/note", response_model=HoldingNote)
def get_note(
    owner: Annotated[User, Depends(get_current_trader)],
    symbol: Annotated[str, Depends(holding_symbol)],
    db: Annotated[Session, Depends(get_db)],
) -> HoldingNote:
    try:
        return read_holding_note(db, owner.id, symbol)
    except IneligibleHoldingNote:
        raise holding_not_found() from None


@router.put("/{symbol}/note", response_model=HoldingNote)
def put_note(
    owner: Annotated[User, Depends(get_current_trader)],
    symbol: Annotated[str, Depends(holding_symbol)],
    db: Annotated[Session, Depends(get_db)],
    payload: HoldingNotePut,
) -> HoldingNote:
    try:
        return save_holding_note(db, owner.id, symbol, payload.text)
    except IneligibleHoldingNote:
        raise holding_not_found() from None


@router.delete("/{symbol}/note", status_code=204, response_class=Response)
def remove_note(
    owner: Annotated[User, Depends(get_current_trader)],
    symbol: Annotated[str, Depends(holding_symbol)],
    db: Annotated[Session, Depends(get_db)],
) -> Response:
    try:
        delete_holding_note(db, owner.id, symbol)
    except IneligibleHoldingNote:
        raise holding_not_found() from None
    return Response(status_code=204)
