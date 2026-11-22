from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
import requests

from app.core.config import settings
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.models.watchlist import Watchlist, WatchlistItem
from app.services import scheduled_jobs, yahoo_history
from app.services.market_quality import Bar

_TODAY = date(2026, 11, 18)
_END = date(2026, 11, 17)
_PRIOR = date(2026, 11, 16)
_FETCHED = datetime(2026, 11, 18, 15, tzinfo=timezone.utc)


def _bar(symbol, day, close):
    price = Decimal(close)
    return Bar(symbol, day, price, price, price, price, 500, "yahoo", _FETCHED)


def test_full_window_top_up_restates_splits_and_resumes(db_session, monkeypatch):
    calls = []

    def fetch(_http, symbol, start, end):
        calls.append((symbol, start, end))
        if end == _PRIOR:
            return [_bar(symbol, _PRIOR, "200")]
        return [_bar(symbol, _PRIOR, "100"), _bar(symbol, _END, "101")]

    monkeypatch.setattr(yahoo_history, "fetch_bars", fetch)
    first = yahoo_history.refresh_yahoo_history(db_session, symbols=["BRK.B"], today=_END)
    assert first["rows_changed"] == 1
    second = yahoo_history.refresh_yahoo_history(db_session, symbols=["BRK.B"], today=_TODAY, refresh_quotes=True)
    assert second["rows_changed"] == 2
    bars = db_session.query(MarketBarDaily).order_by(MarketBarDaily.session_date).all()
    assert [(b.provider, b.adjustment_type, b.close) for b in bars] == [
        ("yahoo", "split_adjusted", Decimal("100")), ("yahoo", "split_adjusted", Decimal("101")),
    ]
    assert db_session.get(MarketQuoteCache, "BRK.B").price == 101
    assert calls == [("BRK.B", date(2024, 11, 17), _PRIOR), ("BRK.B", date(2024, 11, 18), _END)]

    resumed = yahoo_history.refresh_yahoo_history(db_session, symbols=["BRK.B"], today=_TODAY)
    assert resumed["up_to_date"] == 1 and resumed["rows_changed"] == 0
    assert len(calls) == 2
    forced = yahoo_history.refresh_yahoo_history(db_session, symbols=["BRK.B"], today=_TODAY, force=True)
    assert forced["rows_changed"] == 0


def test_universe_includes_held_watched_and_market_proxies(db_session):
    user = User(email="history-reader@example.com", password_hash="unused")
    asset = Asset(symbol="HELD", name="Held stock", asset_type="stock")
    db_session.add_all([user, asset, MarketSymbol(symbol="WATCH", company_name="Watched stock", exchange="US")])
    db_session.flush()
    watchlist = Watchlist(user_id=user.id, name="Research")
    db_session.add_all([watchlist, Holding(user_id=user.id, asset_id=asset.id, quantity=1)])
    db_session.flush()
    db_session.add(WatchlistItem(watchlist_id=watchlist.id, symbol="WATCH", position=1))
    db_session.commit()
    symbols = yahoo_history._load_universe(db_session, None)
    assert {"HELD", "WATCH", "AAPL", "BRK.B", "SPY", "XLK"} <= symbols.keys()
    assert len(symbols) > 500


def test_rate_limit_stops_unfinished_symbols_and_keeps_commits(db_session, monkeypatch):
    calls = []

    def fetch(_http, symbol, _start, _end):
        calls.append(symbol)
        if symbol == "DIA":
            raise yahoo_history.YahooRateLimited("Rerun later.")
        return [_bar(symbol, _END, "100")]

    monkeypatch.setattr(yahoo_history, "fetch_bars", fetch)
    result = yahoo_history.refresh_yahoo_history(db_session, symbols=["AAPL", "DIA", "SPY"], today=_TODAY)
    assert calls == ["AAPL", "DIA"]
    assert result["processed"] == 1 and result["rate_limited"]
    assert db_session.query(MarketBarDaily).one().symbol == "AAPL"


@pytest.mark.parametrize("retry_after, attempts, sleeps", [("2", 3, [1, 2, 2]), ("60", 1, [1])])
def test_retries_and_honors_rate_limit_wait(monkeypatch, retry_after, attempts, sleeps):
    calls = []
    waited = []

    class HTTP:
        def get(self, url, **_kwargs):
            calls.append(url)
            response = requests.Response()
            response.status_code = 429
            response.headers["Retry-After"] = retry_after
            return response

    monkeypatch.setattr(yahoo_history.time, "sleep", waited.append)
    with pytest.raises(yahoo_history.YahooRateLimited):
        yahoo_history._chart(HTTP(), "BRK.B", _PRIOR, _END)
    assert len(calls) == attempts and calls[0].endswith("/BRK-B")
    assert waited == sleeps


def test_chart_parser_checks_provider_identity_and_completed_sessions(monkeypatch):
    dates = [datetime(2026, 11, day, 14, 30, tzinfo=timezone.utc) for day in (14, 16, 17, 18)]
    result = {
        "meta": {"dataGranularity": "1d", "symbol": "BRK-B", "exchangeTimezoneName": "America/New_York"},
        "timestamp": [int(day.timestamp()) for day in dates],
        "indicators": {
            "quote": [{"open": [123] * 4, "high": [126] * 4, "low": [122] * 4,
                       "close": [125, 125, None, 125], "volume": [500] * 4}],
            "adjclose": [{"adjclose": [60] * 4}],
        },
    }
    monkeypatch.setattr(yahoo_history, "_chart", lambda *_: {"chart": {"result": [result]}})
    bars = yahoo_history.fetch_bars(None, "BRK.B", dates[0].date(), _END)
    assert [(b.symbol, b.day, b.close) for b in bars] == [("BRK.B", _PRIOR, Decimal(125))]
    result["meta"]["symbol"] = "WRONG"
    with pytest.raises(ValueError, match="unexpected symbol"):
        yahoo_history.fetch_bars(None, "BRK.B", _PRIOR, _END)


def test_scheduler_only_loads_yahoo_history_without_massive_key(monkeypatch):
    calls = []
    monkeypatch.setattr(settings, "market_quote_source", "massive")
    monkeypatch.setattr(settings, "scheduled_market_daily_limit", 1)
    monkeypatch.setattr(settings, "scheduled_market_hot_limit", 1)
    monkeypatch.setattr(scheduled_jobs, "refresh_quote_cache", lambda *_a, **_kw: {
        "requested": 0, "refreshed": 0, "errors": [],
    })

    def history(_db, *, refresh_quotes):
        calls.append(refresh_quotes)
        return {"errors": [], "rate_limited": False}

    monkeypatch.setattr(scheduled_jobs, "refresh_yahoo_history", history)
    monkeypatch.setattr(settings, "massive_api_key", "test-key")
    assert "history" not in scheduled_jobs.refresh_market_caches(object())
    monkeypatch.setattr(settings, "massive_api_key", "   ")
    assert scheduled_jobs.refresh_market_caches(object())["history"]["error_count"] == 0
    assert calls == [True]
