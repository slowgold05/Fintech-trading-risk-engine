from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.asset import Asset
from app.models.night_journal import NightJournalEntry
from app.models.order import Order
from app.routers.night_journal import router
from tests.night_notebook_support import bearer, fixture_user, notebook_sessions, trial_client


PATH = "/night/journal"


@pytest.fixture
def receipts(notebook_sessions):
    with notebook_sessions.begin() as db:
        owner = fixture_user(db)
        stranger = fixture_user(db)
        auditor = fixture_user(db, role="auditor")
        asset = Asset(symbol=f"N{uuid4().hex[:9].upper()}", asset_type="stock", name="Synthetic journal fixture")
        db.add(asset)
        db.flush()
        orders = [Order(user_id=owner_id, asset_id=asset.id, side="buy", order_type="limit",
                        quantity=1, remaining_quantity=1, limit_price=5, status="open")
                  for owner_id in (owner.id, owner.id, stranger.id)]
        db.add_all(orders)
        db.flush()
    return owner, stranger, auditor, orders


def test_journal_lifecycle_and_owner_pagination(notebook_sessions, receipts):
    owner, stranger, auditor, (first, second, foreign) = receipts
    with trial_client(router, notebook_sessions) as client:
        headers, other = bearer(owner.id), bearer(stranger.id)
        assert client.get(PATH).status_code == 401
        assert client.get(PATH, headers=bearer(auditor.id)).status_code == 403
        assert client.get(PATH, headers=headers).json() == {"items": [], "next_cursor": None}
        payload = {"order_id": first.id, "note": "Review <b>literal</b>\nLine two", "tags": [" watch "]}
        assert client.post(PATH, json={**payload, "order_id": foreign.id}, headers=headers).status_code == 404
        created = client.post(PATH, json=payload, headers=headers)
        assert created.status_code == 201
        entry = created.json()
        assert entry["note"] == payload["note"] and entry["tags"] == ["watch"]
        assert entry["order_id"] == first.id
        assert entry["updated_at"] == entry["created_at"] and entry["created_at"].endswith("Z")
        second_entry = client.post(PATH, json={**payload, "order_id": second.id}, headers=headers).json()
        foreign_entry = client.post(PATH, json={**payload, "order_id": foreign.id}, headers=other).json()
        assert client.get(f"{PATH}?limit=1&cursor=", headers=headers).json() == {
            "items": [second_entry], "next_cursor": str(second_entry["id"]),
        }
        assert client.get(f"{PATH}?limit=1&cursor={second_entry['id']}", headers=headers).json() == {
            "items": [entry], "next_cursor": None,
        }
        assert client.get(f"{PATH}?cursor={foreign_entry['id']}", headers=headers).json()["items"] == [second_entry, entry]
        item_path = f"{PATH}/{entry['id']}"
        for method in ("PATCH", "DELETE"):
            response = client.request(method, item_path, headers=other, json={"note": "Foreign mutation"})
            assert response.status_code == 404
        assert client.post(PATH, headers=headers, json=payload).json()["detail"]["code"] == "duplicate_journal_entry"
        changed = client.patch(item_path, headers=headers, json={"tags": []})
        assert changed.status_code == 200
        assert changed.json()["tags"] == [] and changed.json()["note"] == entry["note"]
        assert changed.json()["created_at"] == entry["created_at"]
        assert changed.json()["updated_at"] > entry["updated_at"]
        assert client.patch(item_path, headers=headers, json={"tags": []}).json() == changed.json()
        assert client.delete(item_path, headers=headers).status_code == 204
        assert client.delete(item_path, headers=headers).status_code == 404


def test_journal_constraints_cover_retry_and_malformed_input(notebook_sessions, receipts):
    owner, stranger, _, (first, _, _) = receipts
    with notebook_sessions() as db, pytest.raises(IntegrityError) as invalid_order:
        db.add(NightJournalEntry(order_id=first.id, user_id=stranger.id, note="Foreign owner", tags=[]))
        db.flush()
    assert invalid_order.value.orig.diag.constraint_name == "fk_night_journal_owned_order"

    with trial_client(router, notebook_sessions) as client, ThreadPoolExecutor(max_workers=2) as executor:
        headers = bearer(owner.id)
        payload = {"order_id": first.id, "note": "An owned receipt", "tags": []}
        for invalid in (
            {"order_id": True}, {"note": " "}, {"note": "\0"}, {"note": "a" * 2001},
            {"tags": ["watch"] * 6}, {"tags": ["a" * 25]}, {"tags": [""]},
        ):
            response = client.post(PATH, headers=headers, json={**payload, **invalid})
            assert response.status_code == 422
            assert response.json()["detail"]["code"] == "invalid_request"
        for query in ("cursor=bogus", "cursor=2147483649", "limit=0", "limit=101"):
            assert client.get(f"{PATH}?{query}", headers=headers).status_code == 422
        attempts = [executor.submit(client.post, PATH, headers=headers, json=payload) for _ in range(2)]
        assert sorted(attempt.result().status_code for attempt in attempts) == [201, 409]
        entries = client.get(PATH, headers=headers).json()["items"]
        assert len(entries) == 1
        item_path = f"{PATH}/{entries[0]['id']}"
        for invalid in ({}, {"note": None}, {"tags": None}, {"order_id": first.id}):
            assert client.patch(item_path, headers=headers, json=invalid).status_code == 422
