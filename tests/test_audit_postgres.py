"""PostgreSQL proofs for the cash and authenticator races.

The fixture is skipped unless AUDIT_DATABASE_URL points at a disposable database.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import threading
from uuid import uuid4

from fastapi import HTTPException
import pytest
from sqlalchemy import create_engine, func, text
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.models.aml import CashMovement
from app.models.ledger_entry import LedgerEntry
from app.models.mfa import LoginChallenge, MfaFactor
from app.models.order_request import OrderRequest
from app.models.user import User
from app.services.cash_movements import post_movement
from app.services.mfa import consume_login_challenge, consume_totp, encrypt_secret, totp_code


pytestmark = pytest.mark.skipif(not os.environ.get("AUDIT_DATABASE_URL"), reason="AUDIT_DATABASE_URL is not set")


def _engine():
    return create_engine(os.environ["AUDIT_DATABASE_URL"], poolclass=NullPool, future=True)


def test_portfolio_snapshot_includes_concurrent_reservations():
    from sqlalchemy import event
    from app.models.asset import Asset
    from app.models.holding import Holding
    from app.models.market_quote_cache import MarketQuoteCache
    from app.models.market_symbol import MarketSymbol
    from app.models.order import Order
    from app.services.portfolio_valuation import build_portfolio_response

    _upgrade()
    engine = _engine()
    sessions = sessionmaker(bind=engine, autoflush=False)
    symbol = f"P1A{uuid4().hex[:10].upper()}"
    email = f"snapshot-{uuid4().hex}@example.com"
    with sessions() as seed:
        user = User(email=email, password_hash="fixture", cash_balance=Decimal("1000"))
        asset = Asset(symbol=symbol, asset_type="stock")
        seed.add_all([user, asset, MarketSymbol(symbol=symbol, company_name="Fixture", exchange="NASDAQ")])
        seed.flush()
        user_id, asset_id = user.id, asset.id
        observed = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)
        seed.add_all([
            Holding(user_id=user_id, asset_id=asset_id, quantity=1, avg_cost=10),
            MarketQuoteCache(symbol=symbol, price=10, source="yahoo", quote_at=observed, fetched_at=observed),
        ])
        seed.commit()

    fired = False

    def update_between_reads(_conn, _cursor, statement, _parameters, _context, _executemany):
        nonlocal fired
        if fired or "market_quote_cache" not in statement.lower():
            return
        fired = True
        with sessions() as writer:
            writer.get(User, user_id).cash_balance = Decimal("500")
            writer.add(Order(user_id=user_id, asset_id=asset_id, side="buy", order_type="limit",
                             quantity=1, remaining_quantity=1, limit_price=100, status="open"))
            writer.commit()

    event.listen(engine, "after_cursor_execute", update_between_reads)
    try:
        with sessions() as reader:
            body = build_portfolio_response(reader, user_id, email)
        assert fired
        assert body["summary"]["cash_balance"] == 1000
        assert body["summary"]["buying_power"] == 1000
    finally:
        event.remove(engine, "after_cursor_execute", update_between_reads)
    try:
        with sessions() as reader:
            later = build_portfolio_response(reader, user_id, email)
        assert later["summary"]["cash_balance"] == 500
        assert later["summary"]["buying_power"] == 400
    finally:
        engine.dispose()


def _sessions():
    return sessionmaker(bind=_engine(), future=True)


def _wait_for_lock(session_factory) -> bool:
    deadline = datetime.now(timezone.utc) + timedelta(seconds=5)
    while datetime.now(timezone.utc) < deadline:
        with session_factory() as db:
            waiting = db.execute(text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock'"
            )).scalar()
        if waiting:
            return True
        threading.Event().wait(0.05)
    return False


def test_migrations_and_app_role_grants_on_disposable_postgres():
    from alembic import command
    from alembic.config import Config

    from app.scripts.configure_postgres_role import configure

    owner_url = os.environ["AUDIT_DATABASE_URL"]
    os.environ["MIGRATION_DATABASE_URL"] = owner_url
    config = Config("alembic.ini")
    command.upgrade(config, "head")
    configure(owner_url, "audit-app-secret")
    with _engine().connect() as connection:
        version = connection.execute(text("SELECT version_num FROM alembic_version")).scalar()
    assert version == "b73e2d9f6a10"

    import psycopg
    from sqlalchemy.engine import make_url

    url = make_url(owner_url)
    with psycopg.connect(host=url.host, port=url.port, dbname=url.database,
                         user="fintech_app", password="audit-app-secret") as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO detection_cursors (name, scanned_through, pending_since, updated_at) "
                "VALUES ('aml', NULL, NULL, NOW()) ON CONFLICT (name) DO UPDATE SET updated_at = NOW()"
            )
            cursor.execute("UPDATE scheduler_locks SET owner = NULL, acquired_at = NULL WHERE id = 1")
            connection.commit()
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                cursor.execute("UPDATE users SET role = 'admin'")
            connection.rollback()


def test_app_role_can_write_runtime_records_without_inserting_review_fields():
    from sqlalchemy.engine import make_url
    from app.models.aml import AmlActivation, AmlCase, Incident
    from app.models.expansion import TradeIntent, RiskBrief, ExpansionAlert
    from app.models.mfa import LoginEvent
    from app.models.role_change_request import RoleChangeRequest
    from app.models.surveillance import SurveillanceActivation, SurveillanceCase
    from app.scripts.configure_postgres_role import configure

    owner_url = os.environ["AUDIT_DATABASE_URL"]
    _upgrade()
    configure(owner_url, "audit-app-secret")
    app_url = make_url(owner_url).set(username="fintech_app", password="audit-app-secret")
    engine = create_engine(app_url, poolclass=NullPool)
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    try:
        with sessionmaker(bind=engine)() as db:
            user = User(email=f"grants-{uuid4().hex}@example.com", password_hash="x", full_name="Grant Test")
            db.add(user)
            db.flush()
            db.add_all([
                LoginEvent(user_id=user.id, email=user.email, user_agent_hash="x", outcome="success",
                           risk_score=0, step_up_satisfied=False, reasons="[]", created_at=now),
                MfaFactor(user_id=user.id, method="totp", secret_ciphertext=encrypt_secret("JBSWY3DPEHPK3PXP")),
                LoginChallenge(user_id=user.id, expires_at=now + timedelta(minutes=5), risk_score=0, reasons="[]"),
                RoleChangeRequest(target_user_id=user.id, old_role="trader", old_change_id=None,
                                  new_role="analyst", reason="Grant proof", requested_by_user_id=user.id),
                SurveillanceActivation(rule_id="SM-SV-01", version=1, reason="Grant proof", requested_by_user_id=user.id),
                AmlActivation(rule_id="SM-AML-01", version=1, reason="Grant proof", requested_by_user_id=user.id),
                SurveillanceCase(rule_id="SM-SV-01", rule_version=1, subject_user_id=user.id, symbol="NVDA",
                                 event_ids='["trade-1"]', summary="Grant proof", opened_at=now, due_at=now + timedelta(days=1)),
                AmlCase(rule_id="SM-AML-01", rule_version=1, subject_user_id=user.id, event_ids='["cash-1"]',
                        summary="Grant proof", opened_at=now, due_at=now + timedelta(days=1)),
                Incident(title="Grant proof", severity="low", summary="Grant proof", discovered_at=now,
                         customer_notice_due_at=now + timedelta(days=30), opened_by_user_id=user.id),
                TradeIntent(symbol="NVDA", side="buy", quantity=1, reference_price=10, rationale="Grant proof",
                            confidence=Decimal("0.5"), data_used="[]", status="proposed", proposed_by="test", created_at=now),
                RiskBrief(brief_date=now.date(), body="Grant proof", figures="{}", created_at=now),
                ExpansionAlert(kind="test", summary="Grant proof", evidence_ref="test", created_at=now),
            ])
            db.flush()
            db.rollback()
            with pytest.raises(ProgrammingError) as denied:
                db.execute(text("INSERT INTO mfa_factors (user_id, method, secret_ciphertext, confirmed_at) "
                                "VALUES (:id, 'totp', 'x', NOW())"), {"id": user.id})
            assert getattr(denied.value.orig, "sqlstate", None) == "42501"
            db.rollback()
    finally:
        engine.dispose()


def test_two_deposits_both_count_and_two_withdrawals_cannot_spend_the_same_cash():
    Session = _sessions()
    with Session() as db:
        user = User(email=f"race-cash-{uuid4().hex}@example.com", password_hash="x", cash_balance=Decimal("100.00"), full_name="Race User")
        db.add(user)
        db.commit()
        user_id = user.id

    held = threading.Event()
    release = threading.Event()
    errors = []

    def first_deposit():
        db = Session()
        try:
            account = db.get(User, user_id)
            post_movement(db, account, "deposit", Decimal("40.00"), None)
            db.add(OrderRequest(user_id=user_id, idempotency_key=uuid4().hex, request_hash="a" * 64,
                                response={"id": 1}))
            db.flush()
            held.set()
            assert release.wait(5)
            db.commit()
        except Exception as exc:
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    def second_deposit():
        db = Session()
        try:
            assert held.wait(5)
            account = db.get(User, user_id)
            post_movement(db, account, "deposit", Decimal("70.00"), None)
            db.commit()
        except Exception as exc:
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    worker = threading.Thread(target=first_deposit)
    worker.start()
    assert held.wait(5)
    with Session() as peek:
        assert peek.get(User, user_id).cash_balance == Decimal("100.00")
        assert peek.query(CashMovement).filter_by(user_id=user_id).count() == 0
        assert peek.query(OrderRequest).filter_by(user_id=user_id).count() == 0
    other = threading.Thread(target=second_deposit)
    other.start()
    assert _wait_for_lock(Session)
    release.set()
    worker.join(5)
    other.join(5)
    assert errors == []
    with Session() as db:
        assert db.get(User, user_id).cash_balance == Decimal("210.00")
        assert db.query(CashMovement).filter_by(user_id=user_id, kind="deposit").count() == 2
        posted = db.query(func.sum(LedgerEntry.amount)).filter(
            LedgerEntry.user_id == user_id, LedgerEntry.account == "cash", LedgerEntry.event_kind == "cash_deposit",
        ).scalar()
        assert posted == Decimal("110.000000")

    held.clear()
    release.clear()
    with Session() as db:
        spender = User(email=f"race-withdraw-{uuid4().hex}@example.com", password_hash="x", cash_balance=Decimal("100.00"), full_name="Race User")
        db.add(spender)
        db.commit()
        spender_id = spender.id

    def first_withdrawal():
        db = Session()
        try:
            account = db.get(User, spender_id)
            post_movement(db, account, "withdrawal", Decimal("80.00"), None)
            held.set()
            assert release.wait(5)
            db.commit()
        except Exception as exc:
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    def second_withdrawal():
        db = Session()
        try:
            assert held.wait(5)
            account = db.get(User, spender_id)
            post_movement(db, account, "withdrawal", Decimal("80.00"), None)
            db.commit()
            errors.append(AssertionError("second withdrawal spent cash"))
        except HTTPException as exc:
            db.rollback()
            if exc.status_code != 400:
                errors.append(exc)
        except Exception as exc:
            errors.append(exc)
            db.rollback()
        finally:
            db.close()

    worker = threading.Thread(target=first_withdrawal)
    other = threading.Thread(target=second_withdrawal)
    worker.start()
    assert held.wait(5)
    other.start()
    assert _wait_for_lock(Session)
    release.set()
    worker.join(5)
    other.join(5)
    assert errors == []
    with Session() as db:
        assert db.get(User, spender_id).cash_balance == Decimal("20.00")
        assert db.query(CashMovement).filter_by(user_id=spender_id, kind="withdrawal").count() == 1


def test_one_authenticator_code_and_one_login_challenge_succeed(monkeypatch):
    fixed = 1_700_000_000.0
    monkeypatch.setattr("app.services.mfa._now_ts", lambda: fixed)
    secret = "JBSWY3DPEHPK3PXP"
    code = totp_code(secret, fixed)
    Session = _sessions()
    with Session() as db:
        user = User(email=f"race-mfa-{uuid4().hex}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
        db.add(user)
        db.flush()
        db.add(MfaFactor(
            user_id=user.id, method="totp", secret_ciphertext=encrypt_secret(secret),
            confirmed_at=datetime(2026, 11, 4, 12), last_counter=None,
        ))
        challenge = LoginChallenge(
            user_id=user.id, expires_at=datetime(2099, 1, 1), risk_score=40, reasons="[]",
        )
        db.add(challenge)
        db.commit()
        user_id = user.id
        challenge_id = challenge.id

    held = threading.Event()
    release = threading.Event()
    results = []

    def accept_first():
        db = Session()
        try:
            step = consume_totp(db, user_id, code)
            held.set()
            assert release.wait(5)
            db.commit()
            results.append(step)
        finally:
            db.close()

    def accept_second():
        db = Session()
        try:
            assert held.wait(5)
            results.append(consume_totp(db, user_id, code))
            db.commit()
        finally:
            db.close()

    first = threading.Thread(target=accept_first)
    second = threading.Thread(target=accept_second)
    first.start()
    assert held.wait(5)
    second.start()
    assert _wait_for_lock(Session)
    release.set()
    first.join(5)
    second.join(5)
    assert sorted(results, key=lambda item: item is None)[0] is not None
    assert None in results
    with Session() as db:
        factor = db.query(MfaFactor).filter_by(user_id=user_id).one()
        assert factor.last_counter == next(item for item in results if item is not None)

    held.clear()
    release.clear()
    challenge_results = []
    # The code above was consumed. Move one step so the challenge can accept a new code.
    monkeypatch.setattr("app.services.mfa._now_ts", lambda: fixed + 30)
    code_two = totp_code(secret, fixed + 30)
    # Rebind the closures by defining them again with the new code.
    def finish_first():
        db = Session()
        try:
            finish_user = consume_login_challenge(db, challenge_id, code_two)
            held.set()
            assert release.wait(5)
            db.commit()
            challenge_results.append(finish_user.id)
        except HTTPException:
            db.rollback()
            challenge_results.append(None)
        finally:
            db.close()

    def finish_second():
        db = Session()
        try:
            assert held.wait(5)
            finish_user = consume_login_challenge(db, challenge_id, code_two)
            db.commit()
            challenge_results.append(finish_user.id)
        except HTTPException:
            db.rollback()
            challenge_results.append(None)
        finally:
            db.close()

    first = threading.Thread(target=finish_first)
    second = threading.Thread(target=finish_second)
    first.start()
    assert held.wait(5)
    second.start()
    assert _wait_for_lock(Session)
    release.set()
    first.join(5)
    second.join(5)
    assert challenge_results.count(user_id) == 1
    assert challenge_results.count(None) == 1
    with Session() as db:
        assert db.get(LoginChallenge, challenge_id).consumed_at is not None


def _upgrade() -> None:
    from alembic import command
    from alembic.config import Config

    os.environ["MIGRATION_DATABASE_URL"] = os.environ["AUDIT_DATABASE_URL"]
    command.upgrade(Config("alembic.ini"), "head")


def _wait_for_cursor_lock(session_factory) -> bool:
    deadline = datetime.now(timezone.utc) + timedelta(seconds=5)
    while datetime.now(timezone.utc) < deadline:
        with session_factory() as db:
            waiting = db.execute(text(
                "SELECT count(*) FROM pg_stat_activity "
                "WHERE datname = current_database() AND wait_event_type = 'Lock' "
                "AND query ILIKE '%detection_cursors%'"
            )).scalar()
        if waiting:
            return True
        threading.Event().wait(0.05)
    return False


def _activity(session_factory) -> list:
    with session_factory() as db:
        return db.execute(text(
            "SELECT pid, wait_event_type, wait_event, state, left(query, 180) "
            "FROM pg_stat_activity WHERE datname = current_database()"
        )).all()


def _blocking_open(real_open):
    release = threading.Event()
    entered = threading.Event()
    state = {"first": True}
    gate = threading.Lock()

    def blocking(db, detections, rules, now=None):
        with gate:
            am_first = state["first"]
            state["first"] = False
        if am_first:
            entered.set()
            assert release.wait(10)
        return real_open(db, detections, rules, now)

    return blocking, entered, release


def test_concurrent_aml_scans_wait_on_the_cursor_and_one_cash_scan_opens_the_case(monkeypatch):
    from app.models.aml import AmlActivation, AmlCase
    from app.models.ops_state import DetectionCursor
    from app.routers.cash import _run_aml_after_movement
    from app.services import aml_cases
    from app.services.aml_cases import run_live_aml
    from app.services.detection_cursor import AML

    _upgrade()
    engine = _engine()
    Session = sessionmaker(bind=engine, future=True)
    start = datetime(2026, 11, 4, 17, 0)
    scan_at = start + timedelta(minutes=10)
    token = uuid4().hex
    try:
        with Session() as db:
            subject = User(email=f"pg-aml-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
            requester = User(email=f"pg-aml-req-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
            approver = User(email=f"pg-aml-app-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"),
                            role="compliance_officer")
            db.add_all([subject, requester, approver])
            db.flush()
            db.add(AmlActivation(
                rule_id="SM-AML-01", version=1, reason="Lock proof", status="active",
                requested_by_user_id=requester.id, approved_by_user_id=approver.id, approved_at=start,
            ))
            for offset in range(3):
                db.add(CashMovement(
                    user_id=subject.id, kind="deposit", amount=Decimal("4000.00"),
                    created_at=start + timedelta(minutes=offset),
                ))
            db.commit()
            subject_id = subject.id
        blocking, entered, release = _blocking_open(aml_cases.open_cases)
        monkeypatch.setattr(aml_cases, "_now", lambda: scan_at)
        monkeypatch.setattr(aml_cases, "open_cases", blocking)
        errors = []

        def direct():
            db = Session()
            try:
                direct_result.append(run_live_aml(db))
            except Exception as exc:
                errors.append(exc)
            finally:
                db.close()

        def from_cash():
            db = Session()
            try:
                _run_aml_after_movement(db)
            except Exception as exc:
                errors.append(exc)
            finally:
                db.close()

        direct_result = []
        holder = threading.Thread(target=direct)
        cash_scan = threading.Thread(target=from_cash)
        saw = False
        detail = ""
        holder.start()
        try:
            assert entered.wait(5)
            cash_scan.start()
            saw = _wait_for_cursor_lock(Session)
            if not saw:
                detail = str(_activity(Session))
        finally:
            release.set()
        holder.join(10)
        cash_scan.join(10)
        assert saw, detail
        assert errors == []
        assert direct_result == [{"opened": 1, "rules": 1}]
        with Session() as db:
            assert db.query(AmlCase).filter_by(subject_user_id=subject_id).count() == 1
            cursor = db.get(DetectionCursor, AML)
            assert cursor.pending_since is None
            follow = run_live_aml(db)
            assert follow == {"opened": 0, "rules": 1}
            assert db.query(AmlCase).filter_by(subject_user_id=subject_id).count() == 1
    finally:
        release_leftover = locals().get("release")
        if release_leftover is not None:
            release_leftover.set()
        engine.dispose()


def test_concurrent_surveillance_scans_wait_on_the_cursor_and_open_one_case(monkeypatch):
    from app.models.asset import Asset
    from app.models.surveillance import SurveillanceActivation, SurveillanceCase
    from app.models.trade import Trade
    from app.services import surveillance_cases
    from app.services.surveillance_cases import run_live_surveillance

    _upgrade()
    engine = _engine()
    Session = sessionmaker(bind=engine, future=True)
    start = datetime(2026, 11, 4, 17, 0)
    scan_at = start + timedelta(minutes=10)
    token = uuid4().hex
    symbol = f"S{token[:6].upper()}"
    try:
        with Session() as db:
            subject = User(email=f"pg-sv-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
            requester = User(email=f"pg-sv-req-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
            approver = User(email=f"pg-sv-app-{token}@example.com", password_hash="x", cash_balance=Decimal("100.00"))
            asset = Asset(symbol=symbol, asset_type="stock", name="Scan proof", is_active=True)
            db.add_all([subject, requester, approver, asset])
            db.flush()
            db.add(SurveillanceActivation(
                rule_id="SM-SV-01", version=1, reason="Lock proof", status="active",
                requested_by_user_id=requester.id, approved_by_user_id=approver.id, approved_at=start,
            ))
            db.add_all([
                Trade(user_id=subject.id, asset_id=asset.id, side="buy", quantity=Decimal("100"),
                      price_at_execution=Decimal("10"), executed_at=start),
                Trade(user_id=subject.id, asset_id=asset.id, side="sell", quantity=Decimal("100"),
                      price_at_execution=Decimal("10.02"), executed_at=start + timedelta(minutes=5)),
            ])
            db.commit()
            subject_id = subject.id
        blocking, entered, release = _blocking_open(surveillance_cases.open_cases)
        monkeypatch.setattr(surveillance_cases, "open_cases", blocking)
        errors = []
        results = []

        def scan():
            db = Session()
            try:
                results.append(run_live_surveillance(db, scan_at))
            except Exception as exc:
                errors.append(exc)
            finally:
                db.close()

        first = threading.Thread(target=scan)
        second = threading.Thread(target=scan)
        saw = False
        detail = ""
        first.start()
        try:
            assert entered.wait(5)
            second.start()
            saw = _wait_for_cursor_lock(Session)
            if not saw:
                detail = str(_activity(Session))
        finally:
            release.set()
        first.join(10)
        second.join(10)
        assert saw, detail
        assert errors == []
        assert sorted(item["opened"] for item in results) == [0, 1]
        with Session() as db:
            assert db.query(SurveillanceCase).filter_by(subject_user_id=subject_id, symbol=symbol).count() == 1
            follow = run_live_surveillance(db, scan_at + timedelta(minutes=1))
            assert follow == {"opened": 0, "rules": 1}
    finally:
        engine.dispose()
