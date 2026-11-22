from datetime import date, datetime, timezone

import pytest
from sqlalchemy.exc import OperationalError

from tests.night_market_fixtures import bar, listing, market

PRIOR = date(2025, 1, 6)
LATEST = date(2025, 1, 7)


def test_screener_uses_one_session_pair_and_pages_deterministically(market):
    db, client = market
    db.add_all([
        listing("AAPL"), listing("AAA"), listing("DOWN"), listing("MISS"),
        listing("MIX"), listing("FLAG"), listing("FUTURE"), listing("XLK", is_etf=True),
        listing("TEST", is_test=True), listing("OLD", is_active=False),
        listing("ENERGY", "Energy"),
    ])
    db.flush()
    db.add_all([
        bar("AAPL", PRIOR, 100), bar("AAPL", LATEST, 110),
        bar("AAA", PRIOR, 200), bar("AAA", LATEST, 220),
        bar("DOWN", PRIOR, 100), bar("DOWN", LATEST, 80),
        bar("MISS", date(2025, 1, 3), 100), bar("MISS", LATEST, 99),
        bar("MIX", PRIOR, 100), bar("MIX", LATEST, 100, basis="raw"),
        bar("FLAG", PRIOR, 100), bar("FLAG", LATEST, 101, quality="flagged"),
        bar("FUTURE", PRIOR, 100), bar("FUTURE", LATEST, 100, fetched_at=datetime(2099, 1, 1, tzinfo=timezone.utc)),
        bar("XLK", PRIOR, 100), bar("XLK", LATEST, 110),
        bar("TEST", PRIOR, 100), bar("TEST", LATEST, 110),
        bar("OLD", PRIOR, 100), bar("OLD", LATEST, 110),
        bar("ENERGY", PRIOR, 100, provider="massive"), bar("ENERGY", LATEST, 110, provider="massive"),
    ])
    db.commit()

    page = client.get("/night/screener?min_move=0.05&limit=1&offset=1").json()
    assert page["session_date"] == "2025-01-07"
    assert page["previous_session_date"] == "2025-01-06"
    assert page["price_type"] == "end_of_day"
    assert (page["universe_count"], page["covered_count"], page["matched_count"]) == (8, 3, 2)
    assert page["coverage"] == "partial"
    item, = page["items"]
    assert (item["symbol"], item["detail_available"]) == ("AAPL", True)
    assert (item["close"], item["move"]) == ("110.000000", "0.1")
    assert item["source"] == {
        "provider": "yahoo", "basis": "split_adjusted", "session_date": "2025-01-07",
        "observed_at": "2025-02-01T00:00:00Z", "coverage": "available",
    }

    ascending = client.get("/night/screener?sector=technology&sort=move_asc").json()
    assert [(item["symbol"], item["detail_available"]) for item in ascending["items"]] == [
        ("DOWN", False), ("AAA", False), ("AAPL", True),
    ]
    assert ascending["universe_count"] == 7
    no_compatible = client.get("/night/screener?sector=Energy").json()
    assert (no_compatible["universe_count"], no_compatible["covered_count"], no_compatible["items"]) == (1, 0, [])
    assert no_compatible["coverage"] == "missing"

    no_matches = client.get("/night/screener?min_move=0.2").json()
    assert (no_matches["coverage"], no_matches["covered_count"], no_matches["matched_count"], no_matches["items"]) == (
        "partial", 3, 0, [],
    )


def test_screener_keeps_unpriced_universe_counts(market):
    db, client = market
    db.add(listing("AAPL"))
    db.commit()
    body = client.get("/night/screener").json()
    assert (body["session_date"], body["previous_session_date"], body["coverage"]) == (None, None, "missing")
    assert (body["universe_count"], body["covered_count"], body["matched_count"]) == (1, 0, 0)
    assert body["items"] == []


@pytest.mark.parametrize(("query", "field"), [
    ("sector=unknown", "sector"), ("sort=random", "sort"), ("limit=101", "limit"),
    ("limit=0", "limit"), ("offset=-1", "offset"), ("min_move=NaN", "min_move"),
    ("min_move=Infinity", "min_move"), ("min_move=-1.1", "min_move"),
])
def test_screener_bad_requests_return_night_error(market, query, field):
    _, client = market
    response = client.get(f"/night/screener?{query}")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert detail["code"] == "invalid_request"
    assert field in detail["fields"]


def test_screener_storage_failure_is_sanitized(market, monkeypatch):
    _, client = market

    def unavailable(*args, **kwargs):
        raise OperationalError("private statement", {"private": "parameter"}, RuntimeError("private database address"))

    monkeypatch.setattr("app.services.night_market_screener.read_session_moves", unavailable)
    response = client.get("/night/screener")
    assert response.status_code == 503
    assert response.json() == {
        "detail": {"code": "storage_unavailable", "message": "Market cache is temporarily unavailable."}
    }
