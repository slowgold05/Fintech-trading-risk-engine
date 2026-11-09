"""Forecast job intake. A job is queued on create and cancelled on cancel."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_symbol import MarketSymbol

_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"
_INVALID_ADJUSTMENT = "adjustment_type must be raw or split_adjusted."
_TOO_MANY_JOBS = "Too many pending forecast jobs. Cancel one before creating another."
_NOT_QUEUED = "Forecast job is no longer queued."
_MISSING = {"detail": "Forecast job not found"}


def _seed(db: Session, symbol: str, *, active: bool = True) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=active))
    db.commit()


def _payload(symbol: str = "AAPL", **overrides) -> dict:
    body = {
        "symbol": symbol,
        "provider": "yahoo",
        "adjustment_type": "raw",
        "lookback": 100,
        "horizon": 10,
        "sample_count": 1,
    }
    body.update(overrides)
    return body


def _create(client: TestClient, headers: dict, symbol: str = "AAPL", **overrides):
    return client.post("/forecasts/jobs", headers=headers, json=_payload(symbol, **overrides))


def test_create_job_returns_queued_status(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-create@example.com")
    response = _create(client, headers, "  aapl ")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["provider"] == "yahoo"
    assert body["adjustment_type"] == "raw"
    assert body["lookback"] == 100
    assert body["horizon"] == 10
    assert body["sample_count"] == 1
    assert body["status"] == "queued"
    assert body["error_message"] is None
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")


def test_create_job_rejects_unknown_or_inactive_symbol(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "DEAD", active=False)
    headers = auth_headers("forecast-unknown@example.com")
    unknown = _create(client, headers, "NOPE")
    inactive = _create(client, headers, "DEAD")
    assert unknown.status_code == 400, unknown.text
    assert inactive.status_code == 400, inactive.text
    assert unknown.json()["detail"] == _UNKNOWN_SYMBOL
    assert inactive.json()["detail"] == _UNKNOWN_SYMBOL


def test_create_job_rejects_invalid_adjustment_type(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-adjustment@example.com")
    response = _create(client, headers, adjustment_type="bogus")
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == _INVALID_ADJUSTMENT


def test_create_job_rejects_lookback_over_the_configured_max(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-lookback@example.com")
    response = _create(client, headers, lookback=settings.forecast_kronos_max_lookback + 1)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == f"lookback must not exceed {settings.forecast_kronos_max_lookback}."


def test_create_job_rejects_horizon_over_the_configured_max(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-horizon@example.com")
    response = _create(client, headers, horizon=settings.forecast_kronos_max_horizon + 1)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == f"horizon must not exceed {settings.forecast_kronos_max_horizon}."


def test_create_job_rejects_sample_count_over_the_configured_max(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-samples@example.com")
    response = _create(client, headers, sample_count=settings.forecast_kronos_max_sample_count + 1)
    assert response.status_code == 422, response.text
    assert response.json()["detail"] == f"sample_count must not exceed {settings.forecast_kronos_max_sample_count}."


def test_create_job_enforces_the_five_job_cap(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-cap@example.com")
    created = [_create(client, headers) for _ in range(5)]
    assert [response.status_code for response in created] == [201] * 5
    assert [response.json()["status"] for response in created] == ["queued"] * 5
    blocked = _create(client, headers)
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == _TOO_MANY_JOBS
    listed = client.get("/forecasts/jobs", headers=headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["jobs"]) == 5


def test_list_jobs_only_returns_the_caller_s_own_jobs(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("forecast-owner@example.com")
    other = auth_headers("forecast-other@example.com")
    own = _create(client, owner)
    theirs = _create(client, other)
    assert own.status_code == theirs.status_code == 201
    listed = client.get("/forecasts/jobs", headers=owner)
    assert listed.status_code == 200, listed.text
    assert [job["id"] for job in listed.json()["jobs"]] == [own.json()["id"]]


def test_get_job_returns_404_for_another_user_s_job(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("forecast-get-owner@example.com")
    other = auth_headers("forecast-get-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    missing = client.get("/forecasts/jobs/999999", headers=other)
    foreign = client.get(f"/forecasts/jobs/{job_id}", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING


def test_cancel_queued_job_succeeds(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-cancel@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    cancelled = client.post(f"/forecasts/jobs/{created.json()['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text
    body = cancelled.json()
    assert body["status"] == "cancelled"
    assert body["updated_at"] != created.json()["updated_at"]
    assert body["updated_at"].endswith("Z")


def test_cancel_already_cancelled_job_returns_409(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-recancel@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    first = client.post(f"/forecasts/jobs/{job_id}/cancel", headers=headers)
    second = client.post(f"/forecasts/jobs/{job_id}/cancel", headers=headers)
    assert first.status_code == 200, first.text
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == _NOT_QUEUED


def test_cancel_another_user_s_job_returns_404(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("forecast-cancel-owner@example.com")
    other = auth_headers("forecast-cancel-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    missing = client.post("/forecasts/jobs/999999/cancel", headers=other)
    foreign = client.post(f"/forecasts/jobs/{job_id}/cancel", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING
    owned = client.get(f"/forecasts/jobs/{job_id}", headers=owner)
    assert owned.status_code == 200, owned.text
    assert owned.json()["status"] == "queued"


def test_requires_authentication(client: TestClient) -> None:
    calls = (
        ("POST", "/forecasts/jobs", {"json": _payload()}),
        ("GET", "/forecasts/jobs", {}),
        ("GET", "/forecasts/jobs/1", {}),
        ("POST", "/forecasts/jobs/1/cancel", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
