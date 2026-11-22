from datetime import date

import pytest

from tests.night_market_fixtures import bar, listing, market


def test_compare_rebases_once_and_keeps_internal_and_trailing_gaps(market):
    db, client = market
    db.add_all([listing("AAPL"), listing("MSFT")])
    db.flush()
    days = [date(2025, 1, day) for day in (6, 7, 8, 9, 10)]
    db.add_all([
        bar("AAPL", days[0], 90),
        bar("AAPL", days[1], 100), bar("MSFT", days[1], 200),
        bar("AAPL", days[2], 110), bar("MSFT", days[2], 220, quality="flagged"),
        bar("MSFT", days[3], 250, basis="raw"),
        bar("AAPL", days[4], 120), bar("MSFT", days[4], 240, provider="massive"),
        bar("AAPL", days[0], 80, provider="massive"), bar("MSFT", days[0], 160, provider="massive"),
        bar("AAPL", days[2], 100, provider="massive"), bar("MSFT", days[2], 250, provider="massive"),
        bar("AAPL", days[1], 100, provider="massive"), bar("MSFT", days[1], 200, provider="massive"),
    ])
    db.commit()

    response = client.get("/night/compare?symbols=aapl,MSFT&range=1m&provider=yahoo")
    assert response.status_code == 200
    body = response.json()
    assert body["base_date"] == "2025-01-07"
    assert body["dates"] == ["2025-01-07", "2025-01-08", "2025-01-09", "2025-01-10"]
    assert body["requested_start"] == "2024-12-10" and body["requested_end"] == "2025-01-10"
    assert body["coverage"] == "partial"
    assert body["return_type"] == "price_return" and body["price_type"] == "end_of_day"
    first, second = body["series"]
    assert (first["symbol"], first["returns"], first["missing_sessions"]) == ("AAPL", ["0", "0.1", None, "0.2"], 1)
    assert (second["symbol"], second["returns"], second["missing_sessions"]) == ("MSFT", ["0", None, None, None], 3)
    assert all(s["source"]["provider"] == "yahoo" and s["source"]["basis"] == "split_adjusted" for s in body["series"])

    auto = client.get("/night/compare?symbols=MSFT,AAPL&range=1m").json()
    assert auto["base_date"] == "2025-01-06"
    assert [s["symbol"] for s in auto["series"]] == ["MSFT", "AAPL"]
    assert {s["source"]["provider"] for s in auto["series"]} == {"massive"}


def test_compare_requires_one_provider_and_shared_valid_date(market):
    db, client = market
    db.add_all([listing("AAPL"), listing("MSFT")])
    db.flush()
    first, second = date(2025, 1, 6), date(2025, 1, 7)
    db.add_all([
        bar("AAPL", first, 100), bar("MSFT", second, 200),
        bar("MSFT", first, 200, provider="other"),
        bar("MSFT", first, 200, basis="raw"),
    ])
    db.commit()

    for suffix in ("", "&provider=yahoo", "&provider=no_data"):
        response = client.get("/night/compare?symbols=AAPL,MSFT" + suffix)
        assert response.status_code == 200
        body = response.json()
        assert (body["coverage"], body["base_date"], body["dates"]) == ("missing", None, [])
        assert all(s["returns"] == [] and s["source"]["coverage"] == "missing" for s in body["series"])


@pytest.mark.parametrize(("query", "field"), [
    ("symbols=", "symbols"), ("symbols=AAPL", "symbols"), ("symbols=AAPL,aapl", "symbols"),
    ("symbols=N1,N2,N3,N4,N5", "symbols"), ("symbols=AAPL,!", "symbols"),
    ("symbols=AAPL,MSFT&range=2m", "range"), ("symbols=AAPL,MSFT&provider=%21", "provider"),
])
def test_compare_rejects_malformed_lists_and_filters(market, query, field):
    _, client = market
    response = client.get("/night/compare?" + query)
    assert response.status_code == 422
    assert field in response.json()["detail"]["fields"]


def test_compare_identifies_unknown_symbol(market):
    db, client = market
    db.add(listing("AAPL"))
    db.commit()
    response = client.get("/night/compare?symbols=AAPL,ABSENT")
    assert response.status_code == 404
    assert response.json()["detail"]["code"] == "unknown_symbol"
