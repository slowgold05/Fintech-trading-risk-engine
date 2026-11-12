"""Bounded forecast worker. A queued job becomes one result, or a recorded failure."""

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.forecast_result import ForecastResult
from app.models.market_symbol import MarketSymbol
from app.services.forecast_worker import process_pending_forecast_jobs

_MISSING = {"detail": "Forecast not found"}
_DISABLED = "Kronos forecasting is disabled (forecast_kronos_enabled is false)."
_RESULT_FIELDS = (
    "symbol",
    "provider",
    "adjustment_type",
    "model_name",
    "tokenizer_name",
    "lookback",
    "horizon",
    "sample_count",
    "input_cutoff",
    "generated_at",
    "bars",
)


def _seed(db: Session, symbol: str) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
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


def _canned(**overrides) -> dict:
    body = {
        "symbol": "AAPL",
        "provider": "yahoo",
        "adjustment_type": "raw",
        "model_name": "NeoQuasar/Kronos-small",
        "tokenizer_name": "NeoQuasar/Kronos-Tokenizer-base",
        "lookback": 100,
        "horizon": 10,
        "sample_count": 1,
        "input_cutoff": "2026-11-06",
        "generated_at": "2026-11-08T15:04:05Z",
        "bars": [
            {
                "session_date": "2026-11-09",
                "open": 10.5,
                "high": 11.25,
                "low": 10.0,
                "close": 11.0,
                "volume": 1000.0,
            },
            {
                "session_date": "2026-11-10",
                "open": 11.0,
                "high": 12.5,
                "low": 10.75,
                "close": 12.0,
                "volume": 1500.5,
            },
        ],
    }
    body.update(overrides)
    return body


def _results_for(db: Session, job_id: int) -> list[ForecastResult]:
    return db.execute(select(ForecastResult).where(ForecastResult.job_id == job_id)).scalars().all()


def _enable(monkeypatch, generate) -> None:
    monkeypatch.setattr(settings, "forecast_kronos_enabled", True)
    monkeypatch.setattr("app.services.forecast_worker.generate_forecast", generate)


