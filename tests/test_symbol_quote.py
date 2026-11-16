"""Public symbol quote. Reads MarketQuoteCache only; no provider and no writes."""

from datetime import datetime

import pytest
from fastapi import HTTPException

from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.services.symbol_quote import read_symbol_quote

QUOTE_KEYS = {
    "symbol",
    "name",
    "sector",
    "exchange",
    "is_etf",
    "price",
    "change_amount",
    "change_percent",
    "volume",
    "source",
    "as_of",
}


@pytest.fixture(autouse=True)
def forbid_providers(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.price_service.get_live_price", boom)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", boom)
    monkeypatch.setattr("app.services.price_service.get_company_overview", boom)
    monkeypatch.setattr("app.services.price_service.get_top_gainers_losers", boom)
    monkeypatch.setattr("app.services.eod_service.fetch_eod_batch", boom)
    monkeypatch.setattr("app.services.sec_service.get_sec_company_fundamentals", boom)
    monkeypatch.setattr("requests.get", boom)


def _symbol(db, symbol, *, name, etf=False, sector=None):
    db.add(MarketSymbol(
        symbol=symbol,
        company_name=name,
        exchange="NASDAQ",
        sector=sector,
        is_etf=etf,
        is_test=False,
        is_active=True,
    ))


def test_sp500_quote_comes_from_the_cache(client, db_session):
    _symbol(db_session, "AAPL", name="Apple Inc.")
    db_session.add(MarketQuoteCache(
        symbol="AAPL",
        price="190.500000",
        change_amount="1.250000",
        change_percent="0.6600",
        volume=1234567,
        source="massive",
        quote_at=datetime(2026, 11, 13, 21, 0, 0),
        fetched_at=datetime(2026, 11, 13, 21, 5, 0),
    ))
    db_session.commit()

    response = client.get("/market/symbols/aapl/quote")

    assert response.status_code == 200
    body = response.json()
    assert set(body) == QUOTE_KEYS
    assert body == {
        "symbol": "AAPL",
        "name": "Apple Inc.",
        "sector": "Technology",
        "exchange": "NASDAQ",
        "is_etf": False,
        "price": 190.5,
        "change_amount": 1.25,
        "change_percent": 0.66,
        "volume": 1234567,
        "source": "massive",
        "as_of": "2026-11-13T21:00:00Z",
    }


def test_known_symbol_without_a_cache_row_returns_null_quote_fields(client, db_session):
    _symbol(db_session, "AAPL", name="Apple Inc.")
    db_session.commit()

    response = client.get("/market/symbols/AAPL/quote")

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Apple Inc."
    assert body["price"] is None
    assert body["change_amount"] is None
    assert body["change_percent"] is None
    assert body["volume"] is None
    assert body["source"] is None
    assert body["as_of"] is None


@pytest.mark.parametrize("symbol", ["SPY", "QQQ", "DIA", "IWM"])
def test_index_etfs_are_readable(client, db_session, symbol):
    _symbol(db_session, symbol, name=f"{symbol} trust", etf=True, sector="Broad market")
    db_session.add(MarketQuoteCache(
        symbol=symbol,
        price="500",
        change_amount="-1.5",
        change_percent="-0.5000",
        volume=10,
        source="massive",
        quote_at=datetime(2026, 11, 13, 21, 0, 0),
        fetched_at=datetime(2026, 11, 13, 21, 0, 0),
    ))
    db_session.commit()

    response = client.get(f"/market/symbols/{symbol}/quote")

    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == symbol
    assert body["is_etf"] is True
    assert body["sector"] == "Broad market"
    assert body["price"] == 500
    assert body["change_amount"] == -1.5
    assert body["change_percent"] == -0.5


def test_symbol_in_the_file_but_missing_from_the_table_is_unknown(client, db_session):
    response = client.get("/market/symbols/MSFT/quote")

    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown symbol."
    assert db_session.get(MarketQuoteCache, "MSFT") is None


