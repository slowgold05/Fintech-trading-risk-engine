"""Kronos forecast wrapper. Torch and the real model are never loaded here."""

from datetime import date, datetime, timedelta

import pytest

from app.core.config import settings
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.forecast_kronos import _next_trading_sessions, generate_forecast


def _forbid_history(*args, **kwargs):
    raise AssertionError("read_symbol_history must not be called")


def _forecast(**overrides):
    payload = {
        "symbol": "AAPL",
        "provider": "yahoo",
        "adjustment_type": "raw",
        "lookback": 1,
        "horizon": 1,
        "sample_count": 1,
    }
    payload.update(overrides)
    return generate_forecast(None, **payload)


def _trading_days_ending(last: date, count: int) -> list[date]:
    found: list[date] = []
    day = last
    while len(found) < count:
        if is_nyse_trading_day(day):
            found.append(day)
        day -= timedelta(days=1)
    found.reverse()
    return found


def _bars(sessions: list[date]) -> list[dict]:
    bars = []
    for index, session in enumerate(sessions):
        bars.append({
            "session_date": session.isoformat(),
            "open": f"{100 + index}.25",
            "high": f"{101 + index}.25",
            "low": f"{99 + index}.25",
            "close": f"{100 + index}.50",
            "volume": str(1000 + index),
        })
    return bars


def _as_dates(series) -> list[date]:
    values = []
    for item in list(series):
        if isinstance(item, datetime):
            values.append(item.date())
        else:
            values.append(item)
    return values


def test_module_imports_without_torch_installed():
    import app.services.forecast_kronos as module

    assert hasattr(module, "generate_forecast")


def test_missing_dependencies_raises_a_clear_runtime_error():
    import app.services.forecast_kronos as module

    module._predictor_cache.clear()
    with pytest.raises(RuntimeError, match="torch"):
        module._load_predictor()


def test_next_trading_sessions_reference_vector_no_holiday():
    assert _next_trading_sessions(date(2026, 11, 6), 3) == [
        date(2026, 11, 9),
        date(2026, 11, 10),
        date(2026, 11, 11),
    ]


def test_next_trading_sessions_reference_vector_thanksgiving():
    assert _next_trading_sessions(date(2026, 11, 25), 3) == [
        date(2026, 11, 27),
        date(2026, 11, 30),
        date(2026, 12, 1),
    ]


def test_generate_forecast_rejects_lookback_over_the_configured_max(monkeypatch):
    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", _forbid_history)
    with pytest.raises(ValueError, match="lookback"):
        _forecast(lookback=settings.forecast_kronos_max_lookback + 1)


def test_generate_forecast_rejects_horizon_over_the_configured_max(monkeypatch):
    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", _forbid_history)
    with pytest.raises(ValueError, match="horizon"):
        _forecast(horizon=settings.forecast_kronos_max_horizon + 1)


def test_generate_forecast_rejects_sample_count_over_the_configured_max(monkeypatch):
    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", _forbid_history)
    with pytest.raises(ValueError, match="sample_count"):
        _forecast(sample_count=settings.forecast_kronos_max_sample_count + 1)


def test_generate_forecast_rejects_insufficient_cached_history(monkeypatch):
    sessions = _trading_days_ending(date(2026, 11, 6), 2)

    def short_history(*args, **kwargs):
        return {"bars": _bars(sessions)}

    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", short_history)
    with pytest.raises(ValueError, match="insufficient"):
        _forecast(lookback=5)


def test_generate_forecast_builds_correct_input_window_and_future_sessions(monkeypatch):
    pd = pytest.importorskip("pandas")

    sessions = _trading_days_ending(date(2026, 11, 6), 8)
    fixture = _bars(sessions)
    lookback = 3
    horizon = 3
    sample_count = 2
    seen = {}

    def history(*args, **kwargs):
        seen["kwargs"] = kwargs
        return {"bars": fixture}

    class FakePredictor:
        def __init__(self):
            self.kwargs = None

        def predict(self, df, x_timestamp, y_timestamp, pred_len, T=1.0, top_k=0, top_p=0.9, sample_count=1, verbose=True):
            self.kwargs = {
                "df": df,
                "x_timestamp": x_timestamp,
                "y_timestamp": y_timestamp,
                "pred_len": pred_len,
                "sample_count": sample_count,
                "verbose": verbose,
            }
            return pd.DataFrame({
                "open": [10.0 + index for index in range(pred_len)],
                "high": [11.0 + index for index in range(pred_len)],
                "low": [9.0 + index for index in range(pred_len)],
                "close": [10.5 + index for index in range(pred_len)],
                "volume": [100.0 + index for index in range(pred_len)],
            })

    fake = FakePredictor()
    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", history)
    monkeypatch.setattr("app.services.forecast_kronos._load_predictor", lambda: fake)

    result = _forecast(lookback=lookback, horizon=horizon, sample_count=sample_count)

    window = fixture[-lookback:]
    expected_x = [date.fromisoformat(bar["session_date"]) for bar in window]
    expected_y = _next_trading_sessions(expected_x[-1], horizon)
    assert seen["kwargs"]["symbol"] == "AAPL"
    assert seen["kwargs"]["interval"] == "1d"
    assert seen["kwargs"]["range_token"] == "2y"
    assert seen["kwargs"]["provider"] == "yahoo"
    assert seen["kwargs"]["adjustment_type"] == "raw"
    assert len(fake.kwargs["df"]) == lookback
    assert float(fake.kwargs["df"].iloc[0]["open"]) == float(window[0]["open"])
    assert float(fake.kwargs["df"].iloc[-1]["close"]) == float(window[-1]["close"])
    assert _as_dates(fake.kwargs["x_timestamp"]) == expected_x
    assert _as_dates(fake.kwargs["y_timestamp"]) == expected_y
    assert fake.kwargs["pred_len"] == horizon
    assert fake.kwargs["sample_count"] == sample_count
    assert fake.kwargs["verbose"] is False
    assert result["input_cutoff"] == window[-1]["session_date"]
    assert result["lookback"] == lookback
    assert result["horizon"] == horizon
    assert len(result["bars"]) == horizon
    assert [bar["session_date"] for bar in result["bars"]] == [day.isoformat() for day in expected_y]
    assert result["bars"][0]["open"] == 10.0
    assert result["bars"][-1]["close"] == 10.5 + (horizon - 1)
