"""Stage 2: browse stays the featured universe; explicit search and holdings do not.

Direct symbol routes stay open to any seeded MarketSymbol.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.models.user import User

MEMBER = "MMM"
OUTSIDER = "ZZZFAKE"
BENCHMARK = "QQQ"
OUTSIDE_LABEL = "Outside S&P 500"


def _active_symbol(db, symbol: str) -> None:
    db.add(MarketSymbol(
        symbol=symbol,
        company_name=symbol,
        exchange="NYSE",
        sector=None,
        is_etf=False,
        is_test=False,
        is_active=True,
        refresh_tier="daily",
    ))


def test_universe_browse_keeps_featured_set_and_omits_non_member(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, BENCHMARK)
    _active_symbol(db_session, OUTSIDER)
    db_session.commit()

    response = client.get("/market/universe")
    assert response.status_code == 200, response.text
    items = {item["symbol"]: item for item in response.json()["items"]}
    assert MEMBER in items
    assert items[MEMBER]["in_featured_universe"] is True
    assert items[MEMBER]["universe_label"] is None
    assert BENCHMARK in items
    assert items[BENCHMARK]["in_featured_universe"] is True
    assert items[BENCHMARK]["universe_label"] is None
    assert OUTSIDER not in items


def test_universe_search_labels_member(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, OUTSIDER)
    db_session.commit()

    response = client.get("/market/universe", params={"search": MEMBER})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["symbol"] == MEMBER
    assert item["in_featured_universe"] is True
    assert item["universe_label"] is None


def test_universe_search_member_matches_lowercase_ticker_and_company_name(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, OUTSIDER)
    db_session.flush()
    db_session.query(MarketSymbol).filter(MarketSymbol.symbol == MEMBER).one().company_name = "3M Company"
    db_session.commit()

    by_ticker = client.get("/market/universe", params={"search": "mmm"})
    assert by_ticker.status_code == 200, by_ticker.text
    assert [item["symbol"] for item in by_ticker.json()["items"]] == [MEMBER]

    by_name = client.get("/market/universe", params={"search": "3m company"})
    assert by_name.status_code == 200, by_name.text
    assert [item["symbol"] for item in by_name.json()["items"]] == [MEMBER]


def test_universe_search_labels_explicit_non_member(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, OUTSIDER)
    db_session.commit()

    response = client.get("/market/universe", params={"search": OUTSIDER.lower()})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 1
    item = body["items"][0]
    assert item["symbol"] == OUTSIDER
    assert item["in_featured_universe"] is False
    assert item["universe_label"] == OUTSIDE_LABEL

    partial = client.get("/market/universe", params={"search": "ZZZ"})
    assert partial.status_code == 200, partial.text
    assert partial.json()["total"] == 0
    assert partial.json()["items"] == []


def test_universe_browse_shows_held_non_member(client, db_session, auth_headers):
    _active_symbol(db_session, OUTSIDER)
    headers = auth_headers("holder-outsider@example.com", "password123")
    user = db_session.query(User).filter(User.email == "holder-outsider@example.com").one()
    asset = Asset(symbol=OUTSIDER, asset_type="stock", name="Outsider Co")
    db_session.add(asset)
    db_session.flush()
    db_session.add(Holding(
        user_id=user.id,
        asset_id=asset.id,
        quantity=Decimal("1"),
        avg_cost=Decimal("5"),
    ))
    db_session.commit()

    held = client.get("/market/universe", headers=headers)
    assert held.status_code == 200, held.text
    items = {item["symbol"]: item for item in held.json()["items"]}
    assert OUTSIDER in items
    assert items[OUTSIDER]["in_featured_universe"] is False
    assert items[OUTSIDER]["universe_label"] == OUTSIDE_LABEL

    anonymous = client.get("/market/universe")
    assert anonymous.status_code == 200, anonymous.text
    assert OUTSIDER not in {item["symbol"] for item in anonymous.json()["items"]}


def test_held_symbol_is_not_repeated_across_pages(client, db_session, auth_headers):
    for symbol in ("AAPL", "MSFT", "ZTS"):
        _active_symbol(db_session, symbol)
    headers = auth_headers("holder-zts@example.com", "password123")
    user = db_session.query(User).filter(User.email == "holder-zts@example.com").one()
    asset = Asset(symbol="ZTS", asset_type="stock", name="Zoetis")
    db_session.add(asset)
    db_session.flush()
    db_session.add(Holding(
        user_id=user.id,
        asset_id=asset.id,
        quantity=Decimal("1"),
        avg_cost=Decimal("5"),
    ))
    db_session.commit()

    first = client.get("/market/universe", headers=headers, params={"limit": 2, "offset": 0})
    second = client.get("/market/universe", headers=headers, params={"limit": 2, "offset": 2})
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    first_symbols = [item["symbol"] for item in first.json()["items"]]
    second_symbols = [item["symbol"] for item in second.json()["items"]]
    assert len(first_symbols) <= 2
    assert len(second_symbols) <= 2
    assert first_symbols == ["ZTS", "AAPL"]
    assert second_symbols == ["MSFT"]
    assert not (set(first_symbols) & set(second_symbols))


def test_non_member_history_remains_readable(client, db_session):
    _active_symbol(db_session, OUTSIDER)
    db_session.flush()
    session_date = (datetime.now(timezone.utc) - timedelta(days=3)).date()
    close_price = Decimal("42.500000")
    fetched_at = datetime.now(timezone.utc) - timedelta(hours=1)
    db_session.add(MarketBarDaily(
        symbol=OUTSIDER,
        session_date=session_date,
        provider="yahoo",
        adjustment_type="raw",
        open=close_price,
        high=close_price,
        low=close_price,
        close=close_price,
        volume=100,
        fetched_at=fetched_at,
        quality_status="valid",
    ))
    db_session.commit()

    response = client.get(
        f"/market/symbols/{OUTSIDER}/history",
        params={
            "interval": "1d",
            "range": "2y",
            "provider": "yahoo",
            "adjustment_type": "raw",
        },
    )
    assert response.status_code == 200, response.text
    bars = response.json()["bars"]
    assert len(bars) == 1
    assert bars[0]["session_date"] == session_date.isoformat()
    assert bars[0]["close"] == "42.500000"
