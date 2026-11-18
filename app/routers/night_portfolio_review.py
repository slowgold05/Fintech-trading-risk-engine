"""Independently mountable owner-scoped portfolio review routes."""

from collections.abc import Callable

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.night_portfolio_review import PortfolioInsights, PortfolioReview, Surface, Window
from app.services.market_providers import ProviderUnavailable
from app.services.night_portfolio_insights import RULES_VERSION, build_insights
from app.services.night_portfolio_review import build_review


def night_error(status: int, code: str, message: str, fields: dict[str, str] | None = None) -> JSONResponse:
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    return JSONResponse(status_code=status, content={"detail": detail})


class NightPortfolioRoute(APIRoute):
    def get_route_handler(self) -> Callable:
        handle = super().get_route_handler()

        async def wrapped(request: Request) -> Response:
            try:
                return await handle(request)
            except RequestValidationError as exc:
                fields = {
                    error["loc"][-1]: "Choose a supported value."
                    for error in exc.errors()
                    if error["loc"][-1] in {"window", "surface"}
                }
                return night_error(422, "invalid_request", "Invalid portfolio request.", fields)
            except (SQLAlchemyError, SnapshotClockError, ProviderUnavailable):
                return night_error(503, "storage_unavailable", "Portfolio data is temporarily unavailable.")
            except HTTPException as exc:
                if exc.status_code == 404:
                    return night_error(404, "not_found", "Portfolio not found.")
                if exc.status_code >= 500:
                    return night_error(503, "storage_unavailable", "Portfolio data is temporarily unavailable.")
                raise

        return wrapped


review_router = APIRouter(prefix="/night/portfolio", route_class=NightPortfolioRoute)
insights_router = APIRouter(prefix="/night/portfolio", route_class=NightPortfolioRoute)


@review_router.get("/review", response_model=PortfolioReview)
def portfolio_review(
    window: Window = "1m",
    db: Session = Depends(get_db),
    owner: User = Depends(get_current_user),
) -> PortfolioReview:
    return build_review(db, owner.id, owner.email, window)


@insights_router.get("/insights", response_model=PortfolioInsights)
def portfolio_insights(
    surface: Surface,
    response: Response,
    window: Window | None = None,
    db: Session = Depends(get_db),
    owner: User = Depends(get_current_user),
) -> PortfolioInsights | JSONResponse:
    if surface == "today" and window is not None:
        return night_error(
            422, "invalid_request", "Invalid portfolio request.",
            {"window": "Window is available for the Portfolio surface only."},
        )
    result = build_insights(db, owner.id, owner.email, surface, window)
    response.headers["X-Night-Insight-Rules"] = RULES_VERSION
    return result
