from datetime import datetime, timedelta, timezone
from decimal import Decimal
from tempfile import TemporaryDirectory
from pathlib import Path
from uuid import uuid4
import json
import threading
import time

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.core.database import Base
from app.models.aml import AmlActivation, AmlCase, CashMovement
from app.models.asset import Asset
from app.models.ops_state import DetectionCursor, SchedulerLock
from app.models.order import Order
from app.models.surveillance import SurveillanceActivation, SurveillanceCase
from app.models.trade import Trade
from app.models.user import User
from app.services import aml_cases
from app.services import scheduled_jobs
from app.services import surveillance_cases
from app.services.aml_cases import close_case as close_aml_case, list_cases as list_aml_cases, run_live_aml
from app.services.aml_detect import CashEvent, detect as detect_aml
from app.services.aml_rules import load_rules as load_aml_rules
from app.services.detection_cursor import SURVEILLANCE
from app.services.sanctions import interpret_yente_payload
from app.services.scheduler_lock import acquire_scheduler, release_scheduler
from app.services.surveillance_cases import close_case as close_surveillance_case, events_from_db, run_live_surveillance
from app.services.surveillance_detect import Detection, SurveillanceEvent, detect
from app.services.surveillance_rules import load_rules


def _activate(db, when):
    subject = User(email=f"subject-{uuid4().hex}@example.com", password_hash="x")
    requester = User(email=f"requester-{uuid4().hex}@example.com", password_hash="x")
    approver = User(email=f"approver-{uuid4().hex}@example.com", password_hash="x")
    asset = Asset(symbol="NVDA", asset_type="stock", name="NVIDIA", is_active=True)
    db.add_all([subject, requester, approver, asset])
    db.flush()
    db.add(SurveillanceActivation(
        rule_id="SM-SV-01", version=1, reason="Audit scan", status="active",
        requested_by_user_id=requester.id, approved_by_user_id=approver.id, approved_at=when,
    ))
    db.commit()
    return subject, asset


def test_scan_keeps_activity_outside_the_hour_and_a_failed_scan_does_not_advance(db_session, monkeypatch):
    scan_at = datetime(2026, 11, 4, 18, 0)
    subject, asset = _activate(db_session, scan_at - timedelta(hours=30))
    db_session.add(DetectionCursor(
        name=SURVEILLANCE, scanned_through=scan_at - timedelta(hours=30), pending_since=None,
        updated_at=scan_at - timedelta(hours=30),
    ))
    pattern = scan_at - timedelta(hours=28)
    db_session.add_all([
        Trade(user_id=subject.id, asset_id=asset.id, side="buy", quantity=Decimal("100"),
              price_at_execution=Decimal("10"), executed_at=pattern),
        Trade(user_id=subject.id, asset_id=asset.id, side="sell", quantity=Decimal("100"),
              price_at_execution=Decimal("10.02"), executed_at=pattern + timedelta(minutes=5)),
    ])
    db_session.commit()

    from app.services.surveillance_detect import detect as real_detect

    def fail(rule, events):
        raise RuntimeError("scan failed")

    monkeypatch.setattr(surveillance_cases, "detect", fail)
    try:
        run_live_surveillance(db_session, scan_at)
        raised = False
    except RuntimeError:
        raised = True
    assert raised
    cursor = db_session.get(DetectionCursor, SURVEILLANCE)
    assert cursor.scanned_through == scan_at - timedelta(hours=30)
    assert cursor.pending_since is not None
    assert db_session.query(SurveillanceCase).count() == 0

    monkeypatch.setattr(surveillance_cases, "detect", real_detect)
    opened = run_live_surveillance(db_session, scan_at)
    assert opened == {"opened": 1, "rules": 1}
    cursor = db_session.get(DetectionCursor, SURVEILLANCE)
    assert cursor.scanned_through == scan_at
    assert cursor.pending_since is None
    assert db_session.query(SurveillanceCase).one().subject_user_id == subject.id


