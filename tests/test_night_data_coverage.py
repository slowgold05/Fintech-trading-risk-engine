from datetime import date, datetime
from decimal import Decimal

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import OperationalError

from app.core import read_snapshot
from app.core.database import get_db
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_filings_cache import MarketFilingsCache
from app.models.market_news_cache import MarketNewsCache
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.routers import night_data_coverage


# Monday evening in New York, after the UTC date has rolled over. July 3 is
# the observed Independence Day holiday, so July 2 is still the entitled close.
CLOCK = datetime(2026, 7, 7, 1, 30)
EXPECTED = date(2026, 7, 2)
PATH = "/night/data-coverage"


@pytest.fixture
def coverage_client(db_session, monkeypatch):
    local_app = FastAPI()
    local_app.include_router(night_data_coverage.router)
    local_app.dependency_overrides[get_db] = lambda: db_session
    monkeypatch.setattr(read_snapshot, "_python_utc_now", lambda: CLOCK)
    return TestClient(local_app)


def _listing(symbol, **flags):
    return MarketSymbol(symbol=symbol, company_name=symbol, exchange="Nasdaq", **flags)


def _quote(symbol, price=10, source="yahoo", session=EXPECTED, fetched=datetime(2026, 7, 3, 13)):
    stamp = datetime.combine(session, datetime.min.time()) if session else None
    return MarketQuoteCache(symbol=symbol, price=price, source=source, quote_at=stamp, fetched_at=fetched)


def _bar(symbol, day, provider="yahoo", basis="split_adjusted", quality="valid", fetched=CLOCK):
    return MarketBarDaily(
        symbol=symbol, session_date=day, provider=provider, adjustment_type=basis, quality_status=quality,
        open=10, high=12, low=9, close=11, volume=100, fetched_at=fetched,
    )


def test_empty_cache_and_failure_envelopes(coverage_client, db_session, monkeypatch):
    assert coverage_client.get(PATH).json() == {
        "read_at": "2026-07-07T01:30:00Z",
        "expected_session": "2026-07-02",
        "coverage": "missing",
        "universe": {"population": "active_non_test_non_etf", "eligible": 0},
        "quotes": {"present": 0, "missing": 0, "invalid": 0, "fresh_eod": 0, "stale": 0, "unconfirmed_or_other": 0},
        "history": [],
        "reference": {
            "news": {"cached_rows": 0, "latest_observed_at": None},
            "filings": {"cached_rows": 0, "latest_observed_at": None},
            "dividends_splits": {"mode": "verified_events_only"},
        },
        "symbol": None,
    }
    db_session.add(_listing("AA"))
    db_session.commit()
    known = coverage_client.get(PATH, params={"symbol": "aa"})
    assert known.status_code == 200
    assert known.json()["symbol"] == {
        "symbol": "AA", "quote": None, "history": [],
        "reason": "No stored execution reference quote. This listing is outside the supported company universe. No raw history.",
    }

    unknown = coverage_client.get(PATH, params={"symbol": "ZZUNKNOWN"})
    assert unknown.status_code == 404
    assert unknown.json() == {"detail": {"code": "not_found", "message": "Unknown symbol."}}
    for symbol in ("", " AAPL", "AAPL ", "BRK/B", "A" * 21):
        malformed = coverage_client.get(PATH, params={"symbol": symbol})
        assert malformed.status_code == 422
        assert malformed.json()["detail"]["code"] == "invalid_request"
        assert list(malformed.json()["detail"]["fields"]) == ["symbol"]

    def unavailable(*_args, **_kwargs):
        raise OperationalError("private statement", {"private": "parameter"}, RuntimeError("private database"))

    monkeypatch.setattr(db_session, "execute", unavailable)
    fault = coverage_client.get(PATH)
    assert fault.status_code == 503
    assert fault.json() == {
        "detail": {"code": "storage_unavailable", "message": "Market coverage is temporarily unavailable."},
    }


