"""Research job intake. A job is queued on create and cancelled on cancel."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol

_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"
_TOO_MANY_JOBS = "Too many pending research jobs. Cancel one before creating another."
_NOT_QUEUED = "Research job is no longer queued."
_MISSING = {"detail": "Research job not found"}


def _seed(db: Session, symbol: str, *, active: bool = True) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=active))
    db.commit()


def _create(client: TestClient, headers: dict, symbol: str = "AAPL"):
    return client.post("/research/jobs", headers=headers, json={"symbol": symbol})


def test_create_job_returns_queued_status(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("jobs-create@example.com")
    response = _create(client, headers, "  aapl ")
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["status"] == "queued"
    assert body["error_message"] is None
    assert body["created_at"].endswith("Z")
    assert body["updated_at"].endswith("Z")


def test_create_job_kicks_off_processing_in_the_background(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    """The 201 returns the queued job; TestClient then runs the background task."""
    _seed(db_session, "AAPL")
    headers = auth_headers("jobs-background@example.com")
    seen: list[int] = []

    class _Session:
        def commit(self) -> None:
            return None

        def rollback(self) -> None:
            return None

        def close(self) -> None:
            return None

    def fake_process(db, max_jobs: int):
        seen.append(max_jobs)
        return []

    monkeypatch.setattr("app.core.database.SessionLocal", lambda: _Session())
    monkeypatch.setattr(
        "app.services.research_worker.process_pending_research_jobs",
        fake_process,
    )

    response = _create(client, headers)
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "queued"
    assert seen == [1]


def test_create_job_rejects_unknown_or_inactive_symbol(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "DEAD", active=False)
    headers = auth_headers("jobs-unknown@example.com")
    unknown = _create(client, headers, "NOPE")
    inactive = _create(client, headers, "DEAD")
    assert unknown.status_code == 400, unknown.text
    assert inactive.status_code == 400, inactive.text
    assert unknown.json()["detail"] == _UNKNOWN_SYMBOL
    assert inactive.json()["detail"] == _UNKNOWN_SYMBOL


def test_create_job_enforces_the_ten_job_cap(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("jobs-cap@example.com")
    created = [_create(client, headers) for _ in range(10)]
    assert [response.status_code for response in created] == [201] * 10
    assert [response.json()["status"] for response in created] == ["queued"] * 10
    blocked = _create(client, headers)
    assert blocked.status_code == 409, blocked.text
    assert blocked.json()["detail"] == _TOO_MANY_JOBS
    listed = client.get("/research/jobs", headers=headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()["jobs"]) == 10


def test_list_jobs_only_returns_the_caller_s_own_jobs(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("jobs-owner@example.com")
    other = auth_headers("jobs-other@example.com")
    own = _create(client, owner)
    theirs = _create(client, other)
    assert own.status_code == theirs.status_code == 201
    listed = client.get("/research/jobs", headers=owner)
    assert listed.status_code == 200, listed.text
    assert [job["id"] for job in listed.json()["jobs"]] == [own.json()["id"]]


def test_get_job_returns_404_for_another_user_s_job(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("jobs-get-owner@example.com")
    other = auth_headers("jobs-get-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    missing = client.get("/research/jobs/999999", headers=other)
    foreign = client.get(f"/research/jobs/{job_id}", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING


def test_cancel_queued_job_succeeds(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("jobs-cancel@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    cancelled = client.post(f"/research/jobs/{created.json()['id']}/cancel", headers=headers)
    assert cancelled.status_code == 200, cancelled.text
    body = cancelled.json()
    assert body["status"] == "cancelled"
    assert body["updated_at"] != created.json()["updated_at"]
    assert body["updated_at"].endswith("Z")


def test_cancel_already_cancelled_job_returns_409(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    headers = auth_headers("jobs-recancel@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    first = client.post(f"/research/jobs/{job_id}/cancel", headers=headers)
    second = client.post(f"/research/jobs/{job_id}/cancel", headers=headers)
    assert first.status_code == 200, first.text
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == _NOT_QUEUED


def test_cancel_another_user_s_job_returns_404(client: TestClient, auth_headers, db_session: Session) -> None:
    _seed(db_session, "AAPL")
    owner = auth_headers("jobs-cancel-owner@example.com")
    other = auth_headers("jobs-cancel-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]
    missing = client.post("/research/jobs/999999/cancel", headers=other)
    foreign = client.post(f"/research/jobs/{job_id}/cancel", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING
    owned = client.get(f"/research/jobs/{job_id}", headers=owner)
    assert owned.status_code == 200, owned.text
    assert owned.json()["status"] == "queued"


def test_requires_authentication(client: TestClient) -> None:
    calls = (
        ("POST", "/research/jobs", {"json": {"symbol": "AAPL"}}),
        ("GET", "/research/jobs", {}),
        ("GET", "/research/jobs/1", {}),
        ("POST", "/research/jobs/1/cancel", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
