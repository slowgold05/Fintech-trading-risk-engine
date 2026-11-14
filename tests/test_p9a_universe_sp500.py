"""Stage 2: universe browse/search is limited to S&P 500 members.

Direct symbol routes stay open to any seeded MarketSymbol.
"""

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol

MEMBER = "MMM"
OUTSIDER = "ZZZFAKE"


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


def test_universe_lists_sp500_member_and_omits_non_member(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, OUTSIDER)
    db_session.commit()

    response = client.get("/market/universe")
    assert response.status_code == 200, response.text
    symbols = {item["symbol"] for item in response.json()["items"]}
    assert MEMBER in symbols
    assert OUTSIDER not in symbols


def test_universe_search_for_non_member_returns_zero_items(client, db_session):
    _active_symbol(db_session, MEMBER)
    _active_symbol(db_session, OUTSIDER)
    db_session.commit()

    response = client.get("/market/universe", params={"search": OUTSIDER})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 0
    assert body["items"] == []


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
