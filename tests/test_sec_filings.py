"""SEC EDGAR filings index. Fixtures only; no live SEC calls."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.models.market_filings_cache import MarketFilingsCache
from app.services import sec_service

TICKER_MAP = {
    "0": {"cik_str": 123456, "ticker": "ACME", "title": "ACME Corporation"},
}

SUBMISSIONS = {
    "entityName": "ACME Corporation",
    "filings": {
        "recent": {
            "form": ["10-Q", "10-K", "8-K", "DEF 14A", "10-Q"],
            "filingDate": ["2026-05-01", "2026-02-15", "2026-06-10", "2026-04-01", "2026-08-01"],
            "reportDate": ["2026-03-31", "2025-12-31", "", "", "2026-06-30"],
            "accessionNumber": [
                "0000123456-26-000050",
                "0000123456-26-000010",
                "0000123456-26-000070",
                "0000123456-26-000040",
                "0000123456-26-000090",
            ],
            "primaryDocument": [
                "acme-20260331.htm",
                "acme-20251231.htm",
                "acme-8k-20260610.htm",
                "acme-defproxy.htm",
                "acme-20260630.htm",
            ],
        }
    },
}

CACHED_PAYLOAD = {
    "name": "ACME Corporation",
    "cik": "0000123456",
    "filings": [
        {
            "form": form,
            "filingDate": filing_date,
            "reportDate": report_date,
            "accessionNumber": accession,
            "primaryDocument": primary_document,
        }
        for form, filing_date, report_date, accession, primary_document in zip(
            SUBMISSIONS["filings"]["recent"]["form"],
            SUBMISSIONS["filings"]["recent"]["filingDate"],
            SUBMISSIONS["filings"]["recent"]["reportDate"],
            SUBMISSIONS["filings"]["recent"]["accessionNumber"],
            SUBMISSIONS["filings"]["recent"]["primaryDocument"],
            strict=False,
        )
    ],
}

REF_DEFAULT = [
    {
        "form": "10-Q",
        "filing_date": "2026-08-01",
        "report_date": "2026-06-30",
        "accession_number": "0000123456-26-000090",
        "primary_document": "acme-20260630.htm",
        "document_url": "https://www.sec.gov/Archives/edgar/data/123456/000012345626000090/acme-20260630.htm",
    },
    {
        "form": "8-K",
        "filing_date": "2026-06-10",
        "report_date": "",
        "accession_number": "0000123456-26-000070",
        "primary_document": "acme-8k-20260610.htm",
        "document_url": "https://www.sec.gov/Archives/edgar/data/123456/000012345626000070/acme-8k-20260610.htm",
    },
    {
        "form": "10-Q",
        "filing_date": "2026-05-01",
        "report_date": "2026-03-31",
        "accession_number": "0000123456-26-000050",
        "primary_document": "acme-20260331.htm",
        "document_url": "https://www.sec.gov/Archives/edgar/data/123456/000012345626000050/acme-20260331.htm",
    },
    {
        "form": "10-K",
        "filing_date": "2026-02-15",
        "report_date": "2025-12-31",
        "accession_number": "0000123456-26-000010",
        "primary_document": "acme-20251231.htm",
        "document_url": "https://www.sec.gov/Archives/edgar/data/123456/000012345626000010/acme-20251231.htm",
    },
]


@pytest.fixture(autouse=True)
def reset_ticker_cache():
    sec_service._ticker_cache = None
    yield
    sec_service._ticker_cache = None


def _fake_sec_get(url, headers=None, timeout=None):
    if "company_tickers" in url:
        payload = TICKER_MAP
    elif "submissions/CIK" in url:
        payload = SUBMISSIONS
    else:
        raise AssertionError(f"unexpected SEC URL: {url}")
    return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)


def _mock_sec(monkeypatch):
    monkeypatch.setattr("app.services.sec_service.requests.get", _fake_sec_get)


def _auth(auth_headers):
    return auth_headers("filings-user@example.com")


def test_default_forms_and_limit_reference_vector(client, auth_headers, monkeypatch):
    _mock_sec(monkeypatch)
    response = client.get("/research/filings/ACME", headers=_auth(auth_headers))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["symbol"] == "ACME"
    assert body["cik"] == "0000123456"
    assert body["name"] == "ACME Corporation"
    assert body["source"] == "SEC EDGAR"
    assert body["fetched_at"].endswith("Z")
    assert body["filings"] == REF_DEFAULT


def test_limit_truncates_to_first_n(client, auth_headers, monkeypatch):
    _mock_sec(monkeypatch)
    response = client.get("/research/filings/ACME", params={"limit": 2}, headers=_auth(auth_headers))
    assert response.status_code == 200, response.text
    assert response.json()["filings"] == REF_DEFAULT[:2]


def test_explicit_forms_replaces_default_not_extends_it(client, auth_headers, monkeypatch):
    _mock_sec(monkeypatch)
    response = client.get("/research/filings/ACME", params={"forms": "10-K"}, headers=_auth(auth_headers))
    assert response.status_code == 200, response.text
    assert response.json()["filings"] == [REF_DEFAULT[3]]


def test_no_matching_forms_returns_empty_list_not_error(client, auth_headers, monkeypatch):
    _mock_sec(monkeypatch)
    response = client.get("/research/filings/ACME", params={"forms": "20-F"}, headers=_auth(auth_headers))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filings"] == []
    assert body["symbol"] == "ACME"
    assert body["cik"] == "0000123456"


def test_unknown_symbol_returns_404(client, auth_headers, monkeypatch):
    _mock_sec(monkeypatch)
    response = client.get("/research/filings/NOPE", headers=_auth(auth_headers))
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "SEC company record not found for NOPE."


def test_fresh_cache_skips_the_live_submissions_call(client, auth_headers, db_session, monkeypatch):
    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    db_session.add(MarketFilingsCache(
        symbol="ACME",
        cik="0000123456",
        payload=CACHED_PAYLOAD,
        fetched_at=fetched_at,
    ))
    db_session.commit()

    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.sec_service.requests.get", boom)
    response = client.get("/research/filings/ACME", headers=_auth(auth_headers))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["filings"] == REF_DEFAULT
    assert body["cik"] == "0000123456"
    assert body["name"] == "ACME Corporation"
    assert body["source"] == "SEC EDGAR"
    assert body["fetched_at"] == sec_service._iso_z(fetched_at)


def test_requires_authentication(client):
    response = client.get("/research/filings/ACME")
    assert response.status_code == 401
