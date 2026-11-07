from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Path, Response, status
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.read_snapshot import consistent_read
from app.core.security import get_current_user
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.models.watchlist import Watchlist, WatchlistItem
from app.schemas.watchlist import (
    WatchlistCollection,
    WatchlistCreate,
    WatchlistOut,
    WatchlistPatch,
    WatchlistSymbolCreate,
    WatchlistSymbolOut,
)

router = APIRouter(dependencies=[Depends(get_current_user)])

_LIST_CAP = 20
_MEMBER_CAP = 50
_BUSY = "Watchlist update is temporarily unavailable. Retry."
_NAME_EXISTS = "Watchlist name already exists"
_NOT_FOUND = "Watchlist not found"
_SYMBOL_MISSING = "Symbol not found on watchlist"
_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"


@contextmanager
def _watchlist_transaction(db: Session):
    """Drop the auth read and run this request in one fresh transaction."""
    db.rollback()
    try:
        bind = db.get_bind()
        if bind is not None and bind.dialect.name == "sqlite":
            _begin_sqlite_immediate(db)
        yield
        db.commit()
    except Exception as exc:
        db.rollback()
        if _is_sqlite_busy(db, exc):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=_BUSY) from None
        raise


def _begin_sqlite_immediate(db: Session) -> None:
    connection = db.connection()
    driver = connection.connection.driver_connection
    if driver.in_transaction:
        connection.exec_driver_sql("ROLLBACK")
    connection.exec_driver_sql("BEGIN IMMEDIATE")


def _is_sqlite_busy(db: Session, exc: BaseException) -> bool:
    if not isinstance(exc, OperationalError):
        return False
    bind = db.get_bind()
    if bind is None or bind.dialect.name != "sqlite":
        return False
    orig = getattr(exc, "orig", None)
    if getattr(orig, "sqlite_errorcode", None) in {5, 6}:
        return True
    message = str(orig or "").lower()
    return message.startswith("database is locked") or message.startswith("database is busy")


def _is_name_conflict(exc: IntegrityError) -> bool:
    orig = getattr(exc, "orig", None)
    constraint = getattr(getattr(orig, "diag", None), "constraint_name", None)
    if constraint == "uq_watchlists_user_name":
        return True
    message = str(orig or "")
    if "uq_watchlists_user_name" in message:
        return True
    return "watchlists.user_id" in message and "watchlists.name" in message


def _lock_owner(db: Session, owner_id: int) -> None:
    found = db.execute(select(User.id).where(User.id == owner_id).with_for_update()).scalar_one_or_none()
    if found is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")


def _lock_owned(db: Session, owner_id: int, watchlist_id: int) -> Watchlist:
    row = db.execute(
        select(Watchlist).where(Watchlist.id == watchlist_id, Watchlist.user_id == owner_id).with_for_update()
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return row


def _read_watchlists(db: Session, owner_id: int, watchlist_id: int | None = None) -> list[WatchlistOut]:
    stmt = (
        select(Watchlist.id, Watchlist.name, WatchlistItem.symbol, WatchlistItem.position)
        .outerjoin(WatchlistItem, WatchlistItem.watchlist_id == Watchlist.id)
        .where(Watchlist.user_id == owner_id)
        .order_by(Watchlist.id, WatchlistItem.position, WatchlistItem.symbol)
    )
    if watchlist_id is not None:
        stmt = stmt.where(Watchlist.id == watchlist_id)
    grouped: dict[int, WatchlistOut] = {}
    order: list[int] = []
    for list_id, name, symbol, position in db.execute(stmt):
        found = grouped.get(list_id)
        if found is None:
            found = WatchlistOut(id=list_id, name=name, symbols=[])
            grouped[list_id] = found
            order.append(list_id)
        if symbol is not None:
            found.symbols.append(WatchlistSymbolOut(symbol=symbol, position=position))
    return [grouped[list_id] for list_id in order]


def _one(db: Session, owner_id: int, watchlist_id: int) -> WatchlistOut:
    rows = _read_watchlists(db, owner_id, watchlist_id)
    if not rows:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOT_FOUND)
    return rows[0]


def _raise_name_conflict(exc: IntegrityError) -> None:
    if _is_name_conflict(exc):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_EXISTS) from None
    raise exc


def _path_symbol(symbol: str) -> str:
    cleaned = symbol.strip().upper()
    if not 1 <= len(cleaned) <= 20:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="symbol must contain 1 to 20 characters")
    return cleaned


