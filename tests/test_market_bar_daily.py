from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol


@pytest.fixture
def history_db(db_session):
    db_session.add(MarketSymbol(symbol="HIST", company_name="Fixture", exchange="NASDAQ"))
    db_session.commit()
    return db_session


def _bar(**changes):
    values = dict(symbol="HIST", session_date=date(2026, 11, 4), provider="fixture",
                  adjustment_type="raw", open=Decimal("10"), high=Decimal("12"),
                  low=Decimal("9"), close=Decimal("11"), volume=100,
                  fetched_at=datetime(2026, 11, 5, 12, tzinfo=timezone.utc), quality_status="valid")
    return MarketBarDaily(**(values | changes))


def test_series_identity_and_explicit_provenance(history_db):
    for provider in ("fixture", "other"):
        for adjustment in ("raw", "split_adjusted"):
            history_db.add(_bar(provider=provider, adjustment_type=adjustment))
    history_db.commit()
    rows = history_db.query(MarketBarDaily).all()
    assert len(rows) == 4
    assert all(row.session_date == date(2026, 11, 4) for row in rows)
    assert all(row.fetched_at.replace(tzinfo=timezone.utc) == datetime(2026, 11, 5, 12, tzinfo=timezone.utc) for row in rows)
    assert all(row.quality_status == "valid" for row in rows)
    history_db.add(_bar())
    with pytest.raises(IntegrityError):
        history_db.commit()
    history_db.rollback()
    assert history_db.query(MarketBarDaily).count() == 4


@pytest.mark.parametrize("changes", [
    {"provider": ""}, {"provider": " "}, {"provider": " fixture"},
    {"adjustment_type": "total_return"}, {"quality_status": "unchecked"},
    {"open": 0}, {"close": -1}, {"high": Decimal("1000000000000")},
    {"open": 13}, {"close": 8}, {"low": 13}, {"volume": -1},
    {"fetched_at": None}, {"quality_status": None}, {"volume": None},
])
def test_invalid_bars_do_not_enter_canonical_history(history_db, changes):
    history_db.add(_bar(**changes))
    with pytest.raises(IntegrityError):
        history_db.commit()
    history_db.rollback()
    assert history_db.query(MarketBarDaily).count() == 0
