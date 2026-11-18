from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.read_snapshot import SnapshotClockError
from app.core.security import get_current_trader
from app.models.user import User
from app.schemas.night_inbox import EVENT_KEY_PATTERN, InboxPage, InboxQuery, InboxRead
from app.services.night_inbox import EventNotFound, InvalidCursor, list_inbox, mark_read


def _error(status: int, code: str, message: str, fields: dict[str, str] | None = None) -> HTTPException:
    detail = {"code": code, "message": message}
    if fields:
        detail["fields"] = fields
    return HTTPException(status_code=status, detail=detail)


class InboxRoute(APIRoute):
    def get_route_handler(self):
        handler = super().get_route_handler()

        async def handle(request: Request):
            try:
                return await handler(request)
            except RequestValidationError as exc:
                fields = {str(error["loc"][-1]): "Invalid value." for error in exc.errors() if error["loc"]}
                raise _error(422, "invalid_request", "Check the inbox request.", fields) from None
            except InvalidCursor:
                raise _error(422, "invalid_request", "Invalid inbox cursor.", {"cursor": "Invalid cursor."}) from None
            except EventNotFound:
                raise _error(404, "not_found", "Inbox event not found.") from None
            except (SQLAlchemyError, SnapshotClockError):
                raise _error(503, "storage_unavailable", "Inbox storage is unavailable.") from None

        return handle


async def _empty_body(request: Request) -> None:
    async for chunk in request.stream():
        if chunk:
            raise _error(422, "invalid_request", "The inbox request body must be empty.", {"body": "Omit the body."})


router = APIRouter(prefix="/night/inbox", tags=["Activity inbox"], route_class=InboxRoute)


@router.get("")
def get_inbox(
    query: Annotated[InboxQuery, Query()],
    current_user: User = Depends(get_current_trader),
    db: Session = Depends(get_db),
    _empty: None = Depends(_empty_body),
) -> InboxPage:
    return list_inbox(db, current_user.id, current_user.is_demo, query.filter, query.cursor, query.limit)


@router.put("/{id}/read")
def put_inbox_read(
    id: Annotated[str, Path(pattern=EVENT_KEY_PATTERN)],
    current_user: User = Depends(get_current_trader),
    db: Session = Depends(get_db),
    _empty: None = Depends(_empty_body),
) -> InboxRead:
    return mark_read(db, current_user.id, current_user.is_demo, id)
