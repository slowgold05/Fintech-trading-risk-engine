"""App-role grants for research and forecast writes on disposable PostgreSQL.

Skipped unless AUDIT_DATABASE_URL is set. A set URL is refused, before any
connection, unless the preview helper accepts it as disposable. Schema upgrade
uses that helper. The app password exists only for this proof.
"""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import os
import secrets
from uuid import uuid4

import pytest
from sqlalchemy import bindparam, create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.models.asset import Asset
from app.models.forecast_evaluation import ForecastEvaluation
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult
from app.models.holding import Holding
from app.models.ledger_entry import LedgerEntry
from app.models.market_filings_cache import MarketFilingsCache
from app.models.market_symbol import MarketSymbol
from app.models.research_brief import ResearchBrief
from app.models.research_job import ResearchJob
from app.models.research_report import ResearchReport
from app.models.user import User
from app.routers.forecasts import cancel_forecast_job, create_forecast_job
from app.routers.research import cancel_research_job, create_research_job
from app.schemas.forecast_job import ForecastJobCreate
from app.schemas.research_job import ResearchJobCreate
from app.scripts.configure_postgres_role import configure
from app.services import forecast_worker, research_worker, sec_service
from app.services.ledger_service import ensure_opening
from app.services.research_briefs import build_daily_brief
import tests.test_order_preview_postgres as preview


pytestmark = pytest.mark.skipif(
    not os.environ.get("AUDIT_DATABASE_URL"),
    reason="AUDIT_DATABASE_URL is not set",
)

_INSERT = {
    "research_jobs": {
        "user_id", "symbol", "status", "error_message", "prompt_tokens",
        "completion_tokens", "duration_ms",
    },
    "research_reports": {
        "job_id", "user_id", "symbol", "sources", "bull_case", "bear_case",
        "synthesis", "risks", "model_version", "prompt_version", "backend_detail",
    },
    "research_briefs": {"user_id", "brief_date", "entries"},
    "forecast_jobs": {
        "user_id", "symbol", "provider", "adjustment_type", "lookback",
        "horizon", "sample_count", "status", "error_message",
    },
    "forecast_results": {
        "job_id", "user_id", "symbol", "provider", "adjustment_type",
        "model_name", "tokenizer_name", "lookback", "horizon", "sample_count",
        "input_cutoff", "generated_at", "bars",
    },
    "forecast_evaluations": {
        "symbol", "provider", "adjustment_type", "horizon", "window_count",
        "model_mae", "model_directional_accuracy", "baseline_type", "baseline_mae",
        "baseline_directional_accuracy", "weights_exercised", "notes",
    },
    "market_filings_cache": {"symbol", "cik", "payload", "source", "fetched_at"},
}
_UPDATE = {
    "research_jobs": {
        "status", "updated_at", "error_message", "prompt_tokens",
        "completion_tokens", "duration_ms",
    },
    "forecast_jobs": {"status", "updated_at", "error_message"},
    "market_filings_cache": {"cik", "payload", "fetched_at"},
}


def _claim(model, job_id: int):
    """Claim one job the proof just created. Same columns as the worker claim."""

    def claim(db):
        job = db.execute(
            select(model).where(model.id == job_id, model.status == "queued").with_for_update()
        ).scalar_one()
        job.status = "running"
        job.updated_at = datetime_now()
        db.flush()
        return job

    return claim


def datetime_now():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).replace(tzinfo=None)


@pytest.fixture(scope="module")
def app_sessions():
    owner_url = preview._disposable_url()
    preview._upgrade(owner_url)
    password = secrets.token_urlsafe(24)
    configure(owner_url, password)
    app_url = make_url(owner_url).set(username="fintech_app", password=password)
    engine = create_engine(app_url, poolclass=NullPool, future=True)
    sessions = sessionmaker(bind=engine, autoflush=False, future=True)
    try:
        yield sessions
    finally:
        engine.dispose()


def _denied(db, statement: str) -> None:
    with pytest.raises(ProgrammingError) as caught:
        db.execute(text(statement))
    assert getattr(caught.value.orig, "sqlstate", None) == "42501"
    db.rollback()


