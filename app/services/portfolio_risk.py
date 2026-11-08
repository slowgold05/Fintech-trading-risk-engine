"""Historical volatility, maximum drawdown, portfolio beta, tail loss, and correlation.

Volatility, drawdown, beta, and tail loss come from a single
``build_performance_response`` read. Volatility is the sample standard
deviation of period-over-period ``twr_index`` returns, as a percentage at
four decimal places, ``ROUND_HALF_UP``. It is per period, not annualized:
an unavailable day is skipped, so the calendar gap between two available
points is not one trading day. Maximum drawdown is the largest
``drawdown_pct`` already published on an available day, unchanged at its
existing four places. Portfolio beta is the sample covariance of paired
account and benchmark returns divided by the sample variance of those
benchmark returns, at the same four places. A day pairs only when the
account day is available and ``benchmark_index`` is set. Historical VaR and
Expected Shortfall are nearest-rank loss percentages on the same per-period
returns volatility uses, not the benchmark pairs. Below 20 returns every
tail field is null. From 20 through 99 returns only the 95% fields are
published, so a short sample never reports the same number for both
confidence levels.

Pairwise correlation is separate. It reads current non-zero holdings from
``build_portfolio_response`` and one raw-close query. A ``(symbol, date)``
with exactly one raw provider row is usable. Fewer than two holdings leaves
``correlations`` null.
"""

from collections import defaultdict
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Context, Decimal, localcontext
from itertools import combinations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_bar_daily import MarketBarDaily
from app.services.performance_service import build_performance_response
from app.services.portfolio_valuation import build_portfolio_response

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


def _historical_var_and_es(returns: list[Decimal]) -> dict[str, str | None]:
    """Nearest-rank empirical VaR and Expected Shortfall, as loss percentages.

    ``returns`` is the list ``_volatility_from_twr`` already computed. Sort
    ascending and take ``rank = ceil((1 - confidence) * count)``, at least 1.
    VaR is that single return, negated. Expected Shortfall is the mean of the
    worst ``rank`` returns, negated. Both are percentages at four places.

    Fewer than 20 returns leaves every field null: both confidence levels
    would otherwise read the same worst day. From 20 through 99 returns only
    the 95% fields are published. Under 100 observations the 99% rank cannot
    describe a distinct tail.
    """
    result: dict[str, str | None] = {
        "historical_var_95_pct": None,
        "historical_var_99_pct": None,
        "expected_shortfall_95_pct": None,
        "expected_shortfall_99_pct": None,
    }
    count = len(returns)
    if count < 20:
        return result
    with localcontext(Context(prec=50)):
        ordered = sorted(returns)

        def level(confidence: Decimal) -> tuple[str, str]:
            tail_mass = (Decimal(1) - confidence) * count
            rank = max(1, int(tail_mass.to_integral_value(rounding=ROUND_CEILING)))
            worst = ordered[:rank]
            var_value = (-worst[-1] * 100).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
            es_value = (-(sum(worst, Decimal(0)) / rank) * 100).quantize(
                FOUR_PLACES, rounding=ROUND_HALF_UP
            )
            return format(var_value, "f"), format(es_value, "f")

        var95, es95 = level(Decimal("0.95"))
        result["historical_var_95_pct"] = var95
        result["expected_shortfall_95_pct"] = es95
        if count >= 100:
            var99, es99 = level(Decimal("0.99"))
            result["historical_var_99_pct"] = var99
            result["expected_shortfall_99_pct"] = es99
    return result


def _single_provider_closes(
    db: Session, symbols: list[str], start: date, end: date
) -> dict[str, dict[date, Decimal]]:
    """One close per (symbol, date) where exactly one raw provider row exists.

    Same ambiguity rule performance_service.py's _account_value already
    enforces elsewhere in this codebase, reproduced here rather than
    imported, since that function is private to its own module.
    """
    result: dict[str, dict[date, Decimal]] = {symbol: {} for symbol in symbols}
    if not symbols:
        return result
    rows = db.execute(
        select(MarketBarDaily.symbol, MarketBarDaily.session_date, MarketBarDaily.close).where(
            MarketBarDaily.symbol.in_(symbols),
            MarketBarDaily.adjustment_type == "raw",
            MarketBarDaily.session_date >= start,
            MarketBarDaily.session_date <= end,
        )
    ).all()
    grouped: dict[tuple[str, date], list[Decimal]] = defaultdict(list)
    for row in rows:
        grouped[(row.symbol, row.session_date)].append(Decimal(str(row.close)))
    for (symbol, day), values in grouped.items():
        if len(values) == 1:
            result[symbol][day] = values[0]
    return result


