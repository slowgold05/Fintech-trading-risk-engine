"""Cached SMA/EMA over one history snapshot. No provider, no writes, no extra SQL."""

from datetime import date, datetime, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Context, Decimal, getcontext, localcontext
from fractions import Fraction
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select

from app.models.ledger_entry import LedgerEntry
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_quote_cache import MarketQuoteCache
from app.models.order import Order
from app.models.price_history_daily import PriceHistoryDaily
from app.services.market_indicators import read_symbol_indicators
from tests.test_market_history import _aware, _bar, _history_params, _pin_clock, _symbol

_CLOCK = datetime(2026, 6, 15, 16, 0, 1, 250000)
_DATES = (
    date(2026, 1, 10),
    date(2026, 1, 12),
    date(2026, 1, 15),
    date(2026, 1, 20),
    date(2026, 1, 28),
    date(2026, 2, 3),
)
_CLOSES = (1, 4, 2, 8, 3, 9)
_SMA = (None, None, "2.333333", "4.666667", "4.333333", "6.666667")
_EMA = (None, None, "2.333333", "5.166667", "4.083333", "6.541667")
_NAME_DETAIL = "name must be sma or ema."
_PERIOD_DETAIL = "period must be an integer from 2 through 200."
_OHLC_DETAIL = "Accepted bar prices are not usable."
_META = (
    "symbol", "interval", "range", "provider", "adjustment_type", "coverage_status",
    "expected_session_count", "collection", "read_at", "requested_start", "requested_end",
    "available_start", "available_end", "excluded_row_count",
)


@pytest.fixture(autouse=True)
def forbid_providers(monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.price_service.get_live_price", boom)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", boom)
    monkeypatch.setattr("app.services.eod_service.fetch_eod_batch", boom)
    monkeypatch.setattr("app.services.market_cache_service.refresh_quote_cache", boom)
    monkeypatch.setattr("requests.get", boom)


def _params(**changes):
    params = _history_params(name="sma", period="3")
    params.update(changes)
    return params


def _seed(db, symbol, rows, *, create=True, **bar_kwargs):
    if create:
        _symbol(db, symbol)
    fetched = _aware(_CLOCK - timedelta(hours=1))
    for session_date, close in rows:
        _bar(
            db, symbol, session_date, fetched_at=fetched,
            open_price=Decimal(close), high_price=Decimal(close),
            low_price=Decimal(close), close_price=Decimal(close), **bar_kwargs,
        )
    db.commit()


def _quantize(value: Fraction) -> str:
    with localcontext(Context(prec=50)):
        number = Decimal(value.numerator) / Decimal(value.denominator)
        return format(number.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP), "f")


def _fraction_series(kind: str) -> tuple:
    closes = [Fraction(value) for value in _CLOSES]
    period = 3
    alpha = Fraction(2, period + 1)
    texts = []
    carry = None
    for index, close in enumerate(closes):
        if index < period - 1:
            texts.append(None)
            continue
        if kind == "sma":
            window = closes[index - period + 1:index + 1]
            texts.append(_quantize(sum(window, Fraction(0)) / period))
            continue
        if index == period - 1:
            carry = sum(closes[:period], Fraction(0)) / period
        else:
            carry = alpha * close + (Fraction(1) - alpha) * carry
        texts.append(_quantize(carry))
    return tuple(texts)


def _early_quantized_fourth_ema() -> str:
    """Second post-seed term if each carry is rounded before the next bar."""
    quantum = Decimal("0.000001")
    with localcontext(Context(prec=50)):
        carry = (Decimal(1) + Decimal(4) + Decimal(2)) / Decimal(3)
        carry = carry.quantize(quantum, rounding=ROUND_HALF_UP)
        carry = (Decimal(1) / Decimal(2)) * Decimal(8) + (Decimal(1) / Decimal(2)) * carry
        carry = carry.quantize(quantum, rounding=ROUND_HALF_UP)
        carry = (Decimal(1) / Decimal(2)) * Decimal(3) + (Decimal(1) / Decimal(2)) * carry
        return format(carry.quantize(quantum, rounding=ROUND_HALF_UP), "f")


def _call(db, symbol="NVDA", **changes):
    args = dict(
        symbol=symbol, interval="1d", range_token="2y", provider="fixture",
        adjustment_type="raw", name="sma", period=3,
    )
    args.update(changes)
    return read_symbol_indicators(db, **args)