def _privilege_map(db) -> dict[tuple[str, str], set[str]]:
    rows = db.execute(
        text(
            "SELECT table_name, column_name, privilege_type "
            "FROM information_schema.column_privileges "
            "WHERE grantee = 'fintech_app' AND table_schema = 'public' "
            "AND table_name IN :tables"
        ).bindparams(bindparam("tables", expanding=True)),
        {"tables": list(_INSERT)},
    )
    found: dict[tuple[str, str], set[str]] = {}
    for table_name, column_name, privilege in rows:
        found.setdefault((table_name, privilege), set()).add(column_name)
    return found


def test_expansion_column_grants_are_minimum(app_sessions):
    with app_sessions() as db:
        found = _privilege_map(db)
        for table_name, columns in _INSERT.items():
            assert found[(table_name, "INSERT")] == columns
            assert (table_name, "DELETE") not in found
            assert (table_name, "TRUNCATE") not in found
        for table_name, columns in _UPDATE.items():
            assert found[(table_name, "UPDATE")] == columns
        for table_name in _INSERT:
            if table_name not in _UPDATE:
                assert (table_name, "UPDATE") not in found
        schema_create = db.execute(
            text("SELECT has_schema_privilege('fintech_app', 'public', 'CREATE')")
        ).scalar_one()
        assert schema_create is False
        role_create = db.execute(
            text("SELECT rolcreaterole OR rolcreatedb FROM pg_roles WHERE rolname = 'fintech_app'")
        ).scalar_one()
        assert role_create is False


