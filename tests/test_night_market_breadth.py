from datetime import date

from tests.night_market_fixtures import bar, listing, market

PRIOR = date(2025, 1, 6)
LATEST = date(2025, 1, 7)


def test_breadth_counts_stocks_and_uses_same_period_for_proxy_and_sector_median(market):
    db, client = market
    db.add_all([
        listing("AAPL"), listing("MSFT"), listing("MISS"),
        listing("XOM", "Energy"), listing("AMZN", "Consumer Discretionary"),
        listing("UNDISC", None), listing("XLK", None, is_etf=True),
        listing("XLE", "Energy", is_etf=True), listing("XLY", None, is_etf=True),
        listing("TEST", is_test=True), listing("OLD", is_active=False),
    ])
    db.flush()
    db.add_all([
        bar("AAPL", PRIOR, 100), bar("AAPL", LATEST, 110),
        bar("MSFT", PRIOR, 100), bar("MSFT", LATEST, 80),
        bar("MISS", LATEST, 100),
        bar("XOM", PRIOR, 100), bar("XOM", LATEST, 100),
        bar("AMZN", PRIOR, 100), bar("AMZN", LATEST, 105),
        bar("XLK", PRIOR, 100), bar("XLK", LATEST, 104),
        bar("XLE", PRIOR, 100), bar("XLE", LATEST, 104, provider="massive"),
        bar("XLY", PRIOR, 100), bar("XLY", LATEST, 105),
        bar("TEST", PRIOR, 100), bar("TEST", LATEST, 110),
        bar("OLD", PRIOR, 100), bar("OLD", LATEST, 110),
    ])
    db.commit()

    response = client.get("/night/breadth")
    assert response.status_code == 200
    body = response.json()
    assert body["session_date"] == "2025-01-07" and body["previous_session_date"] == "2025-01-06"
    assert (body["universe_count"], body["covered_count"], body["excluded_count"]) == (6, 4, 2)
    assert (body["advancing"], body["declining"], body["flat"]) == (2, 1, 1)
    assert [item["symbol"] for item in body["items"]] == ["AAPL", "AMZN", "MSFT", "XOM"]
    sectors = {item["sector"]: item for item in body["sectors"]}
    tech = sectors["Technology"]
    assert (tech["covered"], tech["median_move"], tech["proxy_coverage"]) == (2, "-0.05", "available")
    assert (tech["proxy"]["symbol"], tech["proxy"]["move"]) == ("XLK", "0.04")
    assert tech["proxy"]["source"] == body["items"][0]["source"]
    assert sectors["Energy"]["proxy_symbol"] == "XLE"
    assert sectors["Energy"]["proxy_coverage"] == "missing"
    assert sectors["Energy"]["proxy"] is None
    assert sectors["Consumer Discretionary"]["proxy"]["symbol"] == "XLY"
    assert sectors["Other"]["covered"] == 0 and sectors["Other"]["median_move"] is None

    scoped = client.get("/night/breadth?sector=technology").json()
    assert (scoped["universe_count"], scoped["covered_count"], scoped["excluded_count"]) == (3, 2, 1)
    assert (scoped["advancing"], scoped["declining"], scoped["flat"]) == (1, 1, 0)
    assert scoped["sectors"] == [tech]
    assert scoped["session_date"] == body["session_date"]
    assert scoped["previous_session_date"] == body["previous_session_date"]


def test_breadth_distinguishes_no_observations_from_flat(market):
    db, client = market
    db.add(listing("AAPL"))
    db.commit()
    response = client.get("/night/breadth?sector=Technology")
    assert response.status_code == 200
    body = response.json()
    assert body["coverage"] == "missing" and body["session_date"] is None
    assert (body["universe_count"], body["covered_count"], body["excluded_count"]) == (1, 0, 1)
    assert (body["advancing"], body["declining"], body["flat"]) == (0, 0, 0)
    assert body["items"] == []
    assert body["sectors"] == [{
        "sector": "Technology", "covered": 0, "median_move": None,
        "proxy": None, "proxy_symbol": "XLK", "proxy_coverage": "missing",
    }]

    unknown = client.get("/night/breadth?sector=unknown")
    assert unknown.status_code == 422
    assert "sector" in unknown.json()["detail"]["fields"]
