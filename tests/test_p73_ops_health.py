from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.forecast_job import ForecastJob
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.user import User
from app.scripts.set_user_role import set_role


def _compliance_headers(auth_headers, db_session: Session, email: str) -> dict:
    headers = auth_headers(email)
    set_role(db_session, email, "auditor", "test-operator", "Ops health")
    db_session.commit()
    return headers


def _seed_symbol(db: Session, symbol: str = "AAPL") -> None:
    db.add(MarketSymbol(
        symbol=symbol, company_name=symbol, exchange="NASDAQ",
        is_etf=False, is_test=False, is_active=True, refresh_tier="daily",
    ))
    db.commit()


def test_ops_health_rejects_trader(client: TestClient, auth_headers) -> None:
    headers = auth_headers("ops-trader@example.com")
    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 403, response.text


def test_ops_health_counts_stale_quote(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-stale@example.com")
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(MarketSymbol(
        symbol="AAPL", company_name="Apple Inc.", exchange="NASDAQ",
        is_etf=False, is_test=False, is_active=True, refresh_tier="daily",
    ))
    db_session.add(MarketQuoteCache(
        symbol="AAPL", price=100, change_amount=0, change_percent=0, volume=1000,
        source="yahoo", fetched_at=now, quote_at=now - timedelta(days=10),
    ))
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    freshness = response.json()["market_data_freshness"]
    assert freshness["stale"] == 1
    assert freshness == {"live-ish": 0, "delayed": 0, "cached": 0, "stale": 1}


def test_ops_health_queued_research_age(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-queued@example.com")
    _seed_symbol(db_session)
    user = db_session.query(User).filter_by(email="ops-queued@example.com").one()
    created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=45)
    db_session.add(ResearchJob(
        user_id=user.id, symbol="AAPL", status="queued",
        created_at=created_at, updated_at=created_at,
    ))
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    research = response.json()["job_queues"]["research"]
    assert research["queued_count"] == 1
    assert research["oldest_queued_age_seconds"] is not None
    assert abs(research["oldest_queued_age_seconds"] - 45) <= 5


def test_ops_health_counts_recent_failed_forecasts_only(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-failed@example.com")
    _seed_symbol(db_session)
    user = db_session.query(User).filter_by(email="ops-failed@example.com").one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    common = dict(
        user_id=user.id, symbol="AAPL", provider="yahoo", adjustment_type="raw",
        lookback=100, horizon=10, sample_count=1, status="failed",
    )
    db_session.add(ForecastJob(**common, created_at=now - timedelta(hours=1), updated_at=now - timedelta(hours=1)))
    db_session.add(ForecastJob(**common, created_at=now - timedelta(hours=48), updated_at=now - timedelta(hours=48)))
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    forecast = response.json()["job_queues"]["forecast"]
    assert forecast["failed_last_24h_count"] == 1


def test_ops_health_empty_queue_age_is_null(client: TestClient, auth_headers, db_session: Session) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-empty@example.com")
    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["job_queues"]["research"]["oldest_queued_age_seconds"] is None
    assert body["job_queues"]["forecast"]["oldest_queued_age_seconds"] is None


def test_ops_health_ai_usage_sums_only_jobs_with_token_counts(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-ai-usage@example.com")
    _seed_symbol(db_session)
    user = db_session.query(User).filter_by(email="ops-ai-usage@example.com").one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    common = dict(
        user_id=user.id, symbol="AAPL", status="completed",
        created_at=now, updated_at=now,
    )
    db_session.add(ResearchJob(**common, prompt_tokens=700, completion_tokens=400, duration_ms=4000))
    db_session.add(ResearchJob(**common, prompt_tokens=750, completion_tokens=420, duration_ms=4240))
    db_session.add(ResearchJob(**common))
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["ai_usage"] == {
        "research_jobs_with_token_counts": 2,
        "total_prompt_tokens": 1450,
        "total_completion_tokens": 820,
        "avg_duration_ms": 4120,
    }


def test_ops_health_ai_usage_is_zero_when_no_rows_have_data(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-ai-empty@example.com")
    _seed_symbol(db_session)
    user = db_session.query(User).filter_by(email="ops-ai-empty@example.com").one()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    db_session.add(ResearchJob(
        user_id=user.id, symbol="AAPL", status="completed",
        created_at=now, updated_at=now,
    ))
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["ai_usage"] == {
        "research_jobs_with_token_counts": 0,
        "total_prompt_tokens": 0,
        "total_completion_tokens": 0,
        "avg_duration_ms": 0,
    }


def _seed_massive_bar(
    db: Session,
    symbol: str,
    session_date: date,
    *,
    quality_status: str,
) -> None:
    db.add(MarketBarDaily(
        symbol=symbol,
        session_date=session_date,
        provider="massive",
        adjustment_type="raw",
        open=Decimal("100"),
        high=Decimal("100"),
        low=Decimal("100"),
        close=Decimal("100"),
        volume=100,
        fetched_at=datetime(session_date.year, session_date.month, session_date.day, tzinfo=timezone.utc),
        quality_status=quality_status,
    ))


def test_ops_health_reports_massive_symbols_covered_and_latest_session(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-massive-covered@example.com")
    _seed_symbol(db_session, "AAPL")
    _seed_symbol(db_session, "MSFT")
    _seed_massive_bar(db_session, "AAPL", date(2026, 11, 9), quality_status="valid")
    _seed_massive_bar(db_session, "MSFT", date(2026, 11, 10), quality_status="valid")
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    massive = response.json()["massive_ingestion"]
    assert massive["symbols_covered"] == 2
    assert massive["latest_session_date"] == "2026-11-10"


def test_ops_health_massive_flagged_last_30_days_only(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-massive-flagged@example.com")
    _seed_symbol(db_session, "AAPL")
    _seed_massive_bar(db_session, "AAPL", date.today() - timedelta(days=5), quality_status="flagged")
    _seed_massive_bar(db_session, "AAPL", date.today() - timedelta(days=40), quality_status="flagged")
    db_session.commit()

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["massive_ingestion"]["flagged_last_30d_count"] == 1


def test_ops_health_massive_ingestion_is_empty_by_default(
    client: TestClient, auth_headers, db_session: Session,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-massive-empty@example.com")
    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["massive_ingestion"] == {
        "symbols_covered": 0,
        "latest_session_date": None,
        "flagged_last_30d_count": 0,
    }


def test_ops_health_reports_zero_kronos_cache_when_the_directory_does_not_exist(
    client: TestClient, auth_headers, db_session: Session, monkeypatch, tmp_path,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-kronos-missing@example.com")
    monkeypatch.setattr(settings, "forecast_kronos_cache_dir", str(tmp_path / "nonexistent-kronos-cache"))

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["kronos_worker"] == {
        "weights_cache_dir_exists": False,
        "weights_cache_bytes": 0,
    }


def test_ops_health_reports_real_kronos_cache_directory_size(
    client: TestClient, auth_headers, db_session: Session, monkeypatch, tmp_path,
) -> None:
    headers = _compliance_headers(auth_headers, db_session, "ops-kronos-cache@example.com")
    cache_dir = tmp_path / "kronos-cache"
    cache_dir.mkdir()
    (cache_dir / "weights.bin").write_bytes(b"a" * 100)
    (cache_dir / "tokenizer.bin").write_bytes(b"b" * 50)
    monkeypatch.setattr(settings, "forecast_kronos_cache_dir", str(cache_dir))

    response = client.get("/compliance/ops-health", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["kronos_worker"] == {
        "weights_cache_dir_exists": True,
        "weights_cache_bytes": 150,
    }