def test_app_role_can_write_research_and_forecast_and_cannot_mutate_role_or_ledger(app_sessions, monkeypatch):
    symbol = f"G{uuid4().hex[:6].upper()}"
    monkeypatch.setattr(research_worker.settings, "research_synthesis_enabled", True)
    monkeypatch.setattr(research_worker, "get_sec_company_fundamentals", lambda symbol, db: {"name": symbol})
    monkeypatch.setattr(
        research_worker, "get_sec_company_filings", lambda symbol, db, limit=5: {"filings": []}
    )
    synthesis = {
        "bull_case": "demand",
        "bear_case": "competition",
        "synthesis": "balanced",
        "risks": "rates",
        "model_version": "proof-model",
        "prompt_version": "proof-prompt",
        "backend_detail": {"backend": "proof"},
        "prompt_tokens": 11,
        "completion_tokens": 7,
        "duration_ms": 42,
    }

    def _synthesis(symbol_arg, sources):
        if symbol_arg.endswith("FAIL"):
            raise RuntimeError("synthesis unavailable")
        return dict(synthesis)

    monkeypatch.setattr(research_worker, "generate_synthesis", _synthesis)
    monkeypatch.setattr(forecast_worker.settings, "forecast_kronos_enabled", True)

    def _forecast(db, **kwargs):
        if kwargs["symbol"].endswith("FAIL"):
            raise RuntimeError("forecast unavailable")
        return {
            "symbol": kwargs["symbol"],
            "provider": kwargs["provider"],
            "adjustment_type": kwargs["adjustment_type"],
            "model_name": "kronos-proof",
            "tokenizer_name": "kronos-tokenizer",
            "lookback": kwargs["lookback"],
            "horizon": kwargs["horizon"],
            "sample_count": kwargs["sample_count"],
            "input_cutoff": "2026-11-01",
            "generated_at": "2026-11-09T00:00:00Z",
            "bars": [{"session_date": "2026-11-02", "close": "1.00"}],
        }

    monkeypatch.setattr(forecast_worker, "generate_forecast", _forecast)

    with app_sessions() as db:
        user = User(
            email=f"grants-{uuid4().hex}@example.com",
            password_hash="proof",
            full_name="Grant Proof",
            cash_balance=Decimal("1000.00"),
        )
        db.add(user)
        db.flush()
        ensure_opening(db, user)
        db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
        fail_symbol = f"{uuid4().hex[:4].upper()}FAIL"
        db.add(MarketSymbol(symbol=fail_symbol, company_name=fail_symbol, exchange="NASDAQ", is_active=True))
        asset = Asset(symbol=symbol, asset_type="stock", name=symbol, is_active=True)
        db.add(asset)
        db.flush()
        db.add(Holding(user_id=user.id, asset_id=asset.id, quantity=Decimal("1.000000"), avg_cost=Decimal("10.000000")))
        db.commit()
        owner = type("Owner", (), {"id": user.id})()
        ledger_id = db.scalar(select(LedgerEntry.id).where(LedgerEntry.user_id == user.id))
        assert ledger_id is not None

        created = create_research_job(ResearchJobCreate(symbol=symbol), db, owner)
        assert created["status"] == "queued"
        cancelled = cancel_research_job(created["id"], db, owner)
        assert cancelled["status"] == "cancelled"

        completed_job = create_research_job(ResearchJobCreate(symbol=symbol), db, owner)
        monkeypatch.setattr(research_worker, "_claim_job", _claim(ResearchJob, completed_job["id"]))
        processed = research_worker.process_one_job(db)
        assert processed is not None and processed.id == completed_job["id"]
        assert processed.status == "completed"
        assert processed.prompt_tokens == 11
        assert processed.completion_tokens == 7
        assert processed.duration_ms == 42
        report = db.scalar(select(ResearchReport).where(ResearchReport.job_id == processed.id))
        assert report is not None
        assert report.bull_case == "demand"
        # Simple backend stores NULL; the ORM still inserts the column.
        assert report.backend_detail is None

        failed_job = create_research_job(ResearchJobCreate(symbol=fail_symbol), db, owner)
        monkeypatch.setattr(research_worker, "_claim_job", _claim(ResearchJob, failed_job["id"]))
        failed = research_worker.process_one_job(db)
        assert failed is not None and failed.id == failed_job["id"]
        # Synthesis errors are source rows. The job still completes with NULL text.
        assert failed.status == "completed"
        assert failed.error_message is None
        failed_report = db.scalar(select(ResearchReport).where(ResearchReport.job_id == failed.id))
        assert failed_report is not None
        assert failed_report.bull_case is None
        assert failed_report.backend_detail is None
        assert any(
            item["type"] == "local_llm"
            and item["status"] == "unavailable"
            and item["detail"] == "RuntimeError"
            for item in failed_report.sources
        )

        brief = build_daily_brief(db, user.id, date(2026, 11, 9))
        assert brief.user_id == user.id
        assert brief.entries == [{"symbol": symbol, "report_id": report.id}]
        assert db.get(ResearchBrief, brief.id) is not None

        forecast = create_forecast_job(
            ForecastJobCreate(
                symbol=symbol,
                provider="yahoo",
                adjustment_type="raw",
                lookback=1,
                horizon=1,
                sample_count=1,
            ),
            db,
            owner,
        )
        assert forecast["status"] == "queued"
        forecast_cancelled = cancel_forecast_job(forecast["id"], db, owner)
        assert forecast_cancelled["status"] == "cancelled"

        forecast_done = create_forecast_job(
            ForecastJobCreate(
                symbol=symbol,
                provider="yahoo",
                adjustment_type="raw",
                lookback=1,
                horizon=1,
                sample_count=1,
            ),
            db,
            owner,
        )
        monkeypatch.setattr(forecast_worker, "_claim_job", _claim(ForecastJob, forecast_done["id"]))
        finished = forecast_worker.process_one_job(db)
        assert finished is not None and finished.id == forecast_done["id"]
        assert finished.status == "completed"
        result = db.scalar(select(ForecastResult).where(ForecastResult.job_id == finished.id))
        assert result is not None
        assert result.model_name == "kronos-proof"
        assert result.input_cutoff == "2026-11-01"
        assert result.bars[0]["close"] == "1.00"

        forecast_failed = create_forecast_job(
            ForecastJobCreate(
                symbol=fail_symbol,
                provider="yahoo",
                adjustment_type="raw",
                lookback=1,
                horizon=1,
                sample_count=1,
            ),
            db,
            owner,
        )
        monkeypatch.setattr(forecast_worker, "_claim_job", _claim(ForecastJob, forecast_failed["id"]))
        broken = forecast_worker.process_one_job(db)
        assert broken is not None and broken.id == forecast_failed["id"]
        assert broken.status == "failed"
        assert broken.error_message == "forecast unavailable"

        evaluation = ForecastEvaluation(
            symbol=symbol,
            provider="yahoo",
            adjustment_type="raw",
            horizon=1,
            window_count=5,
            model_mae=0.25,
            model_directional_accuracy=0.6,
            baseline_type="last_observed_close",
            baseline_mae=0.4,
            baseline_directional_accuracy=0.5,
            weights_exercised=True,
            notes=None,
        )
        db.add(evaluation)
        db.commit()
        stored = db.get(ForecastEvaluation, evaluation.id)
        assert stored is not None and stored.weights_exercised is True

        _denied(db, "UPDATE users SET role = 'admin'")
        _denied(db, f"UPDATE ledger_entries SET amount = 0 WHERE id = {int(ledger_id)}")
        _denied(db, f"DELETE FROM ledger_entries WHERE id = {int(ledger_id)}")
        _denied(db, "DELETE FROM research_jobs WHERE id = 0")
        _denied(db, "UPDATE research_reports SET synthesis = 'changed'")
        _denied(db, "DELETE FROM forecast_results WHERE id = 0")

        role = db.scalar(select(User.role).where(User.id == user.id))
        amount = db.scalar(select(LedgerEntry.amount).where(LedgerEntry.id == ledger_id))
        assert role == "trader"
        assert amount != 0
        assert db.get(ResearchJob, completed_job["id"]).status == "completed"
        assert db.get(ForecastJob, finished.id).status == "completed"


