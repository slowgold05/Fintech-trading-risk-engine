"""Bounded research worker. A queued job becomes a sources-only report."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.market_symbol import MarketSymbol
from app.services.research_worker import process_pending_research_jobs

_MISSING = {"detail": "Research report not found"}
_AI_FIELDS = ("bull_case", "bear_case", "synthesis", "risks", "model_version", "prompt_version")


def _seed(db: Session, symbol: str) -> None:
    db.add(MarketSymbol(symbol=symbol, company_name=symbol, exchange="NASDAQ", is_active=True))
    db.commit()


def _create(client: TestClient, headers: dict, symbol: str = "AAPL"):
    return client.post("/research/jobs", headers=headers, json={"symbol": symbol})


def _fundamentals(symbol, db):
    return {"name": "Apple Inc.", "symbol": symbol}


def _filings(symbol, db, forms=None, limit=10):
    return {"symbol": symbol, "filings": [{"form": "10-K"}, {"form": "10-Q"}]}


def _patch_sources(monkeypatch, fundamentals=_fundamentals) -> None:
    monkeypatch.setattr("app.services.research_worker.get_sec_company_fundamentals", fundamentals)
    monkeypatch.setattr("app.services.research_worker.get_sec_company_filings", _filings)


def test_processing_a_queued_job_completes_it_with_a_report(client: TestClient, auth_headers, db_session: Session, monkeypatch) -> None:
    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    headers = auth_headers("worker-complete@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    job = client.get(f"/research/jobs/{job_id}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"

    listed = client.get("/research/reports", headers=headers)
    assert listed.status_code == 200, listed.text
    reports = listed.json()["reports"]
    assert len(reports) == 1
    report = reports[0]
    assert report["job_id"] == job_id
    assert [source["status"] for source in report["sources"]] == ["ok", "ok"]
    assert [source["type"] for source in report["sources"]] == ["sec_fundamentals", "sec_filings"]
    assert all(report[field] is None for field in _AI_FIELDS)


def test_one_source_failing_does_not_fail_the_job(client: TestClient, auth_headers, db_session: Session, monkeypatch) -> None:
    _seed(db_session, "AAPL")

    def fundamentals_down(symbol, db):
        raise ValueError(f"SEC company record not found for {symbol}.")

    _patch_sources(monkeypatch, fundamentals=fundamentals_down)
    headers = auth_headers("worker-partial@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    process_pending_research_jobs(db_session, 5)

    job = client.get(f"/research/jobs/{created.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"
    listed = client.get("/research/reports", headers=headers)
    assert listed.status_code == 200, listed.text
    sources = listed.json()["reports"][0]["sources"]
    by_type = {source["type"]: source for source in sources}
    assert by_type["sec_fundamentals"]["status"] == "unavailable"
    assert by_type["sec_fundamentals"]["detail"] == "ValueError"
    assert by_type["sec_filings"]["status"] == "ok"


def test_worker_never_processes_more_than_max_jobs(client: TestClient, auth_headers, db_session: Session, monkeypatch) -> None:
    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    headers = auth_headers("worker-bound@example.com")
    created = [_create(client, headers) for _ in range(3)]
    assert [response.status_code for response in created] == [201, 201, 201]
    ids = [response.json()["id"] for response in created]

    processed = process_pending_research_jobs(db_session, 2)
    assert [job.id for job in processed] == ids[:2]

    listed = client.get("/research/jobs", headers=headers)
    assert listed.status_code == 200, listed.text
    statuses = {job["id"]: job["status"] for job in listed.json()["jobs"]}
    assert statuses[ids[0]] == "completed"
    assert statuses[ids[1]] == "completed"
    assert statuses[ids[2]] == "queued"


def test_worker_returns_none_immediately_when_queue_is_empty(auth_headers, db_session: Session) -> None:
    auth_headers("worker-empty@example.com")
    assert process_pending_research_jobs(db_session, 5) == []


def test_get_report_returns_404_for_another_user_s_report(client: TestClient, auth_headers, db_session: Session, monkeypatch) -> None:
    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    owner = auth_headers("worker-get-owner@example.com")
    other = auth_headers("worker-get-other@example.com")
    created = _create(client, owner)
    assert created.status_code == 201, created.text
    process_pending_research_jobs(db_session, 5)
    listed = client.get("/research/reports", headers=owner)
    assert listed.status_code == 200, listed.text
    report_id = listed.json()["reports"][0]["id"]

    missing = client.get("/research/reports/999999", headers=other)
    foreign = client.get(f"/research/reports/{report_id}", headers=other)
    assert missing.status_code == 404, missing.text
    assert foreign.status_code == 404, foreign.text
    assert foreign.json() == missing.json() == _MISSING
    owned = client.get(f"/research/reports/{report_id}", headers=owner)
    assert owned.status_code == 200, owned.text
    assert owned.json()["job_id"] == created.json()["id"]


def test_list_reports_only_returns_the_caller_s_own_reports(client: TestClient, auth_headers, db_session: Session, monkeypatch) -> None:
    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    owner = auth_headers("worker-list-owner@example.com")
    other = auth_headers("worker-list-other@example.com")
    own = _create(client, owner)
    theirs = _create(client, other)
    assert own.status_code == theirs.status_code == 201
    process_pending_research_jobs(db_session, 5)

    listed = client.get("/research/reports", headers=owner)
    assert listed.status_code == 200, listed.text
    assert [report["job_id"] for report in listed.json()["reports"]] == [own.json()["id"]]
    other_listed = client.get("/research/reports", headers=other)
    assert other_listed.status_code == 200, other_listed.text
    assert [report["job_id"] for report in other_listed.json()["reports"]] == [theirs.json()["id"]]


def test_requires_authentication(client: TestClient) -> None:
    calls = (
        ("GET", "/research/reports", {}),
        ("GET", "/research/reports/1", {}),
    )
    for method, path, kwargs in calls:
        response = client.request(method, path, **kwargs)
        assert response.status_code == 401, response.text
