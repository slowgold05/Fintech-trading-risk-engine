from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.forecast_job import ForecastJob
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
