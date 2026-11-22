from datetime import datetime, timezone

from sqlalchemy import and_, delete, func, literal, or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.night_holding_note import NightHoldingNote
from app.models.trade import Trade
from app.schemas.night_holding_notes import HoldingNote, Note


class IneligibleHoldingNote(Exception):
    pass


def _eligible_asset(owner_id: int, symbol: str):
    # All trade history counts for notes, even after the current book resets.
    owned = [
        select(row.asset_id).where(row.user_id == owner_id, row.asset_id == Asset.id).correlate(Asset).exists()
        for row in (Holding, Trade, NightHoldingNote)
    ]
    return select(Asset.id).where(Asset.symbol == symbol, or_(*owned))


def _note(text: str, updated_at: datetime) -> Note:
    utc = updated_at.astimezone(timezone.utc) if updated_at.tzinfo else updated_at.replace(tzinfo=timezone.utc)
    return Note(text=text, updated_at=utc)


def read_holding_note(db: Session, owner_id: int, symbol: str) -> HoldingNote:
    eligible = _eligible_asset(owner_id, symbol).subquery()
    row = db.execute(
        select(NightHoldingNote.text, NightHoldingNote.updated_at)
        .select_from(eligible)
        .outerjoin(NightHoldingNote, and_(NightHoldingNote.user_id == owner_id,
                                        NightHoldingNote.asset_id == eligible.c.id))
    ).one_or_none()
    if row is None:
        raise IneligibleHoldingNote
    return HoldingNote(symbol=symbol, note=_note(*row) if row.updated_at is not None else None)


def save_holding_note(db: Session, owner_id: int, symbol: str, text: str) -> HoldingNote:
    postgres = db.get_bind().dialect.name == "postgresql"
    insert = pg_insert if postgres else sqlite_insert
    now = func.clock_timestamp() if postgres else literal(datetime.now(timezone.utc))
    candidate = _eligible_asset(owner_id, symbol).with_only_columns(literal(owner_id), Asset.id, literal(text), now)
    statement = insert(NightHoldingNote).from_select(["user_id", "asset_id", "text", "updated_at"], candidate)
    # The eligibility guard and write share one statement. A conflicting edit
    # waits for the row and only advances its timestamp if the text changes.
    statement = statement.on_conflict_do_update(
        index_elements=[NightHoldingNote.user_id, NightHoldingNote.asset_id],
        set_={"text": statement.excluded.text, "updated_at": now},
        where=NightHoldingNote.text != statement.excluded.text,
    ).returning(NightHoldingNote.text, NightHoldingNote.updated_at)
    row = db.execute(statement).one_or_none()
    response = HoldingNote(symbol=symbol, note=_note(*row)) if row is not None else read_holding_note(db, owner_id, symbol)
    if response.note is None:
        raise IneligibleHoldingNote
    db.commit()
    return response


def delete_holding_note(db: Session, owner_id: int, symbol: str) -> None:
    asset_id = select(Asset.id).where(Asset.symbol == symbol).scalar_subquery()
    deleted = db.scalar(
        delete(NightHoldingNote)
        .where(NightHoldingNote.user_id == owner_id, NightHoldingNote.asset_id == asset_id)
        .returning(NightHoldingNote.asset_id)
    )
    if deleted is None and db.scalar(_eligible_asset(owner_id, symbol)) is None:
        raise IneligibleHoldingNote
    db.commit()