@router.get("", response_model=WatchlistCollection)
def list_watchlists(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    owner_id = int(current_user.id)
    with consistent_read(db):
        return WatchlistCollection(watchlists=_read_watchlists(db, owner_id))


@router.post("", response_model=WatchlistOut, status_code=status.HTTP_201_CREATED)
def create_watchlist(
    payload: WatchlistCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    with _watchlist_transaction(db):
        _lock_owner(db, owner_id)
        count = db.execute(select(func.count()).select_from(Watchlist).where(Watchlist.user_id == owner_id)).scalar_one()
        if count >= _LIST_CAP:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user cannot have more than 20 watchlists")
        taken = db.execute(
            select(Watchlist.id).where(Watchlist.user_id == owner_id, Watchlist.name == payload.name)
        ).scalar_one_or_none()
        if taken is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_EXISTS)
        row = Watchlist(user_id=owner_id, name=payload.name)
        db.add(row)
        try:
            db.flush()
        except IntegrityError as exc:
            _raise_name_conflict(exc)
        return _one(db, owner_id, int(row.id))


@router.patch("/{watchlist_id}", response_model=WatchlistOut)
def patch_watchlist(
    payload: WatchlistPatch,
    watchlist_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    with _watchlist_transaction(db):
        if payload.name is not None:
            _lock_owner(db, owner_id)
        row = _lock_owned(db, owner_id, watchlist_id)
        if payload.symbol_order is not None:
            items = db.execute(select(WatchlistItem).where(WatchlistItem.watchlist_id == row.id)).scalars().all()
            current = {item.symbol for item in items}
            if set(payload.symbol_order) != current or len(payload.symbol_order) != len(items):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="symbol_order must list the current symbols exactly",
                )
        else:
            items = []
        if payload.name is not None and payload.name != row.name:
            taken = db.execute(
                select(Watchlist.id).where(
                    Watchlist.user_id == owner_id,
                    Watchlist.name == payload.name,
                    Watchlist.id != row.id,
                )
            ).scalar_one_or_none()
            if taken is not None:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_NAME_EXISTS)
            row.name = payload.name
        if payload.symbol_order is not None:
            by_symbol = {item.symbol: item for item in items}
            for position, symbol in enumerate(payload.symbol_order, start=1):
                by_symbol[symbol].position = position
        try:
            db.flush()
        except IntegrityError as exc:
            _raise_name_conflict(exc)
        return _one(db, owner_id, int(row.id))


@router.delete("/{watchlist_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_watchlist(
    watchlist_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    with _watchlist_transaction(db):
        row = _lock_owned(db, owner_id, watchlist_id)
        db.execute(delete(WatchlistItem).where(WatchlistItem.watchlist_id == row.id))
        db.delete(row)
        db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{watchlist_id}/symbols", response_model=WatchlistOut)
def add_symbol(
    payload: WatchlistSymbolCreate,
    response: Response,
    watchlist_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    with _watchlist_transaction(db):
        row = _lock_owned(db, owner_id, watchlist_id)
        existing = db.execute(
            select(WatchlistItem.symbol).where(
                WatchlistItem.watchlist_id == row.id,
                WatchlistItem.symbol == payload.symbol,
            )
        ).scalar_one_or_none()
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return _one(db, owner_id, int(row.id))
        count = db.execute(
            select(func.count()).select_from(WatchlistItem).where(WatchlistItem.watchlist_id == row.id)
        ).scalar_one()
        if count >= _MEMBER_CAP:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A watchlist cannot have more than 50 symbols")
        active = db.execute(
            select(MarketSymbol.symbol).where(MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True))
        ).scalar_one_or_none()
        if active is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_UNKNOWN_SYMBOL)
        current_max = db.execute(
            select(func.max(WatchlistItem.position)).where(WatchlistItem.watchlist_id == row.id)
        ).scalar_one()
        db.add(WatchlistItem(watchlist_id=row.id, symbol=payload.symbol, position=int(current_max or 0) + 1))
        try:
            db.flush()
        except IntegrityError as exc:
            _raise_name_conflict(exc)
        response.status_code = status.HTTP_201_CREATED
        return _one(db, owner_id, int(row.id))


@router.delete("/{watchlist_id}/symbols/{symbol:path}", status_code=status.HTTP_204_NO_CONTENT)
def delete_symbol(
    symbol: str,
    watchlist_id: int = Path(..., gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    cleaned = _path_symbol(symbol)
    with _watchlist_transaction(db):
        row = _lock_owned(db, owner_id, watchlist_id)
        item = db.execute(
            select(WatchlistItem).where(WatchlistItem.watchlist_id == row.id, WatchlistItem.symbol == cleaned)
        ).scalar_one_or_none()
        if item is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_SYMBOL_MISSING)
        db.delete(item)
        db.flush()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
