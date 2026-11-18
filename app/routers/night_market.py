"""Public, cache-only endpoints registered by the integration app."""

from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.schemas import night_market as schema
from app.services.night_market_common import market_error


class NightMarketRoute(APIRoute):
    """Keep validation and storage error shapes local to these endpoints."""

    def get_route_handler(self):
        handle = super().get_route_handler()

        async def route(request: Request):
            try:
                return await handle(request)
            except RequestValidationError as exc:
                fields = {".".join(map(str, error["loc"][1:])): error["msg"] for error in exc.errors()}
                error = market_error(422, "invalid_request", "Check the request fields.", fields)
            except (InterfaceError, OperationalError, TimeoutError, SnapshotClockError):
                error = market_error(503, "storage_unavailable", "Market cache is temporarily unavailable.")
            return JSONResponse(status_code=error.status_code, content={"detail": error.detail})

        return route


router = APIRouter(
    prefix="/night",
    tags=["Night market"],
    route_class=NightMarketRoute,
    responses={
        404: {"model": schema.NightError},
        422: {"model": schema.NightError},
        503: {"model": schema.NightError},
    },
)

Db = Annotated[Session, Depends(get_db)]
SectorFilter = Annotated[str, Query(max_length=80)]
ArticleLimit = Annotated[int, Query(ge=1, le=50)]


@router.get("/screener", response_model=schema.Screener)
def screener(
    db: Db,
    sector: SectorFilter = "",
    min_move: Annotated[Decimal | None, Query(ge=-1, allow_inf_nan=False)] = None,
    sort: Literal["move_desc", "move_asc", "symbol"] = "move_desc",
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
):
    from app.services.night_market_screener import read_screener

    return read_screener(db, sector=sector, min_move=min_move, sort=sort, limit=limit, offset=offset)


@router.get("/compare", response_model=schema.Compare)
def compare(
    db: Db,
    symbols: Annotated[str, Query(min_length=3, max_length=100)],
    range_token: Annotated[str, Query(alias="range", pattern=r"^(1m|3m|1y)$")] = "3m",
    provider: Annotated[str, Query(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$")] = "auto",
):
    from app.services.night_market_compare import read_compare

    return read_compare(db, symbols=symbols, range_token=range_token, provider=provider)


@router.get("/breadth", response_model=schema.Breadth)
def breadth(db: Db, sector: SectorFilter = ""):
    from app.services.night_market_breadth import read_breadth

    return read_breadth(db, sector=sector)


@router.get("/news", response_model=schema.News)
def news(
    db: Db,
    symbol: Annotated[str, Query(max_length=20)] = "",
    limit: ArticleLimit = 20,
):
    from app.services.night_market_news import read_news

    return read_news(db, symbol=symbol, limit=limit)
