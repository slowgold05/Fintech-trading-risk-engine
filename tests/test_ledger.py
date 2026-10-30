from decimal import Decimal
from hashlib import sha256
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import uuid4

from sqlalchemy import text

from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.trade import Trade
from app.models.user import User
from app.services.ledger_service import reconcile_account
from app.scripts import reconcile_ledger
from app.services import control_evidence


def _trade(client, headers, side, quantity):
    return client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"symbol": "AAPL", "asset_type": "stock", "side": side, "quantity": quantity},
    )


def test_trades_create_balanced_postings_and_reconcile(client, auth_headers, db_session):
    headers = auth_headers()
    assert _trade(client, headers, "buy", 2).status_code == 200
    assert _trade(client, headers, "sell", 0.5).status_code == 200

    user = db_session.query(User).one()
    entries = db_session.query(LedgerEntry).order_by(LedgerEntry.id).all()
    assert len(entries) == 10  # opening cash pair plus four postings per trade
    assert {entry.trade_id for entry in entries if entry.event_kind == "trade"} == {
        trade.id for trade in db_session.query(Trade)
    }
    assert reconcile_account(db_session, user) == {"ok": True, "entries": 10, "errors": []}

    db_session.execute(text("UPDATE ledger_entries SET amount = amount + 1 WHERE id = 1"))
    db_session.commit()
    db_session.expire_all()
    assert not reconcile_account(db_session, db_session.query(User).one())["ok"]


def test_reset_preserves_trade_history_and_reconciles(client, auth_headers, db_session):
    headers = auth_headers()
    assert _trade(client, headers, "buy", 2).status_code == 200
    assert _trade(client, headers, "sell", 1).status_code == 200

    reset = client.post("/portfolio/reset", headers=headers)
    assert reset.status_code == 200, reset.text
    assert db_session.query(Trade).count() == 2
    assert db_session.query(Holding).count() == 0
    assert db_session.query(User).one().cash_balance == Decimal("100000.00")
    assert reconcile_account(db_session, db_session.query(User).one())["ok"]
    assert client.get("/portfolio/", headers=headers).json()["summary"]["total_realized_pnl"] == 0
    assert {entry.event_kind for entry in db_session.query(LedgerEntry)} == {
        "opening_snapshot", "trade", "reset"
    }


def test_legacy_account_requires_explicit_opening_snapshot(db_session):
    db_session.add(User(email="legacy@example.com", password_hash="test", cash_balance=Decimal("42.00")))
    db_session.commit()

    assert reconcile_ledger.run(db_session)["failures"][0]["errors"] == ["Ledger has no opening snapshot", "Cash balance differs from ledger"]
    assert reconcile_ledger.run(db_session, initialize=True) == {"checked": 1, "initialized": 1, "failures": []}
    assert reconcile_ledger.run(db_session, initialize=True)["initialized"] == 0


def test_reconciliation_evidence_is_dated_and_hashed(monkeypatch):
    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        assert root.resolve().parent == Path.cwd().resolve()
        monkeypatch.setattr(control_evidence, "EVIDENCE_DIR", root)
        path, digest = control_evidence.write_evidence("SM-LD-01", {"checked": 1, "initialized": 0, "failures": []})
        payload = path.read_bytes()

        assert path.parent == root / "SM-LD-01"
        assert json.loads(payload)["control_id"] == "SM-LD-01"
        assert sha256(payload).hexdigest() == digest
