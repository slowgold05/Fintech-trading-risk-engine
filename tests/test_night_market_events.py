from app.models.market_filings_cache import MarketFilingsCache
from tests.night_market_fixtures import OBSERVED, listing, market


def _filing(**overrides):
    return {
        "form": "10-K", "filingDate": "2025-01-24", "reportDate": "2024-12-31",
        "accessionNumber": "0000320193-25-000002", "primaryDocument": "filing-20241231.htm",
        **overrides,
    }


def test_events_returns_verified_sec_filing_dates_and_explicit_missing_kinds(market):
    db, client = market
    aapl = listing("AAPL")
    aapl.cik = "0000320193"
    db.add(aapl)
    db.add(MarketFilingsCache(
        symbol="AAPL", cik="0000320193", source="sec_edgar", fetched_at=OBSERVED.replace(tzinfo=None),
        payload={
            "cik": "0000320193",
            "filings": [
                _filing(filingDate="2025-01-10", accessionNumber="0000320193-25-000001", form="8-K"),
                _filing(primaryDocument="xslF345X05/filing-20241231.htm"),
                _filing(),
                _filing(filingDate="2025-02-30", accessionNumber="0000320193-25-000003"),
                _filing(primaryDocument="../escape.htm", accessionNumber="0000320193-25-000004"),
                _filing(accessionNumber="0000320193%2f25%2f000005"),
                _filing(form="dividend", accessionNumber="0000320193-25-000006"),
            ],
            "dividends": [{"cash": 1}], "splits": [{"ratio": "2:1"}],
        },
    ))
    db.commit()

    response = client.get("/night/events/aapl")
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "AAPL" and body["coverage"] == "partial"
    assert body["coverage_by_kind"] == {"filing": "available", "dividend": "missing", "split": "missing"}
    first, second = body["items"]
    assert first == {
        "kind": "filing", "date": "2025-01-24", "title": "SEC Form 10-K", "form": "10-K",
        "url": "https://www.sec.gov/Archives/edgar/data/320193/000032019325000002/xslF345X05/filing-20241231.htm",
        "source": {
            "provider": "sec_edgar", "basis": "filing", "session_date": None,
            "observed_at": "2025-02-01T00:00:00Z", "coverage": "available",
        },
    }
    assert second["date"] == "2025-01-10" and second["form"] == "8-K"
    assert client.get("/night/events/AAPL?limit=1").json()["items"] == [first]


def test_events_identifies_missing_invalid_and_unknown_symbols(market):
    db, client = market
    db.add_all([listing("MSFT"), listing("AAPL"), listing("TSLA")])
    db.add_all([
        MarketFilingsCache(
            symbol="AAPL", cik="0000320193", source="sec_edgar", fetched_at=OBSERVED.replace(tzinfo=None),
            payload={"cik": "9999999999", "filings": [_filing()]},
        ),
        MarketFilingsCache(
            symbol="TSLA", cik="0001318605", source="other", fetched_at=OBSERVED.replace(tzinfo=None),
            payload={"cik": "0001318605", "filings": [_filing()]},
        ),
    ])
    db.commit()

    for ticker in ("AAPL", "MSFT", "TSLA"):
        response = client.get(f"/night/events/{ticker}")
        assert response.status_code == 200
        assert response.json() == {
            "symbol": ticker, "coverage": "missing",
            "coverage_by_kind": {"filing": "missing", "dividend": "missing", "split": "missing"},
            "items": [],
        }
    unknown = client.get("/night/events/UNKNOWN")
    assert unknown.status_code == 404 and unknown.json()["detail"]["code"] == "unknown_symbol"
    for path in ("/night/events/%21", "/night/events/AAPL?limit=0", "/night/events/AAPL?limit=51"):
        invalid = client.get(path)
        assert invalid.status_code == 422 and invalid.json()["detail"]["code"] == "invalid_request"