def test_ordinary_book_print_is_quiet_and_a_round_trip_alerts(db_session):
    rule = load_rules()["SM-SV-01"]
    when = datetime(2026, 11, 4, 12, 0, 0)
    book = [
        SurveillanceEvent("trade-1", when, 1, "AAPL", "trade", "buy", Decimal("5"), Decimal("20"), "11"),
        SurveillanceEvent("trade-2", when, 2, "AAPL", "trade", "sell", Decimal("5"), Decimal("20"), "22"),
    ]
    assert detect(rule, book) == []
    same_account = [
        SurveillanceEvent("trade-3", when, 1, "AAPL", "trade", "buy", Decimal("5"), Decimal("20"), "31"),
        SurveillanceEvent("trade-4", when, 1, "AAPL", "trade", "sell", Decimal("5"), Decimal("20"), "32"),
    ]
    assert len(detect(rule, same_account)) == 1
    round_trip = [
        SurveillanceEvent("trade-5", when, 1, "AAPL", "trade", "buy", Decimal("5"), Decimal("20"), "41"),
        SurveillanceEvent("trade-6", when + timedelta(minutes=1), 1, "AAPL", "trade", "sell", Decimal("5"), Decimal("20.05"), "42"),
    ]
    found = detect(rule, round_trip)
    assert len(found) == 1
    assert isinstance(found[0], Detection)

    buyer = User(email="buyer-print@example.com", password_hash="x")
    seller = User(email="seller-print@example.com", password_hash="x")
    asset = Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True)
    db_session.add_all([buyer, seller, asset])
    db_session.flush()
    buy_order = Order(user_id=buyer.id, asset_id=asset.id, side="buy", order_type="limit", quantity=Decimal("5"),
                      remaining_quantity=0, limit_price=Decimal("20"), status="filled")
    sell_order = Order(user_id=seller.id, asset_id=asset.id, side="sell", order_type="limit", quantity=Decimal("5"),
                       remaining_quantity=0, limit_price=Decimal("20"), status="filled")
    db_session.add_all([buy_order, sell_order])
    db_session.flush()
    db_session.add_all([
        Trade(user_id=buyer.id, asset_id=asset.id, order_id=buy_order.id, side="buy", quantity=Decimal("5"),
              price_at_execution=Decimal("20"), executed_at=when),
        Trade(user_id=seller.id, asset_id=asset.id, order_id=sell_order.id, side="sell", quantity=Decimal("5"),
              price_at_execution=Decimal("20"), executed_at=when),
    ])
    db_session.commit()
    events = events_from_db(db_session, when - timedelta(minutes=1))
    assert detect(rule, events) == []


def test_malformed_yente_payloads_do_not_clear():
    threshold = Decimal("0.85")
    name = "ada trader"
    assert interpret_yente_payload({"responses": {"q": {"results": []}}}, name, threshold)["decision"] == "clear"
    blocked = interpret_yente_payload(
        {"responses": {"q": {"results": [{"score": 0.99, "caption": "Listed person"}]}}}, name, threshold,
    )
    assert blocked["decision"] == "blocked"
    invalid = (
        {},
        {"responses": {}},
        {"responses": {"q": {}}},
        {"responses": {"q": {"results": None}}},
        {"responses": {"q": {"results": [{"caption": "missing score"}]}}},
        {"responses": {"q": {"results": [{"score": "high"}]}}},
        {"responses": {"q": {"results": [{"score": float("nan")}]}}},
        {"responses": {"q": {"status": 500, "results": []}}},
        {"responses": {"q": {"results": [None]}}},
        [],
        None,
    )
    assert [interpret_yente_payload(item, name, threshold)["decision"] for item in invalid] == ["provider_error"] * len(invalid)


class _Body:
    def __init__(self, raw):
        self.raw = raw

    def json(self):
        return json.loads(self.raw)

    def raise_for_status(self):
        pass


