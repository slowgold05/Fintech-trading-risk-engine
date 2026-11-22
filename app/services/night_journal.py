from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.night_journal import NightJournalEntry
from app.models.order import Order
from app.schemas.night_journal import JournalCreate, JournalEntryOut, JournalPage, JournalPatch
from app.services.night_notebook import as_utc, constraint_name, notebook_error, owner_write


def _as_output(entry: NightJournalEntry) -> JournalEntryOut:
    return JournalEntryOut(
        id=entry.id, order_id=entry.order_id, note=entry.note, tags=entry.tags,
        created_at=as_utc(entry.created_at), updated_at=as_utc(entry.updated_at),
    )


def list_entries(db: Session, user_id: int, cursor: str | None, limit: int) -> JournalPage:
    query = select(NightJournalEntry).where(NightJournalEntry.user_id == user_id)
    if cursor:
        query = query.where(NightJournalEntry.id < int(cursor))
    rows = list(db.scalars(query.order_by(NightJournalEntry.id.desc()).limit(limit + 1)))
    return JournalPage(
        items=[_as_output(entry) for entry in rows[:limit]],
        next_cursor=str(rows[limit - 1].id) if len(rows) > limit else None,
    )


def _duplicate_entry():
    return notebook_error(409, "duplicate_journal_entry", "This receipt already has a journal entry.")


def create_entry(db: Session, user_id: int, payload: JournalCreate) -> JournalEntryOut:
    with owner_write(db, user_id):
        order_id = db.scalar(select(Order.id).where(
            Order.id == payload.order_id, Order.user_id == user_id,
        ).with_for_update(read=True, key_share=True))
        if order_id is None:
            raise notebook_error(404, "order_not_found", "Receipt not found.")
        if db.scalar(select(NightJournalEntry.id).where(
            NightJournalEntry.user_id == user_id, NightJournalEntry.order_id == order_id,
        )) is not None:
            raise _duplicate_entry()
        entry = NightJournalEntry(user_id=user_id, **payload.model_dump())
        db.add(entry)
        try:
            db.flush()
        except IntegrityError as exc:
            if constraint_name(exc) == "uq_night_journal_owned_order":
                raise _duplicate_entry() from None
            raise
        return _as_output(entry)


def _owned_entry(db: Session, user_id: int, entry_id: int) -> NightJournalEntry:
    entry = db.scalar(select(NightJournalEntry).where(
        NightJournalEntry.user_id == user_id, NightJournalEntry.id == entry_id,
    ))
    if entry is None:
        raise notebook_error(404, "journal_entry_not_found", "Journal entry not found.")
    return entry


def update_entry(db: Session, user_id: int, entry_id: int, payload: JournalPatch) -> JournalEntryOut:
    with owner_write(db, user_id):
        entry = _owned_entry(db, user_id, entry_id)
        for field, value in payload.model_dump(exclude_unset=True).items():
            setattr(entry, field, value)
        if db.is_modified(entry):
            entry.updated_at = datetime.now(timezone.utc)
        return _as_output(entry)


def delete_entry(db: Session, user_id: int, entry_id: int) -> None:
    with owner_write(db, user_id):
        db.delete(_owned_entry(db, user_id, entry_id))
