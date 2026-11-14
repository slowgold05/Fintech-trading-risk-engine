"""Bounded research worker. A queued job becomes a sources-only report."""

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
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


def _forbid_local_model(*args, **kwargs):
    raise AssertionError("local model must not be called while research synthesis is disabled")


def _report_for(client: TestClient, headers: dict) -> dict:
    listed = client.get("/research/reports", headers=headers)
    assert listed.status_code == 200, listed.text
    reports = listed.json()["reports"]
    assert len(reports) == 1
    return reports[0]


def test_synthesis_disabled_by_default_produces_no_local_llm_source_entry(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    assert settings.research_synthesis_enabled is False
    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr("app.services.research_llm.requests.post", _forbid_local_model)
    headers = auth_headers("worker-synthesis-off@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "completed"

    report = _report_for(client, headers)
    assert [source["type"] for source in report["sources"]] == ["sec_fundamentals", "sec_filings"]
    assert all(source["type"] != "local_llm" for source in report["sources"])
    assert all(report[field] is None for field in _AI_FIELDS)


def test_synthesis_enabled_and_succeeding_populates_the_report(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    canned = {
        "bull_case": "Services growth supports a higher multiple.",
        "bear_case": "Hardware revenue is cyclical.",
        "synthesis": "Cautiously constructive on the services mix.",
        "risks": "Regulatory pressure on the app store.",
        "model_version": "qwen3:14b",
        "prompt_version": "v1",
    }

    def _fake_generate(symbol, sources):
        assert symbol == "AAPL"
        assert [source["type"] for source in sources] == ["sec_fundamentals", "sec_filings"]
        return canned

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr("app.services.research_worker.generate_synthesis", _fake_generate)
    headers = auth_headers("worker-synthesis-ok@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    job = client.get(f"/research/jobs/{created.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"
    report = _report_for(client, headers)
    for field, value in canned.items():
        assert report[field] == value
    assert report["sources"][2] == {
        "type": "local_llm",
        "status": "ok",
        "detail": f"synthesis generated via {settings.research_llm_model}",
    }


def test_synthesis_enabled_but_failing_still_completes_the_job(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def _fail(symbol, sources):
        raise TimeoutError("ollama timed out")

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr("app.services.research_worker.generate_synthesis", _fail)
    headers = auth_headers("worker-synthesis-down@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    job = client.get(f"/research/jobs/{created.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"
    report = _report_for(client, headers)
    assert all(report[field] is None for field in _AI_FIELDS)
    assert report["sources"][2] == {
        "type": "local_llm",
        "status": "unavailable",
        "detail": "TimeoutError",
    }
    assert [source["type"] for source in report["sources"][:2]] == ["sec_fundamentals", "sec_filings"]


def test_tradingagents_backend_populates_backend_detail_on_success(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    backend_detail = {
        "signal": "Buy",
        "market_report": "market marker",
        "sentiment_report": "sentiment marker",
        "news_report": "news marker",
        "fundamentals_report": "fundamentals marker",
        "trader_investment_plan": "trader marker",
        "final_trade_decision": "decision marker",
    }
    canned = {
        "bull_case": "Services growth supports a higher multiple.",
        "bear_case": "Hardware revenue is cyclical.",
        "synthesis": "Cautiously constructive on the services mix.",
        "risks": "Regulatory pressure on the app store.",
        "model_version": "qwen3:14b",
        "prompt_version": "tradingagents-v1",
        "backend_detail": backend_detail,
    }

    def _fake(symbol, as_of_date):
        assert symbol == "AAPL"
        return canned

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr(settings, "research_synthesis_backend", "tradingagents")
    monkeypatch.setattr("app.services.research_worker.generate_tradingagents_synthesis", _fake)
    headers = auth_headers("worker-tradingagents-ok@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    job = client.get(f"/research/jobs/{created.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"
    report = _report_for(client, headers)
    assert report["backend_detail"] == backend_detail
    for field, value in canned.items():
        assert report[field] == value
    assert report["sources"][2] == {
        "type": "local_llm_tradingagents",
        "status": "ok",
        "detail": f"synthesis generated via tradingagents ({settings.research_llm_model})",
    }
    assert all(source["type"] != "local_llm" for source in report["sources"])


def test_tradingagents_backend_failure_still_completes_the_job(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    def _fail(symbol, as_of_date):
        raise TimeoutError("tradingagents timed out")

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr(settings, "research_synthesis_backend", "tradingagents")
    monkeypatch.setattr("app.services.research_worker.generate_tradingagents_synthesis", _fail)
    headers = auth_headers("worker-tradingagents-down@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    job = client.get(f"/research/jobs/{created.json()['id']}", headers=headers)
    assert job.status_code == 200, job.text
    assert job.json()["status"] == "completed"
    report = _report_for(client, headers)
    assert report["backend_detail"] is None
    assert all(report[field] is None for field in _AI_FIELDS)
    assert report["sources"][2] == {
        "type": "local_llm_tradingagents",
        "status": "unavailable",
        "detail": "TimeoutError",
    }
    assert all(source["type"] != "local_llm" for source in report["sources"])


def test_simple_backend_still_produces_a_null_backend_detail(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    assert settings.research_synthesis_backend == "simple"
    canned = {
        "bull_case": "Services growth supports a higher multiple.",
        "bear_case": "Hardware revenue is cyclical.",
        "synthesis": "Cautiously constructive on the services mix.",
        "risks": "Regulatory pressure on the app store.",
        "model_version": "qwen3:14b",
        "prompt_version": "v1",
    }

    def _fake_generate(symbol, sources):
        assert symbol == "AAPL"
        assert [source["type"] for source in sources] == ["sec_fundamentals", "sec_filings"]
        return canned

    def _forbid_tradingagents(*args, **kwargs):
        raise AssertionError("tradingagents backend must not run for the simple backend")

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr("app.services.research_worker.generate_synthesis", _fake_generate)
    monkeypatch.setattr(
        "app.services.research_worker.generate_tradingagents_synthesis", _forbid_tradingagents
    )
    headers = auth_headers("worker-simple-backend@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1

    report = _report_for(client, headers)
    assert report["backend_detail"] is None
    for field, value in canned.items():
        assert report[field] == value
    assert report["sources"][2] == {
        "type": "local_llm",
        "status": "ok",
        "detail": f"synthesis generated via {settings.research_llm_model}",
    }
    assert all(source["type"] != "local_llm_tradingagents" for source in report["sources"])


def test_completed_job_persists_ai_usage_from_synthesis(
    client: TestClient, auth_headers, db_session: Session, monkeypatch
) -> None:
    canned = {
        "bull_case": "Services growth supports a higher multiple.",
        "bear_case": "Hardware revenue is cyclical.",
        "synthesis": "Cautiously constructive on the services mix.",
        "risks": "Regulatory pressure on the app store.",
        "model_version": "qwen3:14b",
        "prompt_version": "v1",
        "prompt_tokens": 700,
        "completion_tokens": 400,
        "duration_ms": 4000,
    }

    def _fake_generate(symbol, sources):
        return dict(canned)

    _seed(db_session, "AAPL")
    _patch_sources(monkeypatch)
    monkeypatch.setattr(settings, "research_synthesis_enabled", True)
    monkeypatch.setattr("app.services.research_worker.generate_synthesis", _fake_generate)
    headers = auth_headers("worker-ai-usage@example.com")
    created = _create(client, headers)
    assert created.status_code == 201, created.text

    processed = process_pending_research_jobs(db_session, 5)
    assert len(processed) == 1
    job = processed[0]
    db_session.refresh(job)
    assert job.status == "completed"
    assert job.prompt_tokens == 700
    assert job.completion_tokens == 400
    assert job.duration_ms == 4000

    report = _report_for(client, headers)
    assert report["bull_case"] == canned["bull_case"]
    assert report["backend_detail"] is None