def test_invalid_sanctions_response_blocks_the_withdrawal(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers("screen-user@example.com", "password123")
    assert client.put("/auth/name", headers=headers, json={"full_name": "Ada Trader"}).status_code == 200
    monkeypatch.setattr(settings, "yente_url", "http://yente.invalid")
    monkeypatch.setattr("app.services.sanctions.requests.post", lambda url, json, timeout=3: _Body(b"{}"))
    denied = client.post("/cash/movements", headers={**headers, "Idempotency-Key": uuid4().hex},
                         json={"kind": "withdrawal", "amount": "12.00"})
    assert denied.status_code == 403, denied.text
    assert db_session.query(CashMovement).count() == 0

    monkeypatch.setattr(
        "app.services.sanctions.requests.post",
        lambda url, json, timeout=3: _Body(b'{"responses":{"q":{"results":[]}}}'),
    )
    allowed = client.post("/cash/movements", headers={**headers, "Idempotency-Key": uuid4().hex},
                          json={"kind": "withdrawal", "amount": "12.00"})
    assert allowed.status_code == 200, allowed.text
    monkeypatch.setattr(
        "app.services.sanctions.requests.post",
        lambda url, json, timeout=3: _Body(b'{"responses":{"q":{"results":[{"score":0.99}]}}}'),
    )
    matched = client.post("/cash/movements", headers={**headers, "Idempotency-Key": uuid4().hex},
                          json={"kind": "withdrawal", "amount": "12.00"})
    assert matched.status_code == 403, matched.text
    assert db_session.query(CashMovement).count() == 1


def test_sanctions_transport_failure_stays_closed(monkeypatch):
    import requests
    from app.services.sanctions import screen_name

    monkeypatch.setattr(settings, "yente_url", "https://yente.invalid")

    def unavailable(url, **kwargs):
        raise requests.Timeout("Provider unavailable")

    monkeypatch.setattr("app.services.sanctions.requests.post", unavailable)
    assert screen_name("Grant Test")["decision"] == "provider_error"


def test_operating_sample_http_request_keeps_form_auth_and_error_body(monkeypatch):
    import requests
    from app.scripts.collect_operating_samples import request

    def denied(method, url, **kwargs):
        assert method == "POST" and url.endswith("/auth/login")
        assert kwargs["data"] == {"username": "test", "password": "test"}
        assert kwargs["json"] is None
        assert kwargs["headers"]["Authorization"] == "Bearer test"
        response = requests.Response()
        response.status_code = 403
        response._content = b'{"detail":"denied"}'
        return response

    monkeypatch.setattr("app.scripts.collect_operating_samples.requests.request", denied)
    assert request("POST", "/auth/login", token="test", form={"username": "test", "password": "test"}) == (403, {"detail": "denied"})


def test_cash_movement_survives_an_aml_failure_and_replay_does_not_duplicate(client, auth_headers, db_session, monkeypatch):
    def fail(db, now=None):
        raise RuntimeError("aml down")

    monkeypatch.setattr("app.routers.cash.run_live_aml", fail)
    headers = auth_headers("aml-gap@example.com", "password123")
    user = db_session.query(User).filter_by(email="aml-gap@example.com").one()
    before = user.cash_balance
    key = uuid4().hex
    first = client.post("/cash/movements", headers={**headers, "Idempotency-Key": key},
                        json={"kind": "deposit", "amount": "10.00"})
    assert first.status_code == 200, first.text
    assert set(first.json()) == {"id", "kind", "amount"}
    db_session.expire_all()
    user = db_session.query(User).filter_by(email="aml-gap@example.com").one()
    assert user.cash_balance == before + Decimal("10.00")
    assert db_session.query(CashMovement).count() == 1
    pending = db_session.get(DetectionCursor, "aml")
    assert pending is not None and pending.pending_since is not None
    second = client.post("/cash/movements", headers={**headers, "Idempotency-Key": key},
                         json={"kind": "deposit", "amount": "10.00"})
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    db_session.expire_all()
    assert db_session.query(CashMovement).count() == 1
    assert db_session.get(DetectionCursor, "aml").pending_since is not None

    from app.services.aml_cases import run_live_aml
    cleared = run_live_aml(db_session)
    assert cleared == {"opened": 0, "rules": 0}
    db_session.expire_all()
    assert db_session.get(DetectionCursor, "aml").pending_since is None


def test_withdrawal_replay_skips_screening_and_a_new_one_still_screens(client, auth_headers, db_session, monkeypatch):
    headers = auth_headers("replay-cash@example.com", "password123")
    assert client.put("/auth/name", headers=headers, json={"full_name": "Ada Trader"}).status_code == 200
    calls = {"n": 0}

    def counting(name):
        calls["n"] += 1
        return {"decision": "clear", "source": "fixture", "matched_name": None, "subject_name": name}

    monkeypatch.setattr("app.services.cash_movements.screen_name", counting)
    key = "replaykey1"
    first = client.post("/cash/movements", headers={**headers, "Idempotency-Key": key},
                        json={"kind": "withdrawal", "amount": "15.00"})
    assert first.status_code == 200, first.text
    assert calls["n"] == 1

    def unavailable(name):
        calls["n"] += 1
        return {"decision": "provider_error", "source": "yente", "matched_name": None, "subject_name": name}

    monkeypatch.setattr("app.services.cash_movements.screen_name", unavailable)
    second = client.post("/cash/movements", headers={**headers, "Idempotency-Key": key},
                         json={"kind": "withdrawal", "amount": "15.00"})
    assert second.status_code == 200, second.text
    assert second.json() == first.json()
    assert calls["n"] == 1
    db_session.expire_all()
    assert db_session.query(CashMovement).filter_by(kind="withdrawal").count() == 1
    denied = client.post("/cash/movements", headers={**headers, "Idempotency-Key": "replaykey2"},
                         json={"kind": "withdrawal", "amount": "15.00"})
    assert denied.status_code == 403, denied.text
    assert calls["n"] == 2
    db_session.expire_all()
    assert db_session.query(CashMovement).filter_by(kind="withdrawal").count() == 1


def test_only_one_scheduler_runs_the_cycle(monkeypatch):
    with TemporaryDirectory() as directory:
        engine = create_engine(
            f"sqlite:///{Path(directory) / 'scheduler.db'}",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, future=True)
        monkeypatch.setattr(scheduled_jobs, "SessionLocal", Session)
        calls = []
        guard = threading.Lock()

        def record(name, value):
            def inner(db):
                time.sleep(0.05)
                with guard:
                    calls.append(name)
                return value
            return inner

        monkeypatch.setattr(scheduled_jobs, "refresh_market_caches", record("refresh", {}))
        monkeypatch.setattr(scheduled_jobs, "run_app_controls", record("controls", []))
        monkeypatch.setattr(scheduled_jobs, "backfill_missing_file_evidence", record("backfill", []))
        monkeypatch.setattr(scheduled_jobs, "run_live_surveillance", record("surveillance", {"opened": 0, "rules": 0}))
        monkeypatch.setattr(scheduled_jobs, "run_live_aml", record("aml", {"opened": 0, "rules": 0}))
        threads = [threading.Thread(target=scheduled_jobs.run_scheduled_cycle) for _ in range(2)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(5)
        assert [thread.is_alive() for thread in threads] == [False, False]
        assert calls == ["refresh", "controls", "backfill", "surveillance", "aml"]
        with Session() as db:
            lock = db.get(SchedulerLock, 1)
            assert lock.owner is None
            assert lock.acquired_at is None
            assert lock.next_due is not None
            assert lock.next_due > datetime.now(timezone.utc).replace(tzinfo=None)
        scheduled_jobs.run_scheduled_cycle()
        assert calls == ["refresh", "controls", "backfill", "surveillance", "aml"]
        with Session() as db:
            lock = db.get(SchedulerLock, 1)
            lock.next_due = datetime(2020, 1, 1)
            db.commit()
        scheduled_jobs.run_scheduled_cycle()
        assert calls == ["refresh", "controls", "backfill", "surveillance", "aml"] * 2
        engine.dispose()


def test_a_failing_step_does_not_block_the_rest_of_the_cycle(monkeypatch):
    with TemporaryDirectory() as directory:
        engine = create_engine(
            f"sqlite:///{Path(directory) / 'scheduler_isolation.db'}",
            connect_args={"check_same_thread": False},
            poolclass=NullPool,
        )
        Base.metadata.create_all(engine)
        Session = sessionmaker(bind=engine, future=True)
        monkeypatch.setattr(scheduled_jobs, "SessionLocal", Session)
        calls = []
        guard = threading.Lock()

        def record(name, value):
            def inner(db):
                time.sleep(0.05)
                with guard:
                    calls.append(name)
                return value
            return inner

        def record_briefs(db, limit):
            with guard:
                calls.append("briefs")
            return []

        def record_forecasts(db, limit):
            with guard:
                calls.append("forecasts")
            return []

        def fail_research(db, limit):
            with guard:
                calls.append("research")
            raise RuntimeError("simulated research outage")

        monkeypatch.setattr(scheduled_jobs, "refresh_market_caches", record("refresh", {}))
        monkeypatch.setattr(scheduled_jobs, "run_app_controls", record("controls", []))
        monkeypatch.setattr(scheduled_jobs, "backfill_missing_file_evidence", record("backfill", []))
        monkeypatch.setattr(scheduled_jobs, "run_live_surveillance", record("surveillance", {"opened": 0, "rules": 0}))
        monkeypatch.setattr(scheduled_jobs, "run_live_aml", record("aml", {"opened": 0, "rules": 0}))
        monkeypatch.setattr(scheduled_jobs, "build_daily_briefs", record_briefs)
        monkeypatch.setattr(scheduled_jobs, "process_pending_forecast_jobs", record_forecasts)
        monkeypatch.setattr(scheduled_jobs, "process_pending_research_jobs", fail_research)

        scheduled_jobs.run_scheduled_cycle()
        assert calls == ["refresh", "controls", "backfill", "surveillance", "aml", "research", "briefs", "forecasts"]
        with Session() as db:
            lock = db.get(SchedulerLock, 1)
            assert lock.owner is None
            assert lock.acquired_at is None
            assert lock.next_due is not None
            assert lock.next_due > datetime.now(timezone.utc).replace(tzinfo=None)
        engine.dispose()


def test_a_stale_scheduler_lease_can_be_taken_over():
    with TemporaryDirectory() as directory:
        engine = create_engine(f"sqlite:///{Path(directory) / 'lease.db'}", poolclass=NullPool)
        try:
            Base.metadata.create_all(engine)
            Session = sessionmaker(bind=engine, future=True)
            now = datetime(2026, 11, 4, 12, 0)
            with Session() as db:
                assert acquire_scheduler(db, "first", now, now - timedelta(hours=24))
                assert acquire_scheduler(db, "second", now, now - timedelta(hours=24)) is False
                later = now + timedelta(hours=25)
                assert acquire_scheduler(db, "third", later, now + timedelta(hours=1))
                release_scheduler(db, "third")
                lock = db.get(SchedulerLock, 1)
                assert lock.owner is None
                assert lock.next_due == later + timedelta(hours=settings.scheduled_job_interval_hours)
                assert acquire_scheduler(db, "fourth", later, now + timedelta(hours=1)) is False
        finally:
            engine.dispose()


def _reviewer(db):
    reviewer = User(email=f"reviewer-{uuid4().hex}@example.com", password_hash="x", role="compliance_officer")
    db.add(reviewer)
    db.flush()
    return reviewer


def _wash_pair(db, user_id, asset_id, start):
    db.add_all([
        Trade(user_id=user_id, asset_id=asset_id, side="buy", quantity=Decimal("100"),
              price_at_execution=Decimal("10"), executed_at=start),
        Trade(user_id=user_id, asset_id=asset_id, side="sell", quantity=Decimal("100"),
              price_at_execution=Decimal("10.02"), executed_at=start + timedelta(minutes=5)),
    ])
    db.commit()


def _activate_aml(db, when, rule_id="SM-AML-01"):
    subject = User(email=f"aml-subject-{uuid4().hex}@example.com", password_hash="x")
    requester = User(email=f"aml-requester-{uuid4().hex}@example.com", password_hash="x")
    approver = User(email=f"aml-approver-{uuid4().hex}@example.com", password_hash="x", role="compliance_officer")
    db.add_all([subject, requester, approver])
    db.flush()
    db.add(AmlActivation(
        rule_id=rule_id, version=1, reason="Audit scan", status="active",
        requested_by_user_id=requester.id, approved_by_user_id=approver.id, approved_at=when,
    ))
    db.commit()
    return subject, approver


def _cash_group(db, user_id, start, kind):
    for offset in range(3):
        db.add(CashMovement(
            user_id=user_id, kind=kind, amount=Decimal("4000.00"),
            created_at=start + timedelta(minutes=offset),
        ))
    db.commit()


def test_a_closed_wash_stays_closed_until_new_trades(db_session):
    start = datetime(2026, 11, 4, 15, 0)
    subject, asset = _activate(db_session, start)
    reviewer = _reviewer(db_session)
    db_session.commit()
    _wash_pair(db_session, subject.id, asset.id, start)
    assert run_live_surveillance(db_session, start + timedelta(minutes=10)) == {"opened": 1, "rules": 1}
    case = db_session.query(SurveillanceCase).one()
    close_surveillance_case(db_session, reviewer, case.id, "false_positive", "Same prints, no new trades")
    assert run_live_surveillance(db_session, start + timedelta(minutes=12)) == {"opened": 0, "rules": 1}
    assert db_session.query(SurveillanceCase).count() == 1
    assert db_session.query(SurveillanceCase).one().status == "closed"
    _wash_pair(db_session, subject.id, asset.id, start + timedelta(minutes=6))
    assert run_live_surveillance(db_session, start + timedelta(minutes=14)) == {"opened": 1, "rules": 1}
    assert db_session.query(SurveillanceCase).count() == 2


def test_an_open_wash_case_does_not_hide_a_new_pair(db_session):
    start = datetime(2026, 11, 4, 16, 0)
    subject, asset = _activate(db_session, start)
    _wash_pair(db_session, subject.id, asset.id, start)
    assert run_live_surveillance(db_session, start + timedelta(minutes=10)) == {"opened": 1, "rules": 1}
    _wash_pair(db_session, subject.id, asset.id, start + timedelta(minutes=6))
    assert run_live_surveillance(db_session, start + timedelta(minutes=14)) == {"opened": 1, "rules": 1}
    cases = db_session.query(SurveillanceCase).all()
    assert len(cases) == 2
    assert {case.status for case in cases} == {"open"}


def test_duplicate_open_wash_cases_do_not_stop_the_scan(db_session):
    start = datetime(2026, 11, 4, 16, 30)
    subject, asset = _activate(db_session, start)
    _wash_pair(db_session, subject.id, asset.id, start)
    assert run_live_surveillance(db_session, start + timedelta(minutes=10))["opened"] == 1
    case = db_session.query(SurveillanceCase).one()
    db_session.add(SurveillanceCase(
        rule_id=case.rule_id, rule_version=case.rule_version, subject_user_id=case.subject_user_id,
        symbol=case.symbol, event_ids=case.event_ids, summary=case.summary, status="open",
        due_at=case.due_at, opened_at=case.opened_at,
    ))
    db_session.commit()
    assert run_live_surveillance(db_session, start + timedelta(minutes=11)) == {"opened": 0, "rules": 1}
    assert db_session.query(SurveillanceCase).count() == 2


def test_a_reviewed_wash_from_another_rule_version_does_not_suppress(db_session):
    start = datetime(2026, 11, 4, 18, 30)
    subject, asset = _activate(db_session, start)
    reviewer = _reviewer(db_session)
    db_session.commit()
    _wash_pair(db_session, subject.id, asset.id, start)
    assert run_live_surveillance(db_session, start + timedelta(minutes=10))["opened"] == 1
    case = db_session.query(SurveillanceCase).one()
    case.rule_version = 99
    db_session.commit()
    close_surveillance_case(db_session, reviewer, case.id, "false_positive", "Reviewed under the old version")
    assert run_live_surveillance(db_session, start + timedelta(minutes=12)) == {"opened": 1, "rules": 1}
    versions = sorted(item.rule_version for item in db_session.query(SurveillanceCase).all())
    assert versions == [1, 99]


def test_a_closed_structuring_case_stays_closed_until_new_cash(db_session):
    start = datetime(2026, 11, 4, 15, 0)
    subject, reviewer = _activate_aml(db_session, start)
    _cash_group(db_session, subject.id, start, "deposit")
    assert run_live_aml(db_session, start + timedelta(minutes=10)) == {"opened": 1, "rules": 1}
    case = db_session.query(AmlCase).one()
    close_aml_case(db_session, reviewer, case.id, "false_positive", "Same deposits, no new cash")
    assert run_live_aml(db_session, start + timedelta(minutes=12)) == {"opened": 0, "rules": 1}
    stored = db_session.query(AmlCase).one()
    assert stored.status == "closed"
    _cash_group(db_session, subject.id, start + timedelta(minutes=3), "withdrawal")
    assert run_live_aml(db_session, start + timedelta(minutes=20)) == {"opened": 1, "rules": 1}
    assert db_session.query(AmlCase).count() == 2


def test_duplicate_open_aml_cases_do_not_stop_the_scan(db_session):
    start = datetime(2026, 11, 4, 16, 0)
    subject, _reviewer = _activate_aml(db_session, start)
    _cash_group(db_session, subject.id, start, "deposit")
    assert run_live_aml(db_session, start + timedelta(minutes=10))["opened"] == 1
    case = db_session.query(AmlCase).one()
    db_session.add(AmlCase(
        rule_id=case.rule_id, rule_version=case.rule_version, subject_user_id=case.subject_user_id,
        event_ids=case.event_ids, summary=case.summary, status="open", due_at=case.due_at, opened_at=case.opened_at,
    ))
    db_session.commit()
    assert run_live_aml(db_session, start + timedelta(minutes=11)) == {"opened": 0, "rules": 1}
    assert db_session.query(AmlCase).count() == 2


def _cash_events(start, kind, count):
    return [CashEvent(
        f"{kind}-{offset}-{start.strftime('%Y%m%d%H%M')}",
        start + timedelta(minutes=offset), 1, kind, Decimal("4000"),
    ) for offset in range(count)]


def test_structuring_and_rapid_movement_return_each_successive_pattern():
    structuring = load_aml_rules()["SM-AML-01"]
    start = datetime(2026, 11, 4, 15, 0)
    deposits = _cash_events(start, "deposit", 3) + _cash_events(start + timedelta(hours=25), "deposit", 3)
    found = detect_aml(structuring, deposits)
    identities = [tuple(item.event_ids) for item in found]
    assert identities[0] == tuple(event.event_id for event in deposits[:3])
    assert identities[-1] == tuple(event.event_id for event in deposits[3:])
    assert all(len(item) == 3 for item in identities)

    rapid = load_aml_rules()["SM-AML-02"]
    first = [
        CashEvent("dep-1", start, 7, "deposit", Decimal("5000")),
        CashEvent("out-1", start + timedelta(minutes=30), 7, "withdrawal", Decimal("4500")),
    ]
    second_at = start + timedelta(hours=25)
    second = [
        CashEvent("dep-2", second_at, 7, "deposit", Decimal("5000")),
        CashEvent("out-2", second_at + timedelta(minutes=30), 7, "withdrawal", Decimal("4500")),
    ]
    movements = detect_aml(rapid, first + second)
    assert [tuple(item.event_ids) for item in movements] == [("dep-1", "out-1"), ("dep-2", "out-2")]


def test_the_21st_deposit_opens_a_case_and_the_list_stays_short(db_session):
    start = datetime(2026, 11, 4, 15, 0)
    subject, reviewer = _activate_aml(db_session, start)
    for offset in range(20):
        db_session.add(CashMovement(
            user_id=subject.id, kind="deposit", amount=Decimal("4000.00"),
            created_at=start + timedelta(minutes=offset),
        ))
    db_session.commit()
    assert run_live_aml(db_session, start + timedelta(hours=1)) == {"opened": 1, "rules": 1}
    reviewed = db_session.query(AmlCase).one()
    reviewed_ids = json.loads(reviewed.event_ids)
    assert len(reviewed_ids) == 20
    close_aml_case(db_session, reviewer, reviewed.id, "false_positive", "Twenty deposits reviewed")
    db_session.add(CashMovement(
        user_id=subject.id, kind="deposit", amount=Decimal("4000.00"),
        created_at=start + timedelta(minutes=20),
    ))
    db_session.commit()
    assert run_live_aml(db_session, start + timedelta(hours=1, minutes=5)) == {"opened": 1, "rules": 1}
    opened = db_session.query(AmlCase).filter_by(status="open").one()
    opened_ids = json.loads(opened.event_ids)
    assert len(opened_ids) == 21
    assert opened_ids[:20] == reviewed_ids
    shown = next(item["event_ids"] for item in list_aml_cases(db_session) if item["id"] == opened.id)
    assert shown == opened_ids[:20]
    assert len(shown) == 20
    assert run_live_aml(db_session, start + timedelta(hours=1, minutes=6)) == {"opened": 0, "rules": 1}
    assert db_session.query(AmlCase).count() == 2


def test_a_later_deposit_pattern_is_not_hidden_by_a_reviewed_one(db_session):
    start = datetime(2026, 11, 4, 15, 0)
    subject, reviewer = _activate_aml(db_session, start)
    _cash_group(db_session, subject.id, start, "deposit")
    assert run_live_aml(db_session, start + timedelta(minutes=10))["opened"] == 1
    reviewed = db_session.query(AmlCase).one()
    close_aml_case(db_session, reviewer, reviewed.id, "false_positive", "First deposits reviewed")
    later = start + timedelta(hours=25)
    _cash_group(db_session, subject.id, later, "deposit")
    assert run_live_aml(db_session, later + timedelta(minutes=10)) == {"opened": 1, "rules": 1}
    opened = db_session.query(AmlCase).filter_by(status="open").one()
    assert set(json.loads(opened.event_ids)).isdisjoint(set(json.loads(reviewed.event_ids)))
    assert len(json.loads(opened.event_ids)) == 3


def test_a_later_rapid_movement_is_not_hidden_by_a_reviewed_one(db_session):
    start = datetime(2026, 11, 4, 15, 0)
    subject, reviewer = _activate_aml(db_session, start, "SM-AML-02")
    db_session.add_all([
        CashMovement(user_id=subject.id, kind="deposit", amount=Decimal("5000.00"), created_at=start),
        CashMovement(user_id=subject.id, kind="withdrawal", amount=Decimal("4500.00"),
                     created_at=start + timedelta(minutes=30)),
    ])
    db_session.commit()
    assert run_live_aml(db_session, start + timedelta(minutes=40)) == {"opened": 1, "rules": 1}
    reviewed = db_session.query(AmlCase).one()
    close_aml_case(db_session, reviewer, reviewed.id, "false_positive", "First movement reviewed")
    later = start + timedelta(hours=25)
    db_session.add_all([
        CashMovement(user_id=subject.id, kind="deposit", amount=Decimal("5000.00"), created_at=later),
        CashMovement(user_id=subject.id, kind="withdrawal", amount=Decimal("4500.00"),
                     created_at=later + timedelta(minutes=30)),
    ])
    db_session.commit()
    assert run_live_aml(db_session, later + timedelta(minutes=40)) == {"opened": 1, "rules": 1}
    opened = db_session.query(AmlCase).filter_by(status="open").one()
    assert set(json.loads(opened.event_ids)).isdisjoint(set(json.loads(reviewed.event_ids)))
    assert len(json.loads(opened.event_ids)) == 2


def test_a_reviewed_structuring_case_from_another_version_does_not_suppress(db_session):
    start = datetime(2026, 11, 4, 18, 30)
    subject, reviewer = _activate_aml(db_session, start)
    _cash_group(db_session, subject.id, start, "deposit")
    assert run_live_aml(db_session, start + timedelta(minutes=10))["opened"] == 1
    case = db_session.query(AmlCase).one()
    case.rule_version = 99
    db_session.commit()
    close_aml_case(db_session, reviewer, case.id, "false_positive", "Reviewed under the old version")
    assert run_live_aml(db_session, start + timedelta(minutes=12)) == {"opened": 1, "rules": 1}
    versions = sorted(item.rule_version for item in db_session.query(AmlCase).all())
    assert versions == [1, 99]


def _file_engine(directory, name):
    engine = create_engine(
        f"sqlite:///{Path(directory) / name}",
        connect_args={"check_same_thread": False, "timeout": 10},
        poolclass=NullPool,
    )
    Base.metadata.create_all(engine)
    return engine, sessionmaker(bind=engine, future=True)


def test_concurrent_aml_scans_including_cash_open_one_case(monkeypatch):
    with TemporaryDirectory() as directory:
        engine, Session = _file_engine(directory, "aml-scans.db")
        try:
            start = datetime(2026, 11, 4, 17, 0)
            scan_at = start + timedelta(minutes=10)
            with Session() as db:
                subject, _reviewer = _activate_aml(db, start)
                _cash_group(db, subject.id, start, "deposit")
                subject_id = subject.id
            release = threading.Event()
            entered = threading.Event()
            state = {"first": True}
            gate = threading.Lock()
            real_open = aml_cases.open_cases

            def blocking(db, detections, rules, now=None):
                with gate:
                    am_first = state["first"]
                    state["first"] = False
                if am_first:
                    entered.set()
                    assert release.wait(10)
                return real_open(db, detections, rules, now)

            monkeypatch.setattr(aml_cases, "_now", lambda: scan_at)
            monkeypatch.setattr(aml_cases, "open_cases", blocking)
            errors = []

            def direct():
                with Session() as db:
                    try:
                        run_live_aml(db)
                    except Exception as exc:
                        errors.append(exc)

            def from_cash():
                from app.routers.cash import _run_aml_after_movement
                with Session() as db:
                    _run_aml_after_movement(db)

            first = threading.Thread(target=direct)
            second = threading.Thread(target=from_cash)
            first.start()
            assert entered.wait(5)
            second.start()
            time.sleep(0.4)
            release.set()
            first.join(10)
            second.join(10)
            assert errors == []
            assert [thread.is_alive() for thread in (first, second)] == [False, False]
            with Session() as db:
                assert db.query(AmlCase).filter_by(subject_user_id=subject_id).count() == 1
                cursor = db.get(DetectionCursor, "aml")
                assert cursor is not None and cursor.pending_since is None
        finally:
            engine.dispose()


def test_concurrent_surveillance_scans_open_one_case(monkeypatch):
    with TemporaryDirectory() as directory:
        engine, Session = _file_engine(directory, "surveillance-scans.db")
        try:
            start = datetime(2026, 11, 4, 17, 0)
            scan_at = start + timedelta(minutes=10)
            with Session() as db:
                subject, asset = _activate(db, start)
                _wash_pair(db, subject.id, asset.id, start)
                subject_id = subject.id
            release = threading.Event()
            entered = threading.Event()
            state = {"first": True}
            gate = threading.Lock()
            real_open = surveillance_cases.open_cases

            def blocking(db, detections, rules, now=None):
                with gate:
                    am_first = state["first"]
                    state["first"] = False
                if am_first:
                    entered.set()
                    assert release.wait(10)
                return real_open(db, detections, rules, now)

            monkeypatch.setattr(surveillance_cases, "open_cases", blocking)
            errors = []

            def scan():
                with Session() as db:
                    try:
                        run_live_surveillance(db, scan_at)
                    except Exception as exc:
                        errors.append(exc)

            first = threading.Thread(target=scan)
            second = threading.Thread(target=scan)
            first.start()
            assert entered.wait(5)
            second.start()
            time.sleep(0.4)
            release.set()
            first.join(10)
            second.join(10)
            assert errors == []
            assert [thread.is_alive() for thread in (first, second)] == [False, False]
            with Session() as db:
                assert db.query(SurveillanceCase).filter_by(subject_user_id=subject_id).count() == 1
        finally:
            engine.dispose()
