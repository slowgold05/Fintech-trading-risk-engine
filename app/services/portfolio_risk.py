"""Historical volatility and maximum drawdown over one performance series.

Both numbers come from a single ``build_performance_response`` read.
Volatility is the sample standard deviation of period-over-period
``twr_index`` returns, as a percentage at four decimal places,
``ROUND_HALF_UP``. It is per period, not annualized: an unavailable day is
skipped, so the calendar gap between two available points is not one trading
day. Maximum drawdown is the largest ``drawdown_pct`` already published on
an available day, unchanged at its existing four places.
"""

from decimal import ROUND_HALF_UP, Context, Decimal, localcontext

from sqlalchemy.orm import Session

from app.services.performance_service import build_performance_response

FOUR_PLACES = Decimal("0.0001")


def _max_drawdown_pct(drawdown_values: list[Decimal]) -> str | None:
    """Largest published drawdown. ``max`` keeps that exact ``Decimal``."""
    if not drawdown_values:
        return None
    return format(max(drawdown_values), "f")


def _volatility_from_twr(twr_values: list[Decimal]) -> tuple[list[Decimal], str | None]:
    """Sample stdev of consecutive growth ratios, inside precision 50.

    Fewer than two returns cannot form a sample variance. The caller still
    receives the return list so its length can be checked against the
    available-day count.
    """
    with localcontext(Context(prec=50)):
        returns = [
            twr_values[index] / twr_values[index - 1] - 1
            for index in range(1, len(twr_values))
        ]
        if len(returns) < 2:
            return returns, None
        count = len(returns)
        mean = sum(returns, Decimal(0)) / count
        # Sample variance (ddof=1): divide by n - 1, not by n.
        variance = sum(((item - mean) ** 2 for item in returns), Decimal(0)) / (count - 1)
        stdev = variance.sqrt()
        pct = (stdev * 100).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
        return returns, format(pct, "f")


def build_risk_metrics_response(db: Session, user_id: int, email: str, range_token: str) -> dict:
    performance = build_performance_response(db, user_id, email, range_token)
    available = [point for point in performance["series"] if point["status"] == "available"]
    observed_periods = len(available)
    drawdown_values = [Decimal(point["drawdown_pct"]) for point in available]
    twr_values = [Decimal(point["twr_index"]) for point in available]
    returns, historical_volatility_pct = _volatility_from_twr(twr_values)
    # Contract count is observed days minus one. It must match the ratios above.
    return_count = max(observed_periods - 1, 0)
    if len(returns) != return_count:
        raise AssertionError("return_count does not match the twr_index ratios")
    return {
        "user": performance["user"],
        "range": performance["range"],
        "requested_start": performance["requested_start"],
        "requested_end": performance["requested_end"],
        "read_at": performance["read_at"],
        "status": performance["status"],
        "observed_periods": observed_periods,
        "return_count": return_count,
        "historical_volatility_pct": historical_volatility_pct,
        "max_drawdown_pct": _max_drawdown_pct(drawdown_values),
    }
