import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.core.database import get_db
from app.main import app
from app.models.order import Order
from app.models.trade import Trade
from app.routers import night_transfer
from tests.test_watchlists import _money, _seed_symbols, _user


PATH = "/night/watchlist-import"


@pytest.fixture
def transfer(db_session):
    transfer_app = FastAPI()
    transfer_app.include_router(night_transfer.router, prefix="/night")
    transfer_app.dependency_overrides[get_db] = app.dependency_overrides[get_db]
    return TestClient(transfer_app)


def _list(client, headers):
    response = client.post("/watchlists", headers=headers, json={"name": "CSV test"})
    assert response.status_code == 201
    return response.json()


def _members(client, headers):
    return client.get("/watchlists", headers=headers).json()["watchlists"][0]["symbols"]


def test_preview_apply_and_replay_preserve_order_and_money(client, transfer, auth_headers, db_session):
    headers = auth_headers()
    _user(db_session, "user@example.com")
    _seed_symbols(db_session, ["AAPL", "MSFT", "BRK.B"])
    _seed_symbols(db_session, ["DELISTED"], active=False)
    target = _list(client, headers)
    target_id = target["id"]
    path = f"/watchlists/{target_id}/symbols"
    for symbol in ("BRK.B", "AAPL"):
        assert client.post(path, headers=headers, json={"symbol": symbol}).status_code == 201
    assert client.delete(f"{path}/BRK.B", headers=headers).status_code == 204
    before_money = _money(db_session)
    payload = {
        "watchlist_id": target_id,
        "symbols": [" msft ", "aapl", "", "MSFT", "delisted", "ABC\x00", "brk.b", "X" * 21],
        "dry_run": True,
    }
    response = transfer.post(PATH, headers=headers, json=payload)
    assert response.status_code == 200
    dry = response.json()
    assert dry["added"] == 0
    assert dry["rows"] == [
        {"row": 2, "symbol": "MSFT", "status": "add"},
        {"row": 3, "symbol": "AAPL", "status": "existing"},
        {"row": 4, "symbol": "", "status": "invalid"},
        {"row": 5, "symbol": "MSFT", "status": "duplicate"},
        {"row": 6, "symbol": "DELISTED", "status": "invalid"},
        {"row": 7, "symbol": "ABC\x00", "status": "invalid"},
        {"row": 8, "symbol": "BRK.B", "status": "add"},
        {"row": 9, "symbol": "X" * 21, "status": "invalid"},
    ]
    assert dry["watchlist"]["symbols"] == _members(client, headers) == [{"symbol": "AAPL", "position": 2}]

    payload["dry_run"] = False
    response = transfer.post(PATH, headers=headers, json=payload)
    assert response.status_code == 200
    result = response.json()
    assert result["added"] == 2
    assert result["rows"] == dry["rows"]
    assert result["watchlist"]["symbols"] == _members(client, headers) == [
        {"symbol": "AAPL", "position": 2},
        {"symbol": "MSFT", "position": 3},
        {"symbol": "BRK.B", "position": 4},
    ]
    replay = transfer.post(PATH, headers=headers, json=payload).json()
    assert replay["added"] == 0
    assert replay["rows"][0]["status"] == "existing"
    assert replay["rows"][3]["status"] == "duplicate"
    assert replay["watchlist"] == result["watchlist"]
    assert _money(db_session) == before_money
    for model in (Trade, Order):
        assert db_session.scalar(select(func.count()).select_from(model)) == 0


def test_missing_foreign_and_role_denials(client, transfer, auth_headers, db_session):
    owner = auth_headers("owner-csv@example.com")
    other = auth_headers("other-csv@example.com")
    admin = auth_headers("admin-csv@example.com")
    _user(db_session, "admin-csv@example.com").role = "admin"
    db_session.commit()
    target_id = _list(client, owner)["id"]
    for dry_run in (True, False):
        payload = {"watchlist_id": target_id, "symbols": ["AAPL"], "dry_run": dry_run}
        assert transfer.post(PATH, json=payload).status_code == 401
        assert transfer.post(PATH, headers=admin, json=payload).status_code == 403
        foreign = transfer.post(PATH, headers=other, json=payload)
        missing = transfer.post(PATH, headers=other, json={**payload, "watchlist_id": target_id + 1})
        assert (foreign.status_code, foreign.json()) == (missing.status_code, missing.json())
        assert foreign.status_code == 404
        assert foreign.json()["detail"]["code"] == "watchlist_not_found"
    assert _members(client, owner) == []


def test_invalid_request_and_over_capacity_keep_existing_members(client, transfer, auth_headers, db_session):
    headers = auth_headers()
    target_id = _list(client, headers)["id"]
    base = {"watchlist_id": target_id, "symbols": ["AAPL"], "dry_run": False}
    for patch in (
        {"watchlist_id": str(target_id)}, {"watchlist_id": 2**31}, {"dry_run": 1},
        {"symbols": []}, {"symbols": [None]}, {"symbols": ["AAPL"] * 51},
        {"symbols": ["é" * 32769]}, {"trade": True},
    ):
        response = transfer.post(PATH, headers=headers, json={**base, **patch})
        assert response.status_code == 422
        assert response.json()["detail"]["code"] == "invalid_request"

    invalid_text = f'{{"watchlist_id": {target_id}, "symbols": ["\\ud800"], "dry_run": false}}'
    response = transfer.post(PATH, headers={**headers, "Content-Type": "application/json"}, content=invalid_text)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "invalid_request"

    symbols = [f"T{index:02d}" for index in range(51)]
    _seed_symbols(db_session, symbols)
    payload = {**base, "symbols": symbols[:48]}
    assert transfer.post(PATH, headers=headers, json=payload).json()["added"] == 48
    candidate = {**base, "symbols": symbols[48:50]}
    assert transfer.post(PATH, headers=headers, json={**candidate, "dry_run": True}).json()["added"] == 0

    path = f"/watchlists/{target_id}/symbols"
    assert client.post(path, headers=headers, json={"symbol": symbols[50]}).status_code == 201
    before = _members(client, headers)
    conflict = transfer.post(PATH, headers=headers, json=candidate)
    assert conflict.status_code == 409
    assert conflict.json()["detail"]["code"] == "watchlist_capacity"
    assert len(before) == 49
    assert _members(client, headers) == before
