from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import DBAPIError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import JSONResponse


class NotebookRoute(APIRoute):
    """Apply the Night error envelope to notebook routes and their dependencies."""

    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                fields = {}
                for error in exc.errors():
                    location = error["loc"]
                    field = ".".join(map(str, location[1:])) or location[0]
                    fields.setdefault(field, error["msg"])
                return JSONResponse(
                    status_code=422,
                    content={"detail": {
                        "code": "invalid_request", "message": "Check the request fields.", "fields": fields,
                    }},
                )
            except StarletteHTTPException as exc:
                codes = {400: "invalid_request", 401: "login_required", 403: "forbidden", 404: "not_found",
                         429: "rate_limited", 503: "storage_unavailable"}
                detail = exc.detail if isinstance(exc.detail, dict) else {
                    "code": codes.get(exc.status_code, "request_failed"), "message": str(exc.detail),
                }
                return JSONResponse(status_code=exc.status_code, content={"detail": detail}, headers=exc.headers)
            except DBAPIError:
                return JSONResponse(status_code=503, content={"detail": {
                    "code": "storage_unavailable", "message": "Notebook storage is temporarily unavailable.",
                }})

        return handle
