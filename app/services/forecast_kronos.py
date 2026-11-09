"""Bounded Kronos forecast from cached daily bars.

Torch and the vendored model import only inside `_import_kronos`. This module
stays importable when those packages are absent. The result is not an approved
risk signal, and it does not change a hard limit.
"""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.core.config import settings
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.market_history import read_symbol_history

_predictor_cache = {}


def _iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _import_kronos():
    try:
        import pandas  # noqa: F401
        import torch  # noqa: F401
        from app.vendor.kronos import Kronos, KronosPredictor, KronosTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "pandas, torch, and/or the vendored kronos model package are not installed"
        ) from exc
    return Kronos, KronosPredictor, KronosTokenizer


def _load_predictor():
    if "predictor" in _predictor_cache:
        return _predictor_cache["predictor"]
    Kronos, KronosPredictor, KronosTokenizer = _import_kronos()
    tokenizer = KronosTokenizer.from_pretrained(
        settings.forecast_kronos_tokenizer_name, cache_dir=settings.forecast_kronos_cache_dir
    )
    model = Kronos.from_pretrained(
        settings.forecast_kronos_model_name, cache_dir=settings.forecast_kronos_cache_dir
    )
    predictor = KronosPredictor(model, tokenizer, max_context=512)
    _predictor_cache["predictor"] = predictor
    return predictor


def _next_trading_sessions(after: date, count: int) -> list[date]:
    sessions: list[date] = []
    day = after
    while len(sessions) < count:
        day = day + timedelta(days=1)
        if is_nyse_trading_day(day):
            sessions.append(day)
    return sessions


def generate_forecast(
    db: Session,
    *,
    symbol: str,
    provider: str,
    adjustment_type: str,
    lookback: int,
    horizon: int,
    sample_count: int,
    seed: int | None = None,
    as_of: date | None = None,
) -> dict:
    if lookback > settings.forecast_kronos_max_lookback:
        raise ValueError(f"lookback must not exceed {settings.forecast_kronos_max_lookback}.")
    if horizon > settings.forecast_kronos_max_horizon:
        raise ValueError(f"horizon must not exceed {settings.forecast_kronos_max_horizon}.")
    if sample_count > settings.forecast_kronos_max_sample_count:
        raise ValueError(f"sample_count must not exceed {settings.forecast_kronos_max_sample_count}.")

    history = read_symbol_history(
        db, symbol=symbol, interval="1d", range_token="2y",
        provider=provider, adjustment_type=adjustment_type,
    )
    bars = history["bars"]
    if as_of is not None:
        bars = [
            bar for bar in bars
            if date.fromisoformat(bar["session_date"]) <= as_of
        ]
    if len(bars) < lookback:
        raise ValueError(
            f"insufficient history: {len(bars)} cached session(s), {lookback} requested."
        )
    window = bars[-lookback:]

    try:
        import pandas as pd
    except ImportError as exc:
        raise RuntimeError("pandas is not installed") from exc

    df = pd.DataFrame({
        "open": [float(bar["open"]) for bar in window],
        "high": [float(bar["high"]) for bar in window],
        "low": [float(bar["low"]) for bar in window],
        "close": [float(bar["close"]) for bar in window],
        "volume": [float(bar["volume"]) for bar in window],
    })
    x_timestamp = pd.Series([date.fromisoformat(bar["session_date"]) for bar in window])
    last_date = date.fromisoformat(window[-1]["session_date"])
    future_sessions = _next_trading_sessions(last_date, horizon)
    y_timestamp = pd.Series(future_sessions)

    predictor = _load_predictor()
    if seed is not None:
        import torch
        torch.manual_seed(seed)
    pred_df = predictor.predict(
        df=df, x_timestamp=x_timestamp, y_timestamp=y_timestamp,
        pred_len=horizon, sample_count=sample_count, verbose=False,
    )

    forecast_bars = [
        {
            "session_date": session.isoformat(),
            "open": float(pred_df.iloc[index]["open"]),
            "high": float(pred_df.iloc[index]["high"]),
            "low": float(pred_df.iloc[index]["low"]),
            "close": float(pred_df.iloc[index]["close"]),
            "volume": float(pred_df.iloc[index]["volume"]),
        }
        for index, session in enumerate(future_sessions)
    ]

    return {
        "symbol": symbol,
        "provider": provider,
        "adjustment_type": adjustment_type,
        "model_name": settings.forecast_kronos_model_name,
        "tokenizer_name": settings.forecast_kronos_tokenizer_name,
        "lookback": lookback,
        "horizon": horizon,
        "sample_count": sample_count,
        "input_cutoff": window[-1]["session_date"],
        "generated_at": _iso_z(datetime.now(timezone.utc)),
        "bars": forecast_bars,
    }