def _pairwise_correlation(
    closes_a: dict[date, Decimal], closes_b: dict[date, Decimal]
) -> tuple[int, str | None]:
    """Sample Pearson correlation of simple returns over the common usable days.

    These are plain consecutive price ratios, not a chained TWR-style index -
    there is no flow concept for a single security's own price. Fewer than
    two common returns, or a security with zero variance across them, leaves
    correlation undetermined.
    """
    common_days = sorted(set(closes_a) & set(closes_b))
    prices_a = [closes_a[day] for day in common_days]
    prices_b = [closes_b[day] for day in common_days]
    with localcontext(Context(prec=50)):
        returns_a = [prices_a[i] / prices_a[i - 1] - 1 for i in range(1, len(prices_a))]
        returns_b = [prices_b[i] / prices_b[i - 1] - 1 for i in range(1, len(prices_b))]
        pair_return_count = len(returns_a)
        if pair_return_count < 2:
            return pair_return_count, None
        mean_a = sum(returns_a, Decimal(0)) / pair_return_count
        mean_b = sum(returns_b, Decimal(0)) / pair_return_count
        covariance = sum(
            (
                (returns_a[index] - mean_a) * (returns_b[index] - mean_b)
                for index in range(pair_return_count)
            ),
            Decimal(0),
        ) / (pair_return_count - 1)
        variance_a = sum(
            ((item - mean_a) ** 2 for item in returns_a), Decimal(0)
        ) / (pair_return_count - 1)
        variance_b = sum(
            ((item - mean_b) ** 2 for item in returns_b), Decimal(0)
        ) / (pair_return_count - 1)
        if variance_a == 0 or variance_b == 0:
            return pair_return_count, None
        correlation = covariance / (variance_a * variance_b).sqrt()
        pct = correlation.quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
        return pair_return_count, format(pct, "f")


def _held_correlations(
    db: Session, user_id: int, email: str, requested_start: str, requested_end: str
) -> list[dict] | None:
    """One entry per held pair, or null when fewer than two symbols are held."""
    portfolio = build_portfolio_response(db, user_id, email)
    held_symbols = sorted({position["symbol"] for position in portfolio["positions"]})
    if len(held_symbols) < 2:
        return None
    closes_by_symbol = _single_provider_closes(
        db,
        held_symbols,
        date.fromisoformat(requested_start),
        date.fromisoformat(requested_end),
    )
    correlations = []
    # `held_symbols` is sorted, so combinations already emits each pair in
    # ascending order. The sort below keeps that contract order explicit.
    for symbol_a, symbol_b in combinations(held_symbols, 2):
        pair_return_count, correlation = _pairwise_correlation(
            closes_by_symbol[symbol_a], closes_by_symbol[symbol_b]
        )
        correlations.append({
            "symbols": [symbol_a, symbol_b],
            "return_count": pair_return_count,
            "correlation": correlation,
        })
    correlations.sort(key=lambda item: item["symbols"])
    return correlations


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
    # Same per-period twr returns as volatility, not the benchmark pairs beta uses.
    tail = _historical_var_and_es(returns)
    correlations = _held_correlations(
        db,
        user_id,
        email,
        performance["requested_start"],
        performance["requested_end"],
    )
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
        "historical_var_95_pct": tail["historical_var_95_pct"],
        "historical_var_99_pct": tail["historical_var_99_pct"],
        "expected_shortfall_95_pct": tail["expected_shortfall_95_pct"],
        "expected_shortfall_99_pct": tail["expected_shortfall_99_pct"],
        "correlations": correlations,
    }
