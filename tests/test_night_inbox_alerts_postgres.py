from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest
from sqlalchemy import Column, Date, DateTime, Integer, MetaData, Numeric, String, Table, delete, select

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.night_inbox import NightInboxRead
from app.routers.night_inbox import build_inbox_router
from app.services.night_inbox_alerts import stored_alert_source
from tests.test_night_inbox import _owner
from tests.test_night_inbox_postgres import postgres_inbox  # noqa: F401 - pytest fixture


@pytest.fixture
def stored_alerts(postgres_inbox):
    engine, sessions, owner_id, fill_id = postgres_inbox
    alerts = Table(
        f"inbox_trigger_fixture_{uuid4().hex}", MetaData(),
        Column("id", Integer, primary_key=True),
        Column("user_id", Integer, nullable=False),
        Column("symbol", String(20), nullable=False),
        Column("target", Numeric(18, 6), nullable=False),
        Column("last_date", Date),
        Column("last_close", Numeric(18, 6)),
        Column("last_provider", String(32)),
        Column("last_observed_at", DateTime(timezone=True)),
        Column("triggered_at", DateTime(timezone=True)),
    )
    alerts.create(engine)
    try:
        app = FastAPI()
        app.include_router(build_inbox_router(stored_alert_source(alerts)))

        def get_session():
            with sessions() as db:
                yield db

        app.dependency_overrides[get_db] = get_session
        offset = timezone(timedelta(hours=-5))
        trigger = datetime.now(offset) - timedelta(seconds=5)
        observed = trigger - timedelta(hours=1)
        observation = {
            "symbol": "MSFT", "target": Decimal("120.123456"), "last_close": Decimal("123.123456"),
            "last_provider": "fixture", "last_date": observed.date() - timedelta(days=1), "last_observed_at": observed,
        }
        with sessions.begin() as db:
            foreign = _owner(db, f"alert-inbox-{uuid4().hex}@example.com")
            db.execute(alerts.insert(), [
                {**observation, "id": 1, "user_id": owner_id, "triggered_at": trigger},
                {**observation, "id": 2, "user_id": foreign.id, "triggered_at": trigger},
                {**observation, "id": 3, "user_id": owner_id, "triggered_at": trigger - timedelta(days=31)},
                {**observation, "id": 4, "user_id": owner_id, "triggered_at": None},
            ])
        with TestClient(app, headers={"Authorization": f"Bearer {create_access_token(owner_id)}"}) as client:
            yield client, engine, sessions, alerts, fill_id, trigger, observation
    finally:
        alerts.drop(engine, checkfirst=True)


def _z(value):
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def test_stored_trigger_paginates_marks_and_disappears_after_deletion(stored_alerts):
    client, _, sessions, alerts, fill_id, trigger, observation = stored_alerts
    url = "/night/inbox"
    first = client.get(url, params={"limit": 1}).json()
    assert first["sources"] == {"fills": True, "demo": False, "alerts": True}
    assert first["unread_count"] == 2 and first["next_cursor"]
    session_date = observation["last_date"].isoformat()
    key = "alert_triggered:1"
    assert first["items"] == [{
        "id": key, "kind": "alert_triggered", "occurred_at": _z(trigger), "read_at": None,
        "symbol": "MSFT", "order_id": None, "alert_id": 1, "side": None, "quantity": None,
        "price": "123.123456", "target": "120.123456", "session_date": session_date,
        "source": {"provider": "fixture", "basis": "raw", "session_date": session_date,
                   "observed_at": _z(observation["last_observed_at"]), "coverage": "available"},
    }]
    second = client.get(url, params={"limit": 1, "cursor": first["next_cursor"]}).json()
    assert second["unread_count"] == 2 and not second["next_cursor"]
    assert [item["id"] for item in second["items"]] == [fill_id]

    def mark(id):
        return client.put(f"{url}/{id}/read")

    for alert in (2, 3, 4):
        assert mark(f"alert_triggered:{alert}").status_code == 404
    marked = mark(key)
    assert marked.status_code == 200 and mark(key).json() == marked.json()
    assert client.get(url).json()["items"][0]["read_at"] == marked.json()["read_at"]
    assert client.get(url, params={"filter": "unread"}).json()["unread_count"] == 1
    with sessions.begin() as db:
        db.execute(delete(alerts).where(alerts.c.id == 1))
    refreshed = client.get(url).json()
    assert refreshed["sources"]["alerts"] is True
    assert refreshed["unread_count"] == 1 and [item["id"] for item in refreshed["items"]] == [fill_id]
    assert mark(key).status_code == 404
    with sessions() as db:
        assert db.scalar(select(NightInboxRead.read_at).where(NightInboxRead.event_key == key)) is not None


def test_alert_query_failure_preserves_core_inbox_and_marker_writes(stored_alerts):
    client, engine, _, alerts, fill_id, _, _ = stored_alerts
    alerts.drop(engine)
    url = "/night/inbox"
    fallback = client.get(url)
    assert fallback.status_code == 200
    body = fallback.json()
    assert body["sources"] == {"fills": True, "demo": False, "alerts": False}
    assert body["unread_count"] == 1 and [item["id"] for item in body["items"]] == [fill_id]
    assert client.put(f"{url}/{fill_id}/read").status_code == 200
    failed = client.put(f"{url}/alert_triggered:1/read")
    assert failed.status_code == 503 and failed.json()["detail"]["code"] == "storage_unavailable"
    assert client.get(url, params={"filter": "unread"}).json()["unread_count"] == 0