def test_sector_etf_outside_the_four_indexes_is_rejected(client, db_session):
    _symbol(db_session, "XLK", name="Technology Select Sector SPDR", etf=True)
    db_session.commit()

    response = client.get("/market/symbols/XLK/quote")

    assert response.status_code == 404
    assert response.json()["detail"] == "Symbol is outside the supported universe."


def test_unsupported_characters_are_rejected(client):
    response = client.get("/market/symbols/bad_symbol/quote")

    assert response.status_code == 422
    assert response.json()["detail"] == "symbol must use letters, digits, dots, or hyphens."


def test_padded_symbol_is_rejected(db_session):
    with pytest.raises(HTTPException) as raised:
        read_symbol_quote(db_session, " AAPL")

    assert raised.value.status_code == 422


def _cached(db, symbol):
    db.add(MarketQuoteCache(
        symbol=symbol,
        price="10.000000",
        change_amount="0.100000",
        change_percent="1.0000",
        volume=1000,
        source="massive",
        quote_at=datetime(2026, 11, 13, 21, 0, 0),
        fetched_at=datetime(2026, 11, 13, 21, 5, 0),
    ))


def _quote_is_readable(client, symbol):
    return client.get(f"/market/symbols/{symbol}/quote").status_code == 200


def test_heatmap_movers_and_research_flag_only_symbols_the_quote_endpoint_serves(
    client, db_session, monkeypatch,
):
    """AAPL is supported and stored. OUTX is stored but outside the supported set.
    MSFT is in the supported set but has no symbol row. Only AAPL has a detail page."""
    _symbol(db_session, "AAPL", name="Apple Inc.", sector="Technology")
    _symbol(db_session, "OUTX", name="Outside Fixture", sector="Technology")
    _cached(db_session, "AAPL")
    _cached(db_session, "OUTX")
    db_session.commit()
    expected = {"AAPL": True, "OUTX": False, "MSFT": False}
    assert {symbol: _quote_is_readable(client, symbol) for symbol in expected} == expected

    heatmap = client.get("/market/heatmap").json()["items"]
    assert {item["symbol"]: item["detail_available"] for item in heatmap} == {
        "AAPL": True,
        "OUTX": False,
    }

    monkeypatch.setattr("app.routers.market.get_top_gainers_losers", lambda: {
        "top_gainers": [{"ticker": "AAPL", "price": "10"}, {"ticker": "OUTX", "price": "10"}],
        "top_losers": [{"ticker": "MSFT", "price": "10"}],
        "most_actively_traded": [{"ticker": "OUTX", "price": "10"}, {"ticker": "AAPL", "price": "10"}],
    })
    trending = client.get("/market/trending").json()
    movers = trending["top_gainers"] + trending["top_losers"] + trending["most_active"]
    assert len(movers) == 5
    for mover in movers:
        assert mover["detail_available"] is expected[mover["symbol"]]

    monkeypatch.setattr("app.core.config.settings.massive_api_key", "")
    monkeypatch.setattr("app.routers.market.get_company_overview", lambda _symbol: {"Name": "Fixture"})
    monkeypatch.setattr("app.routers.market.get_sec_company_fundamentals", lambda *_args: {})
    monkeypatch.setattr("app.routers.market.get_stock_quote", lambda _symbol: {"price": 10, "change_percent": 0})
    for symbol, readable in expected.items():
        body = client.get(f"/market/research/{symbol}").json()
        assert body["symbol"] == symbol
        assert body["detail_available"] is readable


def test_movers_stay_unlinked_when_the_provider_fails(client, monkeypatch):
    def unavailable():
        raise ValueError("Fixture has no movers")

    monkeypatch.setattr("app.routers.market.get_top_gainers_losers", unavailable)

    body = client.get("/market/trending").json()

    assert body["top_gainers"] == [] and body["top_losers"] == [] and body["most_active"] == []
    assert body["errors"] == [{"detail": "Fixture has no movers"}]
