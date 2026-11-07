"""SMA, EMA, and Wilder RSI over one cached daily history snapshot.

The window is the last N observed valid stored closes. Missing dates stay
missing: nothing fills a calendar, resets the carry, or reads a second clock.
"""

from decimal import ROUND_HALF_UP, Context, Decimal, InvalidOperation, localcontext

from fastapi import HTTPException

from app.services.market_history import PRICE_QUANTUM, read_symbol_history

_NAMES = frozenset({"sma", "ema", "rsi"})
_PERIOD_MIN = 2
_PERIOD_MAX = 200
# Digit text longer than this cannot be inside 2..200. Reject before int().
_PERIOD_TEXT_MAX = 3
_OHLC_DETAIL = "Accepted bar prices are not usable."


def read_symbol_indicators(
    db,
    *,
    symbol,
    interval,
    range_token,
    provider,
    adjustment_type,
    name,
    period,
) -> dict:
    indicator = _validate_indicator(name, period)
    history = read_symbol_history(
        db,
        symbol=symbol,
        interval=interval,
        range_token=range_token,
        provider=provider,
        adjustment_type=adjustment_type,
    )
    bars = history["bars"]
    closes = [_accepted_close(bar) for bar in bars]
    points = _points(closes, bars, indicator)
    return _response(history, indicator, points)


def _validate_indicator(name, period) -> tuple[str, int]:
    if not isinstance(name, str) or name not in _NAMES:
        raise HTTPException(status_code=422, detail="name must be sma, ema, or rsi.")
    if isinstance(period, bool) or isinstance(period, str) and (
        len(period) > _PERIOD_TEXT_MAX
        or not period.isascii()
        or not period.isdigit()
        or (len(period) > 1 and period.startswith("0"))
    ):
        raise HTTPException(status_code=422, detail="period must be an integer from 2 through 200.")
    if isinstance(period, int):
        number = period
    elif isinstance(period, str):
        number = int(period)
    else:
        raise HTTPException(status_code=422, detail="period must be an integer from 2 through 200.")
    if number < _PERIOD_MIN or number > _PERIOD_MAX:
        raise HTTPException(status_code=422, detail="period must be an integer from 2 through 200.")
    return name, number


def _accepted_close(bar: dict) -> Decimal:
    try:
        prices = {field: _finite_positive(bar[field]) for field in ("open", "high", "low", "close")}
    except (KeyError, InvalidOperation, ValueError, TypeError) as exc:
        raise HTTPException(status_code=500, detail=_OHLC_DETAIL) from exc
    low = prices["low"]
    high = prices["high"]
    open_ = prices["open"]
    close = prices["close"]
    if not (low <= min(open_, close) and max(open_, close) <= high):
        raise HTTPException(status_code=500, detail=_OHLC_DETAIL)
    return close


def _finite_positive(value: object) -> Decimal:
    if isinstance(value, bool) or value is None:
        raise InvalidOperation
    number = value if isinstance(value, Decimal) else Decimal(str(value))
    if not number.is_finite() or number <= 0:
        raise InvalidOperation
    return number


def _closes_required(name: str, period: int) -> int:
    # The first RSI needs `period` diffs, so it lands on close index `period`.
    if name == "rsi":
        return period + 1
    return period


def _points(closes: list[Decimal], bars: list[dict], indicator: tuple[str, int]) -> list[dict]:
    name, period = indicator
    count = len(closes)
    if count == 0:
        return []
    if count < _closes_required(name, period):
        return [{"session_date": bar["session_date"], "value": None} for bar in bars]

    with localcontext(Context(prec=50)):
        if name == "sma":
            values = _sma(closes, period)
        elif name == "ema":
            values = _ema(closes, period)
        else:
            values = _rsi(closes, period)
    return [
        {"session_date": bar["session_date"], "value": value}
        for bar, value in zip(bars, values, strict=True)
    ]


def _sma(closes: list[Decimal], period: int) -> list:
    divisor = Decimal(period)
    values: list = []
    running = Decimal(0)
    for index, close in enumerate(closes):
        running += close
        if index < period - 1:
            values.append(None)
            continue
        if index >= period:
            running -= closes[index - period]
        values.append(_response_text(running / divisor))
    return values


def _ema(closes: list[Decimal], period: int) -> list:
    alpha = Decimal(2) / Decimal(period + 1)
    one_minus = Decimal(1) - alpha
    seed = sum(closes[:period], Decimal(0)) / Decimal(period)
    values: list = [None] * (period - 1)
    carry = seed
    values.append(_response_text(carry))
    for close in closes[period:]:
        carry = alpha * close + one_minus * carry
        values.append(_response_text(carry))
    return values


def _rsi(closes: list[Decimal], period: int) -> list:
    diffs = [closes[index] - closes[index - 1] for index in range(1, len(closes))]
    gains = [diff if diff > 0 else Decimal(0) for diff in diffs]
    losses = [(-diff if diff < 0 else Decimal(0)) for diff in diffs]
    divisor = Decimal(period)
    retained = Decimal(period - 1)
    avg_gain = sum(gains[:period], Decimal(0)) / divisor
    avg_loss = sum(losses[:period], Decimal(0)) / divisor
    values: list = [None] * period
    values.append(_response_text(_rsi_from_averages(avg_gain, avg_loss)))
    for index in range(period + 1, len(closes)):
        avg_gain = (avg_gain * retained + gains[index - 1]) / divisor
        avg_loss = (avg_loss * retained + losses[index - 1]) / divisor
        values.append(_response_text(_rsi_from_averages(avg_gain, avg_loss)))
    return values


def _rsi_from_averages(avg_gain: Decimal, avg_loss: Decimal) -> Decimal:
    if avg_loss == 0 and avg_gain > 0:
        return Decimal(100)
    if avg_loss == 0 and avg_gain == 0:
        return Decimal(50)
    rs = avg_gain / avg_loss
    return Decimal(100) - Decimal(100) / (Decimal(1) + rs)


def _response_text(number: Decimal) -> str:
    return format(number.quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP), "f")


def _response(history: dict, indicator: tuple[str, int], points: list[dict]) -> dict:
    name, period = indicator
    count = len(points)
    if count == 0:
        status = "unavailable"
    elif count < _closes_required(name, period):
        status = "insufficient"
    else:
        status = "partial"
    return {
        "symbol": history["symbol"],
        "interval": history["interval"],
        "range": history["range"],
        "provider": history["provider"],
        "adjustment_type": history["adjustment_type"],
        "coverage_status": history["coverage_status"],
        "expected_session_count": history["expected_session_count"],
        "collection": history["collection"],
        "read_at": history["read_at"],
        "requested_start": history["requested_start"],
        "requested_end": history["requested_end"],
        "available_start": history["available_start"],
        "available_end": history["available_end"],
        "excluded_row_count": history["excluded_row_count"],
        "name": name,
        "period": period,
        "source": "observed_valid_closes",
        "observed_valid_closes": count,
        "session_basis": "not_exchange_sessions",
        "status": status,
        "points": points,
        "history": history,
    }
