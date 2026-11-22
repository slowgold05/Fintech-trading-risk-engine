from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.routers.night_holding_errors import NightHoldingRoute, holding_not_found, holding_symbol, invalid_request
from app.schemas.night_holding_lots import HoldingLots
from app.services.night_holding_lots import IneligibleHolding, InvalidHoldingCursor, read_holding_lots


router = APIRouter(prefix="/night/holdings", route_class=NightHoldingRoute, tags=["Holding details"])


@router.get("/{symbol}/lots", response_model=HoldingLots)
def get_holding_lots(
    owner: Annotated[User, Depends(get_current_user)],
    symbol: Annotated[str, Depends(holding_symbol)],
    db: Annotated[Session, Depends(get_db)],
    lot_cursor: Annotated[str | None, Query(max_length=128)] = None,
    sale_cursor: Annotated[str | None, Query(max_length=128)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 25,
) -> HoldingLots:
    try:
        return read_holding_lots(db, owner.id, symbol, lot_cursor, sale_cursor, limit)
    except IneligibleHolding:
        raise holding_not_found() from None
    except InvalidHoldingCursor as exc:
        raise invalid_request({exc.field: "Invalid cursor for this holding and list."}) from None