def test_nonlinear_reference_gaps_unrounded_carry_and_process_context(db_session, monkeypatch):
    assert _fraction_series("sma") == _SMA
    assert _fraction_series("ema") == _EMA
    assert _early_quantized_fourth_ema() == "4.083334"
    assert _early_quantized_fourth_ema() != _EMA[4]
    _pin_clock(monkeypatch, _CLOCK)
    _seed(db_session, "NVDA", zip(_DATES, _CLOSES))
    previous = getcontext().copy()
    getcontext().prec = 12
    getcontext().rounding = ROUND_DOWN
    try:
        sma = _call(db_session, name="sma", period=3)
        ema = _call(db_session, name="ema", period="3")
        assert getcontext().prec == 12
        assert getcontext().rounding == ROUND_DOWN
    finally:
        getcontext().prec = previous.prec
        getcontext().rounding = previous.rounding
    dates = [point["session_date"] for point in sma["points"]]
    assert dates == [day.isoformat() for day in _DATES]
    assert "2026-01-11" not in dates and "2026-01-13" not in dates
    assert [point["value"] for point in sma["points"]] == list(_SMA)
    assert [point["value"] for point in ema["points"]] == list(_EMA)
    assert sma["points"][3]["value"] != ema["points"][3]["value"]
    assert sma["status"] == ema["status"] == "partial"
    assert sma["status"] != "complete"
    assert sma["period"] == 3 and sma["observed_valid_closes"] == 6
    assert sma["source"] == "observed_valid_closes"
    assert sma["session_basis"] == "not_exchange_sessions"
    assert sma["read_at"] == "2026-06-15T16:00:01.250000Z"
    assert "bars" not in sma and "0.000000" not in json.dumps(sma["points"])


def test_exact_half_quantizes_half_up(db_session, monkeypatch):
    _pin_clock(monkeypatch, _CLOCK)
    _seed(db_session, "HALF", [(_DATES[0], Decimal("1.000000")), (_DATES[1], Decimal("1.000001"))])
    for name in ("sma", "ema"):
        body = _call(db_session, symbol="HALF", name=name, period=2)
        assert [point["value"] for point in body["points"]] == [None, "1.000001"]


@pytest.mark.parametrize(
    ("name", "period", "detail"),
    [
        ("SMA", 3, _NAME_DETAIL),
        ([], 3, _NAME_DETAIL),
        ({}, 3, _NAME_DETAIL),
        (None, 3, _NAME_DETAIL),
        (1, "3", _NAME_DETAIL),
        ("sma", True, _PERIOD_DETAIL),
        ("sma", False, _PERIOD_DETAIL),
        ("sma", 2.0, _PERIOD_DETAIL),
        ("sma", "2.0", _PERIOD_DETAIL),
        ("sma", "2e1", _PERIOD_DETAIL),
        ("sma", " 2", _PERIOD_DETAIL),
        ("sma", "02", _PERIOD_DETAIL),
        ("sma", 1, _PERIOD_DETAIL),
        ("sma", 201, _PERIOD_DETAIL),
        ("ema", "201", _PERIOD_DETAIL),
    ],
)
def test_service_rejects_name_and_noninteger_period(name, period, detail):
    with pytest.raises(HTTPException) as caught:
        _call(object(), name=name, period=period)
    assert caught.value.status_code == 422
    assert caught.value.detail == detail


def test_route_text_bounds_missing_keys_and_history_detail(client, db_session, monkeypatch):
    _pin_clock(monkeypatch, _CLOCK)
    _seed(db_session, "NVDA", [(_DATES[0], 5)])
    accepted = client.get("/market/symbols/NVDA/indicators", params=_params(period="200"))
    assert accepted.status_code == 200
    assert accepted.json()["period"] == 200
    assert accepted.json()["status"] == "insufficient"
    assert accepted.json()["points"] == [{"session_date": "2026-01-10", "value": None}]
    short = client.get("/market/symbols/NVDA/indicators", params=_params(period="2", name="ema"))
    assert short.status_code == 200 and short.json()["period"] == 2
    for period, name in (("2.0", "sma"), ("2e1", "sma"), (" 2", "sma"), ("02", "sma"), ("true", "sma"), ("3", "EMA")):
        response = client.get(
            "/market/symbols/NVDA/indicators", params=_params(period=period, name=name),
        )
        assert response.status_code == 422, (period, name)
        detail = _PERIOD_DETAIL if name == "sma" else _NAME_DETAIL
        assert response.json()["detail"] == detail
    required = ("interval", "range", "provider", "adjustment_type", "name", "period")
    for key in required:
        params = _params()
        params.pop(key)
        missing = client.get("/market/symbols/NVDA/indicators", params=params)
        assert missing.status_code == 422
        assert isinstance(missing.json()["detail"], list)
        blob = json.dumps(missing.json())
        assert _PERIOD_DETAIL not in blob and _NAME_DETAIL not in blob
        assert "must be 1d." not in blob
    illegal = client.get(
        "/market/symbols/NVDA/indicators", params=_params(interval="1h"),
    )
    assert illegal.status_code == 422
    assert illegal.json()["detail"] == "interval must be 1d."
    with pytest.raises(HTTPException) as caught:
        _call(db_session, range_token="5y")
    assert caught.value.status_code == 422
    assert caught.value.detail == "range must be 2y."