def _submissions(name: str, form: str):
    return {
        "entityName": name,
        "filings": {
            "recent": {
                "form": [form],
                "filingDate": ["2026-03-01"],
                "reportDate": ["2025-12-31"],
                "accessionNumber": ["0000320193-26-000001"],
                "primaryDocument": ["filing.htm"],
            }
        },
    }


def test_app_role_can_insert_and_refresh_filings_cache(app_sessions, monkeypatch):
    symbol = f"F{uuid4().hex[:6].upper()}"
    cik = "0000320193"
    bodies = [_submissions("First Name", "10-K"), _submissions("Refreshed Name", "8-K")]

    def fake_get(url, headers=None, timeout=30):
        assert url.endswith(f"CIK{cik}.json")
        body = bodies.pop(0)

        class Response:
            def raise_for_status(self):
                return None

            def json(self):
                return body

        return Response()

    monkeypatch.setattr(sec_service, "_get_ticker_map", lambda: {symbol: {"cik_str": 320193}})
    monkeypatch.setattr(sec_service.requests, "get", fake_get)

    with app_sessions() as db:
        inserted = sec_service.get_sec_company_filings(symbol, db, limit=5)
        assert inserted["cik"] == cik
        assert inserted["filings"][0]["form"] == "10-K"
        row = db.get(MarketFilingsCache, symbol)
        assert row is not None
        assert row.source == "sec_edgar"
        assert row.payload["name"] == "First Name"
        assert row.cik == cik

        row.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=25)
        db.commit()
        refreshed = sec_service.get_sec_company_filings(symbol, db, limit=5)
        assert refreshed["name"] == "Refreshed Name"
        assert refreshed["filings"][0]["form"] == "8-K"
        db.refresh(row)
        assert row.payload["name"] == "Refreshed Name"
        assert row.source == "sec_edgar"
        assert row.symbol == symbol

        _denied(db, f"DELETE FROM market_filings_cache WHERE symbol = '{symbol}'")
        _denied(db, f"UPDATE market_filings_cache SET symbol = 'ZZZZ' WHERE symbol = '{symbol}'")
        _denied(db, f"UPDATE market_filings_cache SET source = 'other' WHERE symbol = '{symbol}'")
        kept = db.get(MarketFilingsCache, symbol)
        assert kept is not None and kept.symbol == symbol and kept.source == "sec_edgar"
