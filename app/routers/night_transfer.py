from fastapi import APIRouter, Depends, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy import select
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.database import get_db
from app.core.read_snapshot import consistent_read
from app.core.security import get_current_trader
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.models.watchlist import WatchlistItem
from app.routers.watchlists import _MEMBER_CAP, _lock_owned, _one, _watchlist_transaction
from app.schemas.night_transfer import TransferError, WatchlistImport, WatchlistImportResult, WatchlistImportRow
from app.schemas.watchlist import WatchlistOut


_ERROR_CODES = {
    401: "authentication_required",
    403: "forbidden",
    404: "watchlist_not_found",
    409: "watchlist_capacity",
    503: "storage_unavailable",
}


class _TransferRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                fields = {}
                for error in exc.errors():
                    location = error["loc"]
                    field = location[1] if len(location) > 1 else "body"
                    if field not in WatchlistImport.model_fields:
                        field = "body"
                    fields.setdefault(field, error["msg"])
                raise HTTPException(422, detail={
                    "code": "invalid_request", "message": "Check the CSV import inputs.", "fields": fields,
                }) from None
            except HTTPException as exc:
                if exc.status_code == 400:
                    raise HTTPException(422, detail={
                        "code": "invalid_request", "message": "Send a valid JSON request body.",
                    }) from None
                code = _ERROR_CODES.get(exc.status_code)
                if code is None:
                    raise
                raise HTTPException(exc.status_code, detail={"code": code, "message": exc.detail},
                                    headers=exc.headers) from None
            except (InterfaceError, OperationalError, TimeoutError):
                raise HTTPException(503, detail={
                    "code": "storage_unavailable", "message": "Watchlist storage is temporarily unavailable.",
                }) from None

        return handle


router = APIRouter(
    route_class=_TransferRoute,
    responses={code: {"model": TransferError} for code in (*_ERROR_CODES, 422)},
)


def _plan_rows(db: Session, watchlist: WatchlistOut, values: list[str]) -> list[WatchlistImportRow]:
    normalized = [value.strip().upper() for value in values]
    existing = {item.symbol for item in watchlist.symbols}
    candidates = {symbol for symbol in normalized if 1 <= len(symbol) <= 20 and "\x00" not in symbol}
    active = set(db.scalars(select(MarketSymbol.symbol).where(
        MarketSymbol.symbol.in_(candidates - existing),
        MarketSymbol.is_active.is_(True),
    )))
    eligible = existing | active
    seen: set[str] = set()
    rows = []
    # API row numbers count CSV records, with the header as record 1.
    for row, symbol in enumerate(normalized, start=2):
        if symbol not in eligible:
            outcome = "invalid"
        elif symbol in seen:
            outcome = "duplicate"
        else:
            seen.add(symbol)
            outcome = "existing" if symbol in existing else "add"
        rows.append(WatchlistImportRow(row=row, symbol=symbol, status=outcome))
    return rows


@router.post("/watchlist-import", response_model=WatchlistImportResult)
def import_watchlist(
    payload: WatchlistImport,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_trader),
):
    owner_id = int(current_user.id)
    watchlist_id = payload.watchlist_id
    if payload.dry_run:
        with consistent_read(db):
            watchlist = _one(db, owner_id, watchlist_id)
            rows = _plan_rows(db, watchlist, payload.symbols)
            return WatchlistImportResult(rows=rows, added=0, watchlist=watchlist)

    with _watchlist_transaction(db):
        _lock_owned(db, owner_id, watchlist_id)
        watchlist = _one(db, owner_id, watchlist_id)
        rows = _plan_rows(db, watchlist, payload.symbols)
        additions = [row.symbol for row in rows if row.status == "add"]
        if len(watchlist.symbols) + len(additions) > _MEMBER_CAP:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="A watchlist cannot have more than 50 symbols",
            )
        last_position = max((item.position for item in watchlist.symbols), default=0)
        db.add_all(
            WatchlistItem(watchlist_id=watchlist_id, symbol=symbol, position=position)
            for position, symbol in enumerate(additions, start=last_position + 1)
        )
        if additions:
            db.flush()
            watchlist = _one(db, owner_id, watchlist_id)
        return WatchlistImportResult(rows=rows, added=len(additions), watchlist=watchlist)
