from fastapi import HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

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


_MAX_BODY_BYTES = 32_768


class NightHoldingRoute(APIRoute):
    def get_route_handler(self):
        handle = super().get_route_handler()

        async def route(request: Request) -> Response:
            if self.body_field is not None:
                receive = request.receive
                bytes_read = 0

                async def receive_bounded():
                    nonlocal bytes_read
                    message = await receive()
                    bytes_read += len(message.get("body", b""))
                    if bytes_read > _MAX_BODY_BYTES:
                        raise HTTPException(413, detail={
                            "code": "request_too_large", "message": "The request body is too large.",
                        })
                    return message

                request = Request(request.scope, receive_bounded)
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
                    elif location and location[0] == "body":
                        fields["body"] = "Invalid request body."
                raise invalid_request(fields) from None
            except StarletteHTTPException as exc:
                if exc.status_code == 400:
                    raise invalid_request({"body": "Invalid request body."}) from None
                raise
            except (SQLAlchemyError, SnapshotClockError):
                raise HTTPException(503, detail={
                    "code": "storage_unavailable", "message": "Holding details storage is temporarily unavailable.",
                }) from None

        return route
