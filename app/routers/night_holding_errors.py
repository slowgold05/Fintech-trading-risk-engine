from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError

from app.core.read_snapshot import SnapshotClockError
from app.services.symbol_quote import _normalize


def holding_not_found() -> HTTPException:
    return HTTPException(404, detail={"code": "not_found", "message": "Holding symbol not found."})


def invalid_request(fields: dict[str, str]) -> HTTPException:
    return HTTPException(422, detail={
        "code": "invalid_request", "message": "Invalid holding details request.", "fields": fields,
    })


def holding_symbol(symbol: str) -> str:
    try:
        return _normalize(symbol.strip())
    except HTTPException as exc:
        raise invalid_request({"symbol": exc.detail}) from None


class NightHoldingRoute(APIRoute):
    def get_route_handler(self):
        handle = super().get_route_handler()

        async def route(request: Request) -> Response:
            try:
                return await handle(request)
            except RequestValidationError as exc:
                # Validation details may contain submitted note text or unknown keys.
                fields = {}
                known = {"symbol", "lot_cursor", "sale_cursor", "limit", "text"}
                for error in exc.errors():
                    location = error["loc"]
                    if len(location) == 2 and location[1] in known:
                        fields[location[1]] = "Invalid value."
                    elif location[0] == "body":
                        fields["body"] = "Invalid request body."
                raise invalid_request(fields) from None
            except (SQLAlchemyError, SnapshotClockError):
                raise HTTPException(503, detail={
                    "code": "storage_unavailable", "message": "Holding details storage is temporarily unavailable.",
                }) from None

        return route