def test_warmup_empty_unknown_and_excluded_do_not_leak(client, db_session, monkeypatch):
    _pin_clock(monkeypatch, _CLOCK)
    fetched = _aware(_CLOCK - timedelta(hours=2))
    future = _aware(_CLOCK + timedelta(hours=1))
    _seed(db_session, "WARM", [(_DATES[0], 1), (_DATES[1], 4)])
    _symbol(db_session, "BARE")
    _symbol(db_session, "EXCL")
    _bar(db_session, "EXCL", _DATES[2], fetched_at=fetched, close_price=Decimal(5))
    _bar(db_session, "EXCL", _DATES[3], quality="flagged", fetched_at=fetched, close_price=Decimal(8))
    _bar(db_session, "EXCL", _DATES[4], quality="rejected", fetched_at=fetched, close_price=Decimal(9))
    _bar(db_session, "EXCL", _DATES[5], fetched_at=future, close_price=Decimal(7))
    _bar(db_session, "EXCL", date(2026, 6, 20), fetched_at=fetched, close_price=Decimal(6))
    _symbol(db_session, "GONE")
    _bar(db_session, "GONE", _DATES[2], quality="flagged", fetched_at=fetched, close_price=Decimal(4))
    db_session.commit()

    warm = _call(db_session, symbol="WARM", period=3)
    assert warm["status"] == "insufficient"
    assert [point["value"] for point in warm["points"]] == [None, None]
    assert warm["observed_valid_closes"] == 2

    bare = client.get("/market/symbols/BARE/indicators", params=_params())
    assert bare.status_code == 200
    assert bare.json()["status"] == "unavailable"
    assert bare.json()["points"] == []
    assert bare.json()["observed_valid_closes"] == 0
    assert bare.json()["coverage_status"] == "not_verified"

    unknown = client.get("/market/symbols/NO_SUCH/indicators", params=_params())
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Unknown symbol."

    history = client.get("/market/symbols/EXCL/history", params=_history_params()).json()
    body = client.get("/market/symbols/EXCL/indicators", params=_params(period="2")).json()
    assert [point["session_date"] for point in body["points"]] == ["2026-01-15"]
    assert body["points"][0]["value"] is None
    assert body["excluded_row_count"] == history["excluded_row_count"] == 3
    assert body["read_at"] == history["read_at"]
    for key in _META:
        assert body[key] == history[key]
    serialized = json.dumps(body)
    for leaked in ("2026-01-20", "2026-01-28", "2026-02-03", "2026-06-20", "8.000000", "9.000000", "7.000000"):
        assert leaked not in serialized
    gone = client.get("/market/symbols/GONE/indicators", params=_params()).json()
    assert gone["status"] == "unavailable" and gone["points"] == []
    assert gone["excluded_row_count"] == 1 and gone["observed_valid_closes"] == 0


def test_provider_and_adjustment_stay_separate_and_read_only(client, db_session, monkeypatch):
    _pin_clock(monkeypatch, _CLOCK)
    rows = [(_DATES[0], 10), (_DATES[2], 12)]
    _seed(db_session, "NVDA", rows)
    _seed(db_session, "NVDA", [(_DATES[0], 40), (_DATES[2], 44)], create=False, adjustment="split_adjusted")
    _seed(db_session, "NVDA", [(_DATES[0], 70), (_DATES[2], 72)], create=False, provider="other")

    def counts():
        models = (MarketBarDaily, MarketQuoteCache, PriceHistoryDaily, LedgerEntry, Order)
        return tuple(db_session.scalar(select(func.count()).select_from(model)) for model in models)

    before = counts()
    verbs = []

    def capture(_conn, _cursor, statement, _parameters, _context, _executemany):
        if statement:
            verbs.append(statement.lstrip().split(None, 1)[0].lower())

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", capture)
    try:
        raw = client.get("/market/symbols/NVDA/indicators", params=_params(period="2")).json()
        adjusted = client.get(
            "/market/symbols/NVDA/indicators",
            params=_params(period="2", adjustment_type="split_adjusted"),
        ).json()
        other = client.get(
            "/market/symbols/NVDA/indicators",
            params=_params(period="2", provider="other"),
        ).json()
    finally:
        event.remove(engine, "before_cursor_execute", capture)

    assert [point["value"] for point in raw["points"]] == [None, "11.000000"]
    assert [point["value"] for point in adjusted["points"]] == [None, "42.000000"]
    assert [point["value"] for point in other["points"]] == [None, "71.000000"]
    assert raw["provider"] == "fixture" and adjusted["adjustment_type"] == "split_adjusted"
    assert other["provider"] == "other" and raw["excluded_row_count"] == 0
    assert counts() == before
    assert verbs
    assert not {"insert", "update", "delete"} & set(verbs)


