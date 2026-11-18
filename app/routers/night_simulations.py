"""Authenticated simulation endpoints. The integration app registers this router."""

from fastapi import APIRouter, Depends, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import InterfaceError, OperationalError, TimeoutError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.core.security import get_current_user
from app.schemas.night_simulations import BacktestRequest, Simulation, SimulationError
from app.services.night_simulations import run_backtest


class SimulationRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                fields = {}
                for error in exc.errors():
                    location = error["loc"]
                    field = location[-1]
                    if field not in BacktestRequest.model_fields or error["type"] == "extra_forbidden":
                        field = "body"
                    fields.setdefault(field, error["msg"])
                raise HTTPException(422, detail={"code": "invalid_request", "message": "Check the simulation inputs.",
                                                 "fields": fields}) from None
            except HTTPException as exc:
                error = {
                    400: (422, "invalid_request", "Send a valid JSON request body."),
                    401: (401, "authentication_required", "Sign in to run a simulation."),
                    403: (403, "forbidden", "Access to simulations is forbidden."),
                }.get(exc.status_code)
                if error is None:
                    raise
                status, code, message = error
                raise HTTPException(status, detail={"code": code, "message": message}, headers=exc.headers) from None
            except (InterfaceError, OperationalError, TimeoutError, SnapshotClockError):
                raise HTTPException(503, detail={"code": "storage_unavailable",
                                                 "message": "Simulation data is temporarily unavailable."}) from None

        return handle


router = APIRouter(
    prefix="/night/simulations",
    tags=["Simulations"],
    dependencies=[Depends(get_current_user)],
    route_class=SimulationRoute,
    responses={status: {"model": SimulationError} for status in (401, 403, 404, 422, 503)},
)


@router.post("/backtest", response_model=Simulation)
def backtest(request: BacktestRequest, db: Session = Depends(get_db)) -> Simulation:
    return run_backtest(db, request)
