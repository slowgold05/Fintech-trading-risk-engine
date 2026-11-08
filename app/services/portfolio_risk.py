"""Historical volatility, maximum drawdown, and portfolio beta.

All three numbers come from a single ``build_performance_response`` read.
Volatility is the sample standard deviation of period-over-period
``twr_index`` returns, as a percentage at four decimal places,
``ROUND_HALF_UP``. It is per period, not annualized: an unavailable day is
skipped, so the calendar gap between two available points is not one trading
day. Maximum drawdown is the largest ``drawdown_pct`` already published on
an available day, unchanged at its existing four places. Portfolio beta is
the sample covariance of paired account and benchmark returns divided by the
sample variance of those benchmark returns, at the same four places. A day
pairs only when the account day is available and ``benchmark_index`` is set.
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


def _beta(paired_twr: list[Decimal], paired_benchmark: list[Decimal]) -> tuple[int, str | None]:
    """Sample covariance of paired returns over sample variance of the benchmark's.

    `paired_twr`/`paired_benchmark` must already be the same length and in
    the same order - one account `twr_index` and one `benchmark_index` per
    day where both were actually available. Fewer than two return pairs, or
    a benchmark with no variation across them, leaves beta undetermined.
    """
    with localcontext(Context(prec=50)):
        p_returns = [
            paired_twr[index] / paired_twr[index - 1] - 1
            for index in range(1, len(paired_twr))
        ]
        s_returns = [
            paired_benchmark[index] / paired_benchmark[index - 1] - 1
            for index in range(1, len(paired_benchmark))
        ]
        pair_count = len(p_returns)
        if pair_count < 2:
            return pair_count, None
        mean_p = sum(p_returns, Decimal(0)) / pair_count
        mean_s = sum(s_returns, Decimal(0)) / pair_count
        # Sample covariance and variance (ddof=1): divide by n - 1, not by n.
        covariance = sum(
            (
                (p_returns[index] - mean_p) * (s_returns[index] - mean_s)
                for index in range(pair_count)
            ),
            Decimal(0),
        ) / (pair_count - 1)
        variance_s = sum(
            ((item - mean_s) ** 2 for item in s_returns), Decimal(0)
        ) / (pair_count - 1)
        if variance_s == 0:
            return pair_count, None
        beta = (covariance / variance_s).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
        return pair_count, format(beta, "f")


def build_risk_metrics_response(db: Session, user_id: int, email: str, range_token: str) -> dict:
    performance = build_performance_response(db, user_id, email, range_token)
    available = [point for point in performance["series"] if point["status"] == "available"]
    # A pair needs the account day and a SPY index. `available` does not
    # filter `benchmark_index`, and that field is null independently of status.
    paired_twr = []
    paired_benchmark = []
    for point in performance["series"]:
        if point["status"] != "available":
            continue
        benchmark_index = point.get("benchmark_index")
        if benchmark_index is None:
            continue
        paired_twr.append(Decimal(point["twr_index"]))
        paired_benchmark.append(Decimal(benchmark_index))
    beta_pair_count, portfolio_beta = _beta(paired_twr, paired_benchmark)
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
        "beta_pair_count": beta_pair_count,
        "portfolio_beta": portfolio_beta,
    }