def test_processing_a_queued_job_with_kronos_disabled_fails_with_a_clear_message(
    client: TestClient, auth_headers, db_session: Session
) -> None:
    assert settings.forecast_kronos_enabled is False
    _seed(db_session, "AAPL")
    headers = auth_headers("forecast-worker-off@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "failed"
    assert processed[0].error_message == _DISABLED
    assert _results_for(db_session, job_id) == []

    job = client.get(f"/forecasts/jobs/{job_id}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "failed"
    assert job.json()["error_message"] == _DISABLED
    listed = client.get("/forecasts", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json() == {"results": []}


def test_processing_a_queued_job_with_kronos_enabled_and_succeeding_completes_it(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    canned = _canned()

    def succeed(db, **kwargs):
        return canned

    _seed(db_session, "AAPL")
    _enable(monkeypatch, succeed)
    headers = auth_headers("forecast-worker-ok@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "completed"
    assert processed[0].error_message is None

    listed = client.get("/forecasts", headers=headers)
    assert listed.status_code == 200, listed.text
    results = listed.json()["results"]
    assert len(results) == 1
    listed_result = results[0]
    assert listed_result["job_id"] == job_id
    fetched = client.get(f"/forecasts/{listed_result['id']}", headers=headers)
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    assert body == listed_result
    for field in _RESULT_FIELDS:
        assert body[field] == canned[field]
    assert body["bars"] == canned["bars"]
    assert len(body["bars"]) == 2


def test_processing_a_queued_job_with_kronos_enabled_but_failing_fails_the_job(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def fail(db, **kwargs):
        raise TimeoutError("TimeoutError: kronos predictor failed")

    _seed(db_session, "AAPL")
    _enable(monkeypatch, fail)
    headers = auth_headers("forecast-worker-down@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "failed"
    assert "TimeoutError" in processed[0].error_message
    assert processed[0].error_message == "TimeoutError: kronos predictor failed"
    assert _results_for(db_session, job_id) == []

    job = client.get(f"/forecasts/jobs/{job_id}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "failed"
    assert "TimeoutError" in job.json()["error_message"]


def test_worker_still_processes_the_next_job_after_one_fails_mid_batch(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    calls = []

    def fail_then_succeed(db, **kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise TimeoutError("TimeoutError: kronos predictor failed")
        return _canned()

    _seed(db_session, "AAPL")
    _enable(monkeypatch, fail_then_succeed)
    headers = auth_headers("forecast-worker-mid-batch@example.com")
    first = _create(client, headers)
    second = _create(client, headers)
    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text
    first_id = first.json()["id"]
    second_id = second.json()["id"]

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 2
    assert processed[0].status == "failed"
    assert "TimeoutError" in processed[0].error_message
    assert processed[1].status == "completed"
    assert len(_results_for(db_session, second_id)) == 1
    assert _results_for(db_session, first_id) == []


def test_worker_replays_the_job_s_own_stored_parameters(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    seen = []

    def record(db, **kwargs):
        seen.append(kwargs)
        return _canned(
            symbol=kwargs["symbol"],
            provider=kwargs["provider"],
            adjustment_type=kwargs["adjustment_type"],
            lookback=kwargs["lookback"],
            horizon=kwargs["horizon"],
            sample_count=kwargs["sample_count"],
        )

    _seed(db_session, "AAPL")
    _enable(monkeypatch, record)
    headers = auth_headers("forecast-worker-replay@example.com")
    created = _create(
        client,
        headers,
        provider="stooq",
        adjustment_type="split_adjusted",
        lookback=64,
        horizon=7,
        sample_count=3,
    )
    assert created.status_code == 201, created.text
    body = created.json()

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "completed"
    assert seen == [{
        "symbol": "AAPL",
        "provider": "stooq",
        "adjustment_type": "split_adjusted",
        "lookback": 64,
        "horizon": 7,
        "sample_count": 3,
    }]
    assert body["provider"] == "stooq"
    assert body["lookback"] == 64


def test_worker_never_processes_more_than_max_jobs(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def succeed(db, **kwargs):
        return _canned()

    _seed(db_session, "AAPL")
    _enable(monkeypatch, succeed)
    headers = auth_headers("forecast-worker-bound@example.com")
    created = [_create(client, headers) for _ in range(3)]
    assert [response.status_code for response in created] == [201, 201, 201]
    ids = [response.json()["id"] for response in created]

    processed = process_pending_forecast_jobs(db_session, 2)
    assert [job.id for job in processed] == ids[:2]
    assert [job.status for job in processed] == ["completed", "completed"]

    listed = client.get("/forecasts/jobs", headers=headers)
    assert listed.status_code == 200, listed.text
    statuses = {job["id"]: job["status"] for job in listed.json()["jobs"]}
    assert statuses[ids[0]] == "completed"
    assert statuses[ids[1]] == "completed"
    assert statuses[ids[2]] == "queued"


def test_worker_returns_empty_list_immediately_when_queue_is_empty(auth_headers, db_session: Session) -> None:
    auth_headers("forecast-worker-empty@example.com")
    assert process_pending_forecast_jobs(db_session, 5) == []


def test_get_result_returns_404_for_another_user_s_result(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def succeed(db, **kwargs):
        return _canned()

    _seed(db_session, "AAPL")
    _enable(monkeypatch, succeed)
    owner = auth_headers("forecast-result-owner@example.com")
    other = auth_headers("forecast-result-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    process_pending_forecast_jobs(db_session, 5)
    listed = client.get("/forecasts", headers=owner)
    assert listed.status_code == 200, listed.text
    result_id = listed.json()["results"][0]["id"]

    missing = client.get("/forecasts/999999", headers=other)
    foreign = client.get(f"/forecasts/{result_id}", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING
    owned = client.get(f"/forecasts/{result_id}", headers=owner)
    assert owned.status_code == 200, owned.text
    assert owned.json()["job_id"] == created.json()["id"]


def test_list_results_only_returns_the_caller_s_own_results(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def succeed(db, **kwargs):
        return _canned(symbol=kwargs["symbol"])

    _seed(db_session, "AAPL")
    _enable(monkeypatch, succeed)
    owner = auth_headers("forecast-list-owner@example.com")
    other = auth_headers("forecast-list-other@example.com")
    own = _create(client, owner)
    theirs = _create(client, other)
    assert own.status_code == theirs.status_code == 201
    process_pending_forecast_jobs(db_session, 5)

    listed = client.get("/forecasts", headers=owner)
    assert listed.status_code == 200, listed.text
    assert [result["job_id"] for result in listed.json()["results"]] == [own.json()["id"]]
    other_listed = client.get("/forecasts", headers=other)
    assert other_listed.status_code == 200, other_listed.text
    assert [result["job_id"] for result in other_listed.json()["results"]] == [theirs.json()["id"]]


def test_requires_authentication(client: TestClient) -> None:
    calls = (
        ("GET", "/forecasts", {}),
        ("GET", "/forecasts/1", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