def test_census_quality_and_detail_window_share_one_population(coverage_client, db_session):
    db_session.add_all([
        _listing("AAPL"), _listing("MSFT"), _listing("NVDA"), _listing("TSLA"), _listing("AMZN"),
        _listing("GOOG"), _listing("META"), _listing("AVGO"), _listing("AA"),
        _listing("SPY", is_etf=True), _listing("TEST", is_test=True), _listing("INACTIVE", is_active=False),
    ])
    db_session.flush()
    db_session.add_all([
        _quote("AAPL", Decimal("351.910004")),
        _quote("MSFT", session=date(2026, 7, 1)),
        _quote("NVDA", session=date(2026, 7, 6), fetched=datetime(2026, 7, 6, 19)),
        _quote("TSLA", 0),
        _quote("AMZN", source="alpha_vantage"),
        _quote("GOOG", fetched=datetime(2026, 7, 7, 2)),
        _quote("AVGO", session=None),
        _quote("AA", source="massive", price=Decimal("0.000001")),
        _quote("SPY"), _quote("TEST"), _quote("INACTIVE"),
        _bar("AAPL", EXPECTED),
        _bar("AAPL", date(2026, 6, 30), quality="flagged"),
        _bar("AAPL", date(2026, 7, 1), quality="rejected"),
        _bar("AAPL", date(2026, 6, 16)),
        _bar("AAPL", date(2026, 6, 19)),  # stored holiday row, outside the expected-date comparison
        _bar("AAPL", date(2026, 6, 29), fetched=datetime(2026, 7, 7, 2)),
        _bar("MSFT", date(2026, 5, 1), "massive", "raw"),
        _bar("MSFT", EXPECTED, "massive", "split_adjusted", "flagged"),
        _bar("SPY", EXPECTED, "yahoo", "split_adjusted"),
        _bar("SPY", EXPECTED, "massive", "raw"),
        _bar("SPY", EXPECTED, "etf_only", "raw"),
        _bar("TEST", EXPECTED), _bar("INACTIVE", EXPECTED),
        MarketNewsCache(symbol="AAPL", payload=[{"url": "https://example.com/cache"}], fetched_at=CLOCK),
        MarketFilingsCache(symbol="MSFT", cik="0000000001", payload=[], fetched_at=datetime(2026, 7, 4, 10)),
    ])
    db_session.commit()

    base = coverage_client.get(PATH)
    assert base.status_code == 200
    report = base.json()
    assert report["expected_session"] == EXPECTED.isoformat()
    assert report["universe"] == {"population": "active_non_test_non_etf", "eligible": 9}
    assert report["coverage"] == "partial"
    assert report["quotes"] == {
        "present": 8, "missing": 1, "invalid": 2, "fresh_eod": 2, "stale": 1, "unconfirmed_or_other": 3,
    }
    assert report["history"] == [
        {"provider": "massive", "basis": "raw", "valid_symbols": 1, "valid_rows": 1, "flagged_rows": 0,
         "rejected_rows": 0, "latest_valid_session": "2026-05-01", "valid_symbols_on_expected_session": 0},
        {"provider": "massive", "basis": "split_adjusted", "valid_symbols": 0, "valid_rows": 0, "flagged_rows": 1,
         "rejected_rows": 0, "latest_valid_session": None, "valid_symbols_on_expected_session": 0},
        {"provider": "yahoo", "basis": "split_adjusted", "valid_symbols": 1, "valid_rows": 3, "flagged_rows": 1,
         "rejected_rows": 1, "latest_valid_session": "2026-07-02", "valid_symbols_on_expected_session": 1},
    ]
    assert report["reference"] == {
        "news": {"cached_rows": 1, "latest_observed_at": "2026-07-07T01:30:00Z"},
        "filings": {"cached_rows": 1, "latest_observed_at": "2026-07-04T10:00:00Z"},
        "dividends_splits": {"mode": "verified_events_only"},
    }
    assert "example.com" not in base.text

    aapl = coverage_client.get(PATH, params={"symbol": "aapl"}).json()["symbol"]
    assert aapl["symbol"] == "AAPL"
    assert aapl["reason"] == "No raw history."
    assert aapl["quote"] == {
        "price": "351.910004", "execution_reference": "eligible",
        "source": {"provider": "yahoo", "basis": "raw", "session_date": "2026-07-02",
                   "observed_at": "2026-07-03T13:00:00Z", "coverage": "available"},
    }
    adjusted, = aapl["history"]
    assert adjusted["start"] == "2026-06-04"
    assert adjusted["end"] == "2026-07-02"
    assert adjusted["expected_sessions"] == 20
    assert adjusted["observed_sessions"] == 2
    assert adjusted["flagged_or_rejected_sessions"] == 2
    missing = adjusted["missing_recent_sessions"]
    assert len(missing) == 18
    assert {"2026-06-29", "2026-06-30", "2026-07-01"} <= set(missing)
    assert not {"2026-06-19", "2026-06-20", "2026-07-02", "2026-07-03"} & set(missing)

    spy = coverage_client.get(PATH, params={"symbol": "SPY"}).json()
    assert spy["history"] == report["history"]
    assert spy["quotes"] == report["quotes"]
    assert spy["symbol"]["quote"]["execution_reference"] == "eligible"
    assert {(row["provider"], row["basis"]) for row in spy["symbol"]["history"]} == {
        ("yahoo", "split_adjusted"), ("massive", "raw"), ("etf_only", "raw"),
    }

    msft = coverage_client.get(PATH, params={"symbol": "MSFT"}).json()["symbol"]
    assert msft["quote"]["execution_reference"] == "stale"
    assert msft["quote"]["source"]["session_date"] == "2026-07-01"
    raw, flagged = msft["history"]
    assert raw["basis"] == "raw"
    assert raw["observed_sessions"] == 0
    assert len(raw["missing_recent_sessions"]) == 20
    assert flagged["flagged_or_rejected_sessions"] == 1
    assert flagged["observed_sessions"] == 0

    for symbol in ("AMZN", "AVGO", "NVDA"):
        quote = coverage_client.get(PATH, params={"symbol": symbol}).json()["symbol"]["quote"]
        assert quote["execution_reference"] == "unconfirmed"
        assert quote["source"]["session_date"] is None
    tsla = coverage_client.get(PATH, params={"symbol": "TSLA"}).json()["symbol"]
    assert tsla["quote"] is None
    assert "invalid" in tsla["reason"]
    aa = coverage_client.get(PATH, params={"symbol": "AA"}).json()["symbol"]["quote"]
    assert aa["price"] == "0.000001"
    assert aa["execution_reference"] == "unsupported"
    assert aa["source"]["session_date"] == "2026-07-02"
