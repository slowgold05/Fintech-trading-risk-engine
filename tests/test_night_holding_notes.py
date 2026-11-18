from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.night_holding_note import NightHoldingNote
from app.models.user import User
from app.routers.night_holding_notes import router
from app.routers.portfolio import _reset_portfolio
from app.services.trade_execution import execute_fill


PATH = "/night/holdings/AAPL/note"


@pytest.fixture
def notes(db_session):
    api = FastAPI()
    api.include_router(router)
    api.dependency_overrides[get_db] = lambda: db_session
    owner = User(email="note-owner@example.com", password_hash="unused")
    stranger = User(email="note-stranger@example.com", password_hash="unused")
    analyst = User(email="note-analyst@example.com", password_hash="unused", role="analyst")
    asset = Asset(symbol="AAPL", asset_type="stock")
    db_session.add_all([owner, stranger, analyst, asset])
    db_session.flush()
    execute_fill(db_session, owner, asset, "buy", Decimal(2), Decimal(10))
    db_session.commit()
    return TestClient(api), owner, stranger, analyst, asset


def _auth(user):
    return {"Authorization": f"Bearer {create_access_token(user.id)}"}


def _protected_state(db):
    holdings = db.execute(select(Holding.id, Holding.user_id, Holding.asset_id, Holding.quantity, Holding.avg_cost)
                          .order_by(Holding.id)).all()
    ledger = db.execute(select(LedgerEntry.id, LedgerEntry.entry_hash).order_by(LedgerEntry.id)).all()
    return holdings, ledger


def test_save_edit_replay_and_delete_without_changing_the_book(notes, db_session):
    client, owner, _, _, _ = notes
    headers = _auth(owner)
    before = _protected_state(db_session)
    empty = client.get(PATH, headers=headers)
    assert empty.json() == {"symbol": "AAPL", "note": None}
    payload = "<b>Paper thesis</b>\n📈"
    saved = client.put("/night/holdings/%20aapl%20/note", json={"text": f" \n{payload}\u2003"}, headers=headers)
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["symbol"] == "AAPL"
    assert body["note"]["text"] == payload
    assert body["note"]["updated_at"].endswith("Z")
    assert client.get(PATH, headers=headers).json() == body
    assert client.put(PATH, json={"text": payload}, headers=headers).json() == body

    edited = client.put(PATH, json={"text": "Second edit"}, headers=headers).json()
    assert edited["note"]["text"] == "Second edit"
    assert edited["note"]["updated_at"] > body["note"]["updated_at"]
    for _ in range(2):
        removed = client.delete(PATH, headers=headers)
        assert removed.status_code == 204 and removed.content == b""
    assert client.get(PATH, headers=headers).json() == empty.json()
    assert _protected_state(db_session) == before


def test_note_persists_through_sale_reset_and_reentry(notes, db_session):
    client, owner, _, _, asset = notes
    headers = _auth(owner)
    saved = client.put(PATH, json={"text": "Record the thesis"}, headers=headers).json()
    execute_fill(db_session, owner, asset, "sell", Decimal(2), Decimal(12))
    db_session.commit()
    assert client.get(PATH, headers=headers).json() == saved
    _reset_portfolio(db_session, owner.id)
    db_session.commit()
    assert db_session.scalar(select(Holding).where(Holding.user_id == owner.id)) is None
    assert client.get(PATH, headers=headers).json() == saved
    execute_fill(db_session, owner, asset, "buy", Decimal(1), Decimal(11))
    db_session.commit()
    assert client.get(PATH, headers=headers).json() == saved


def test_existing_note_alone_is_eligible_and_foreign_trade_is_not(notes, db_session):
    client, _, stranger, _, asset = notes
    outsider = _auth(stranger)
    db_session.add(NightHoldingNote(user_id=stranger.id, asset_id=asset.id, text="Existing",
                                    updated_at=stranger.created_at))
    db_session.commit()
    assert client.get(PATH, headers=outsider).json()["note"]["text"] == "Existing"
    assert client.put(PATH, json={"text": "Revised"}, headers=outsider).status_code == 200
    assert client.delete(PATH, headers=outsider).status_code == 204
    assert client.delete(PATH, headers=outsider).status_code == 404


def test_role_owner_and_validation_failures(notes):
    client, owner, stranger, analyst, _ = notes
    own_headers = _auth(owner)
    saved = client.put(PATH, json={"text": "Owner only"}, headers=own_headers).json()
    unknown = client.get("/night/holdings/NO-SUCH/note", headers=own_headers).json()
    for method, options in (("GET", {}), ("PUT", {"json": {"text": "Foreign edit"}}), ("DELETE", {})):
        assert client.request(method, PATH, **options).status_code == 401
        assert client.request(method, PATH, headers=_auth(analyst), **options).status_code == 403
        foreign = client.request(method, PATH, headers=_auth(stranger), **options)
        assert foreign.status_code == 404 and foreign.json() == unknown
    assert client.get(PATH, headers=own_headers).json() == saved
    invalid = ({"text": " \n"}, {"text": "extra private content" * 200}, {"text": 12},
               {"text": "\x00"}, {"text": "value", "private extra key": True}, {})
    for payload in invalid:
        failure = client.put(PATH, json=payload, headers=own_headers)
        assert failure.status_code == 422
        assert failure.json()["detail"]["code"] == "invalid_request"
        assert "private" not in failure.text
    malformed = client.put(PATH, content=b'{"text":"\xff"}',
                           headers={**own_headers, "Content-Type": "application/json"})
    assert malformed.status_code == 422
    assert malformed.json()["detail"]["code"] == "invalid_request"
    long_valid = "📈" * 2000
    assert client.put(PATH, json={"text": long_valid}, headers=own_headers).json()["note"]["text"] == long_valid


def test_note_errors_hide_storage_details(notes):
    client, owner, _, _, _ = notes
    headers = _auth(owner)

    def unavailable():
        raise OperationalError("private parameters", {}, Exception("unavailable"))

    client.app.dependency_overrides[get_db] = unavailable
    response = client.put(PATH, json={"text": "Never echo"}, headers=headers)
    assert response.status_code == 503
    assert response.json()["detail"]["code"] == "storage_unavailable"
    assert "private parameters" not in response.text and "Never echo" not in response.text


def test_note_bounds_json_before_decoding(notes):
    client, _, _, _, _ = notes
    response = client.put(PATH, content=iter([b" " * 32768, b"{}"]),
                          headers={"Content-Type": "application/json"})
    assert response.status_code == 413
    assert response.json()["detail"]["code"] == "request_too_large"
