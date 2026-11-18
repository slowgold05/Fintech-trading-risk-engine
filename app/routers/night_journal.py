from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_trader
from app.models.user import User
from app.routers.night_notebook import NotebookRoute
from app.schemas.night_journal import JournalCreate, JournalCursor, JournalEntryOut, JournalPage, JournalPatch
from app.schemas.night_notebook import NotebookID
from app.services import night_journal


router = APIRouter(prefix="/night/journal", route_class=NotebookRoute)


@router.get("", response_model=JournalPage)
def list_entries(
    cursor: Annotated[JournalCursor | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    db: Session = Depends(get_db), user: User = Depends(get_current_trader),
):
    return night_journal.list_entries(db, user.id, cursor, limit)


@router.post("", response_model=JournalEntryOut, status_code=201)
def create_entry(payload: JournalCreate, db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    return night_journal.create_entry(db, user.id, payload)


@router.patch("/{entry_id}", response_model=JournalEntryOut)
def update_entry(
    entry_id: NotebookID, payload: JournalPatch, db: Session = Depends(get_db), user: User = Depends(get_current_trader),
):
    return night_journal.update_entry(db, user.id, entry_id, payload)


@router.delete("/{entry_id}", status_code=204)
def delete_entry(entry_id: NotebookID, db: Session = Depends(get_db), user: User = Depends(get_current_trader)):
    night_journal.delete_entry(db, user.id, entry_id)
    return Response(status_code=204)