def test_one_history_read_and_stub_session_issues_no_sql(monkeypatch):
    calls = []

    def fake_history(db, **kwargs):
        calls.append((db, kwargs))
        bars = []
        for day, close in zip(_DATES, _CLOSES):
            text = format(Decimal(close).quantize(Decimal("0.000001")), "f")
            bars.append({
                "session_date": day.isoformat(), "open": text, "high": text,
                "low": text, "close": text, "volume": "1",
            })
        return {
            "symbol": "NVDA", "interval": "1d", "range": "2y", "provider": "fixture",
            "adjustment_type": "raw", "coverage_status": "not_verified",
            "expected_session_count": None, "collection": "disabled",
            "read_at": "2026-06-15T16:00:01.250000Z",
            "requested_start": "2024-06-15", "requested_end": "2026-06-15",
            "available_start": bars[0]["session_date"], "available_end": bars[-1]["session_date"],
            "excluded_row_count": 4, "bars": bars,
        }

    class _FailSQL:
        def execute(self, *_args, **_kwargs):
            raise AssertionError("extra sql")

        def scalar(self, *_args, **_kwargs):
            raise AssertionError("extra sql")

        def get_bind(self):
            raise AssertionError("extra sql")

    monkeypatch.setattr("app.services.market_indicators.read_symbol_history", fake_history)
    body = read_symbol_indicators(
        _FailSQL(), symbol="NVDA", interval="1d", range_token="2y", provider="fixture",
        adjustment_type="raw", name="ema", period=3,
    )
    assert len(calls) == 1
    assert isinstance(calls[0][0], _FailSQL)
    assert calls[0][1]["symbol"] == "NVDA" and calls[0][1]["range_token"] == "2y"
    assert [point["value"] for point in body["points"]] == list(_EMA)
    assert body["excluded_row_count"] == 4 and body["read_at"] == "2026-06-15T16:00:01.250000Z"
    assert "bars" not in body
    read_symbol_indicators(
        _FailSQL(), symbol="NVDA", interval="1d", range_token="2y", provider="fixture",
        adjustment_type="raw", name="sma", period=3,
    )
    assert len(calls) == 2


@pytest.mark.parametrize(
    "corrupt",
    [
        {"close": "NaN"},
        {"close": "Infinity"},
        {"close": "0.000000"},
        {"close": "-1.000000"},
        {"open": "3.000000", "high": "3.000000", "low": "2.500000", "close": "2.000000"},
    ],
)
def test_corrupt_accepted_ohlc_fails_entire_response(client, db_session, monkeypatch, corrupt):
    _pin_clock(monkeypatch, _CLOCK)
    _seed(db_session, "NVDA", [(_DATES[0], 5)])
    history = client.get("/market/symbols/NVDA/history", params=_history_params())
    assert history.status_code == 200
    assert history.json()["bars"][0]["close"] == "5.000000"

    def fake_history(*_args, **_kwargs):
        bar = {
            "session_date": "2026-01-10", "open": "1.000000", "high": "1.000000",
            "low": "1.000000", "close": "1.000000", "volume": "3",
        }
        bar.update(corrupt)
        return {
            "symbol": "NVDA", "interval": "1d", "range": "2y", "provider": "fixture",
            "adjustment_type": "raw", "coverage_status": "not_verified",
            "expected_session_count": None, "collection": "disabled",
            "read_at": "2026-06-15T16:00:01.250000Z",
            "requested_start": "2024-06-15", "requested_end": "2026-06-15",
            "available_start": "2026-01-10", "available_end": "2026-01-10",
            "excluded_row_count": 0, "bars": [bar],
        }

    monkeypatch.setattr("app.services.market_indicators.read_symbol_history", fake_history)
    with pytest.raises(HTTPException) as caught:
        _call(db_session, period=2)
    assert caught.value.status_code == 500
    assert caught.value.detail == _OHLC_DETAIL
    routed = client.get("/market/symbols/NVDA/indicators", params=_params(period="2"))
    assert routed.status_code == 500
    assert routed.json()["detail"] == _OHLC_DETAIL
    assert "points" not in routed.json()
    assert "0.000000" not in routed.text
    untouched = client.get("/market/symbols/NVDA/history", params=_history_params())
    assert untouched.status_code == 200
    assert untouched.json()["bars"][0]["close"] == "5.000000"
