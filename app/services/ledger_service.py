from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.user import User


ZERO_HASH = "0" * 64


def _hash(entry: LedgerEntry) -> str:
    content = {
        "user_id": entry.user_id,
        "trade_id": entry.trade_id,
        "event_id": entry.event_id,
        "event_kind": entry.event_kind,
        "account": entry.account,
        "asset_id": entry.asset_id,
        "unit": entry.unit,
        "amount": format(entry.amount, ".6f"),
        "created_at": entry.created_at.isoformat(timespec="microseconds"),
        "previous_hash": entry.previous_hash,
    }
    return sha256(json.dumps(content, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def append_event(
    db: Session,
    user_id: int,
    kind: str,
    postings: list[tuple[str, int | None, str, Decimal]],
    trade_id: int | None = None,
) -> None:
    sums = defaultdict(Decimal)
    for _, _, unit, amount in postings:
        sums[unit] += amount
    if len(postings) < 2 or any(total != 0 for total in sums.values()):
        raise ValueError("Ledger event must have balanced postings")

    latest = db.execute(
        select(LedgerEntry)
        .where(LedgerEntry.user_id == user_id)
        .order_by(LedgerEntry.id.desc())
        .limit(1)
    ).scalar_one_or_none()
    previous_hash = latest.entry_hash if latest else ZERO_HASH
    event_id = uuid4().hex
    created_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    for account, asset_id, unit, amount in postings:
        entry = LedgerEntry(
            user_id=user_id,
            trade_id=trade_id,
            event_id=event_id,
            event_kind=kind,
            account=account,
            asset_id=asset_id,
            unit=unit,
            amount=amount,
            created_at=created_at,
            previous_hash=previous_hash,
        )
        entry.entry_hash = _hash(entry)
        db.add(entry)
        db.flush()
        previous_hash = entry.entry_hash


def ensure_opening(db: Session, user: User) -> None:
    if db.execute(select(LedgerEntry.id).where(LedgerEntry.user_id == user.id).limit(1)).first():
        return

    cash = user.cash_balance
    postings = [("cash", None, "USD", cash), ("offset", None, "USD", -cash)]
    for holding in db.execute(select(Holding).where(Holding.user_id == user.id)).scalars():
        unit = f"ASSET:{holding.asset_id}"
        postings.extend([
            ("position", holding.asset_id, unit, holding.quantity),
            ("offset", holding.asset_id, unit, -holding.quantity),
        ])
    # shortcut: existing accounts start from a snapshot; backfill old trades before claiming full-history coverage.
    append_event(db, user.id, "opening_snapshot", postings)


def append_trade(db: Session, user_id: int, trade_id: int, asset_id: int, side: str, qty: Decimal, notional: Decimal) -> None:
    direction = Decimal(1) if side == "buy" else Decimal(-1)
    unit = f"ASSET:{asset_id}"
    append_event(db, user_id, "trade", [
        ("cash", None, "USD", -direction * notional),
        ("offset", None, "USD", direction * notional),
        ("position", asset_id, unit, direction * qty),
        ("offset", asset_id, unit, -direction * qty),
    ], trade_id=trade_id)


def append_reset(db: Session, user: User, target_cash: Decimal) -> None:
    cash_change = target_cash - user.cash_balance
    postings = [("cash", None, "USD", cash_change), ("offset", None, "USD", -cash_change)]
    for holding in db.execute(select(Holding).where(Holding.user_id == user.id)).scalars():
        unit = f"ASSET:{holding.asset_id}"
        postings.extend([
            ("position", holding.asset_id, unit, -holding.quantity),
            ("offset", holding.asset_id, unit, holding.quantity),
        ])
    append_event(db, user.id, "reset", postings)


def reconcile_account(db: Session, user: User) -> dict:
    entries = db.execute(
        select(LedgerEntry).where(LedgerEntry.user_id == user.id).order_by(LedgerEntry.id)
    ).scalars().all()
    errors = []
    if not entries:
        errors.append("Ledger has no opening snapshot")

    previous_hash = ZERO_HASH
    event_sums = defaultdict(Decimal)
    cash = Decimal(0)
    positions = defaultdict(Decimal)
    for entry in entries:
        if entry.previous_hash != previous_hash or entry.entry_hash != _hash(entry):
            errors.append(f"Hash chain mismatch at entry {entry.id}")
        previous_hash = entry.entry_hash
        event_sums[(entry.event_id, entry.unit)] += entry.amount
        if entry.account == "cash":
            cash += entry.amount
        elif entry.account == "position":
            positions[entry.asset_id] += entry.amount

    if any(total != 0 for total in event_sums.values()):
        errors.append("Unbalanced ledger event")
    if cash != user.cash_balance:
        errors.append("Cash balance differs from ledger")

    holdings = {
        holding.asset_id: holding.quantity
        for holding in db.execute(select(Holding).where(Holding.user_id == user.id)).scalars()
    }
    for asset_id in positions.keys() | holdings.keys():
        if positions[asset_id] != holdings.get(asset_id, Decimal(0)):
            errors.append(f"Position {asset_id} differs from ledger")

    return {"ok": not errors, "entries": len(entries), "errors": errors}
