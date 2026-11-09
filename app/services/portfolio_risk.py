"""Historical volatility, maximum drawdown, portfolio beta, tail loss, correlation, stress loss, and risk contribution.

Volatility, drawdown, beta, and tail loss come from one performance read
inside the same snapshot as valuation, allocation, and the close queries.
Volatility is the sample standard deviation of period-over-period
``twr_index`` returns, as a percentage at four decimal places,
``ROUND_HALF_UP``. It is per period, not annualized: an unavailable day is
skipped, so the calendar gap between two available points is not one trading
day. A positive prior index is the only denominator. A current index of
zero is a defined -100% return, then a barrier. A null or negative index
forms no return. The next positive index does not divide across that
barrier. Maximum drawdown is the largest published ``drawdown_pct``. A null
drawdown is omitted, and an empty set stays null rather than becoming zero.
Portfolio beta uses the same denominator rule on each paired series. A day
pairs only when the account day is available and ``benchmark_index`` is set.
A missing benchmark day is skipped and does not break the chain. A null or
negative index on either side forms no pair. Historical VaR and Expected
Shortfall are nearest-rank loss percentages on the same per-period returns
volatility uses, not the benchmark pairs. ``return_count`` is the number of
those defined ratios. Below 20 returns every tail field is null. From 20
through 99 returns only the 95% fields are published, so a short sample
never reports the same number for both confidence levels.

Pairwise correlation uses the valuation already read in this snapshot and
one raw-close query. A ``(symbol, date)`` with exactly one raw provider row
is usable. Fewer than two holdings leaves ``correlations`` null. A missing
close stays out of the common-day chain. A nonpositive close is a barrier
and is not bridged by dropping it.

Stress-test loss uses the allocation classified from that same valuation.
Three fixed shocks apply to priced holdings: 10% of every security, 25% of
those already classified Technology, and 30% of the single largest position.
An incomplete allocation leaves ``stress_scenarios`` null. Cash is not
shocked. Loss is cents. A zero dollar loss stays ``"0.00"``. Loss percent is
four places, or null when account value is zero.

Risk contribution reads that same allocation. It decomposes
portfolio variance across priced holdings: each share is that security's
weight times its covariance row. A pair uses its own common usable days,
and a security's diagonal is that security's own sample variance. One
missing covariance, a non-positive portfolio variance, or an incomplete
allocation nulls the whole list. The percentages are four places and sum
to 100.0000. This is contribution to variance, not volatility.
"""

from collections import defaultdict
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Context, Decimal, localcontext
from itertools import combinations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.read_snapshot import SnapshotClockError, consistent_read, snapshot_clock
from app.models.market_bar_daily import MarketBarDaily
from app.services.performance_service import _performance, require_performance_range
from app.services.portfolio_allocation import allocation_from_portfolio
from app.services.portfolio_valuation import _value_portfolio

FOUR_PLACES = Decimal("0.0001")
CENT = Decimal("0.01")
_SCENARIO_SHOCKS = (
    ("broad_market_selloff", Decimal("0.10"), "-10.0000"),
    ("technology_sector_selloff", Decimal("0.25"), "-25.0000"),
)
_WORST_HOLDING_SHOCK = Decimal("0.30")
_WORST_HOLDING_SHOCK_TEXT = "-30.0000"


def _optional_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    return Decimal(value)


def _defined_index_returns(values: list[Decimal | None]) -> list[Decimal]:
    """Growth ratios. Only a positive index may be a denominator.

    A current zero after a positive prior is a -100% return (``0 / prior - 1``).
    That zero is then a barrier, so the next point does not divide by it.
    ``None`` and a negative index form no return. A later positive index may
    start a new link. It does not reach back across the barrier.
    """
    returns: list[Decimal] = []
    previous: Decimal | None = None
    for value in values:
        if previous is not None and previous > 0 and value is not None and value >= 0:
            returns.append(value / previous - 1)
        # Zero has been consumed as a numerator. It is not a later denominator.
        if value is not None and value > 0:
            previous = value
        else:
            previous = None
    return returns


def _paired_index_returns(
    left: list[Decimal | None],
    right: list[Decimal | None],
) -> tuple[list[Decimal], list[Decimal]]:
    """Paired ratios. Both prior denominators must be positive.

    A zero on either side is a valid numerator, so a terminal zero still
    produces that pair. A zero, null, or negative value cannot be the next
    denominator, and the following positive pair does not bridge over it.
    """
    left_returns: list[Decimal] = []
    right_returns: list[Decimal] = []
    previous_left: Decimal | None = None
    previous_right: Decimal | None = None
    for left_value, right_value in zip(left, right, strict=True):
        priors = (
            previous_left is not None
            and previous_right is not None
            and previous_left > 0
            and previous_right > 0
        )
        if (
            priors
            and left_value is not None
            and right_value is not None
            and left_value >= 0
            and right_value >= 0
        ):
            left_returns.append(left_value / previous_left - 1)
            right_returns.append(right_value / previous_right - 1)
        if (
            left_value is not None
            and right_value is not None
            and left_value > 0
            and right_value > 0
        ):
            previous_left = left_value
            previous_right = right_value
        else:
            previous_left = None
            previous_right = None
    return left_returns, right_returns


def _max_drawdown_pct(drawdown_values: list[Decimal]) -> str | None:
    """Largest published drawdown. ``max`` keeps that exact ``Decimal``."""
    if not drawdown_values:
        return None
    return format(max(drawdown_values), "f")


def _volatility_from_twr(twr_values: list[Decimal | None]) -> tuple[list[Decimal], str | None]:
    """Sample stdev of consecutive growth ratios, inside precision 50.

    Fewer than two defined returns cannot form a sample variance. A zero
    index after a positive prior counts as -100%. It does not become the next
    denominator, and a null or negative index adds no return.
    """
    with localcontext(Context(prec=50)):
        returns = _defined_index_returns(twr_values)
        if len(returns) < 2:
            return returns, None
        count = len(returns)
        mean = sum(returns, Decimal(0)) / count
        # Sample variance (ddof=1): divide by n - 1, not by n.
        variance = sum(((item - mean) ** 2 for item in returns), Decimal(0)) / (count - 1)
        stdev = variance.sqrt()
        pct = (stdev * 100).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
        return returns, format(pct, "f")


def _beta(
    paired_twr: list[Decimal | None],
    paired_benchmark: list[Decimal | None],
) -> tuple[int, str | None]:
    """Sample covariance of paired returns over sample variance of the benchmark's.

    `paired_twr`/`paired_benchmark` must already be the same length and in
    the same order. A missing benchmark day is omitted by the caller, which
    keeps the last-available link across that gap. A zero numerator with
    positive priors is a defined pair, including a -100% leg. Zero is not the
    next denominator. A null or negative index adds no pair and blocks the
    next one. Fewer than two pairs, or a benchmark with no variation, leaves
    beta null. Neither side is divided unless its prior index is positive.
    """
    with localcontext(Context(prec=50)):
        p_returns, s_returns = _paired_index_returns(paired_twr, paired_benchmark)
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


def _paired_price_returns(
    prices_a: list[Decimal],
    prices_b: list[Decimal],
) -> tuple[list[Decimal], list[Decimal]]:
    """Simple returns on aligned closes. A nonpositive close does not bridge.

    Missing sessions are already absent from the common-day list. That
    last-available chain stays. A zero close cannot be a denominator, and the
    following positive close does not reach back across it.
    """
    left: list[Decimal] = []
    right: list[Decimal] = []
    previous_left: Decimal | None = None
    previous_right: Decimal | None = None
    for price_a, price_b in zip(prices_a, prices_b, strict=True):
        if (
            previous_left is not None
            and previous_right is not None
            and previous_left > 0
            and previous_right > 0
        ):
            left.append(price_a / previous_left - 1)
            right.append(price_b / previous_right - 1)
        if price_a > 0 and price_b > 0:
            previous_left = price_a
            previous_right = price_b
        else:
            previous_left = None
            previous_right = None
    return left, right


def _pairwise_covariance(
    closes_a: dict[date, Decimal], closes_b: dict[date, Decimal]
) -> Decimal | None:
    """Raw sample covariance of simple returns over the common usable days.

    ``None`` below two common returns, the same threshold
    ``_pairwise_correlation`` already uses, since a sample covariance needs
    the same minimum. When ``closes_a`` and ``closes_b`` are the same dict,
    this is that security's own sample variance.
    """
    common_days = sorted(set(closes_a) & set(closes_b))
    prices_a = [closes_a[day] for day in common_days]
    prices_b = [closes_b[day] for day in common_days]
    with localcontext(Context(prec=50)):
        returns_a, returns_b = _paired_price_returns(prices_a, prices_b)
        pair_return_count = len(returns_a)
        if pair_return_count < 2:
            return None
        mean_a = sum(returns_a, Decimal(0)) / pair_return_count
        mean_b = sum(returns_b, Decimal(0)) / pair_return_count
        covariance = sum(
            (
                (returns_a[index] - mean_a) * (returns_b[index] - mean_b)
                for index in range(pair_return_count)
            ),
            Decimal(0),
        ) / (pair_return_count - 1)
        return covariance


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
        returns_a, returns_b = _paired_price_returns(prices_a, prices_b)
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
    db: Session, portfolio: dict, requested_start: date, requested_end: date
) -> list[dict] | None:
    """One entry per held pair, or null when fewer than two symbols are held."""
    held_symbols = sorted({position["symbol"] for position in portfolio["positions"]})
    if len(held_symbols) < 2:
        return None
    closes_by_symbol = _single_provider_closes(
        db,
        held_symbols,
        requested_start,
        requested_end,
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


def _priced_securities(securities: list[dict]) -> list[dict]:
    """Holdings a shock can revalue. Unpriced rows stay out of every sum."""
    return [
        item
        for item in securities
        if item["price_status"] == "available" and item["position_value"] is not None
    ]


def _scenario_loss(priced: list[dict], *, sector: str | None, shock: Decimal) -> Decimal:
    """Dollar loss before cent rounding. ``sector`` None shocks every priced holding.

    The percentage uses the cent-rounded loss, so this sum does not divide.
    """
    affected = priced if sector is None else [item for item in priced if item["sector"] == sector]
    return sum((Decimal(item["position_value"]) * shock for item in affected), Decimal(0))


def _loss_pct(loss: Decimal, total_account_value: Decimal) -> str | None:
    """Percent of account value. Zero capital has no percentage. Dollar loss stays put."""
    if total_account_value == 0:
        return None
    pct = (loss / total_account_value * 100).quantize(FOUR_PLACES, rounding=ROUND_HALF_UP)
    return format(pct, "f")


def _stress_scenarios(allocation: dict) -> list[dict] | None:
    """Three fixed downside shocks, or null when allocation is incomplete.

    A complete book with nothing priced still returns three entries. The
    first two are a measured zero. The worst-holding entry is present with
    null loss fields, because there is no symbol to name.
    """
    if allocation["status"] != "complete":
        return None
    total_account_value = Decimal(allocation["total_account_value"])
    priced = _priced_securities(allocation["securities"])
    scenarios = []
    for name, shock, shock_text in _SCENARIO_SHOCKS:
        sector = "Technology" if name == "technology_sector_selloff" else None
        loss = _scenario_loss(priced, sector=sector, shock=shock).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        scenarios.append({
            "scenario": name,
            "shock_pct": shock_text,
            "loss": format(loss, "f"),
            "loss_pct": _loss_pct(loss, total_account_value),
        })
    if priced:
        # Largest position_value. Ties break by ascending symbol.
        worst = min(priced, key=lambda item: (-Decimal(item["position_value"]), item["symbol"]))
        worst_loss = (Decimal(worst["position_value"]) * _WORST_HOLDING_SHOCK).quantize(
            CENT, rounding=ROUND_HALF_UP
        )
        scenarios.append({
            "scenario": "single_security_worst_holding",
            "shock_pct": _WORST_HOLDING_SHOCK_TEXT,
            "affected_symbol": worst["symbol"],
            "loss": format(worst_loss, "f"),
            "loss_pct": _loss_pct(worst_loss, total_account_value),
        })
    else:
        scenarios.append({
            "scenario": "single_security_worst_holding",
            "shock_pct": _WORST_HOLDING_SHOCK_TEXT,
            "affected_symbol": None,
            "loss": None,
            "loss_pct": None,
        })
    return scenarios


def _risk_contributions(
    db: Session, allocation: dict, start: date, end: date
) -> list[dict] | None:
    """Variance decomposition of the portfolio's held, priced securities.

    Every pairwise covariance, diagonal included, must be computable, or
    the whole result is null. One missing entry invalidates the matrix.
    Contribution is to portfolio variance, not volatility. Percentages
    still sum to exactly 100.0000.
    """
    if allocation["status"] != "complete":
        return None
    # ``.get`` treats a row that omits the key the same as an explicit null.
    held = [
        item
        for item in allocation["securities"]
        if item["price_status"] == "available"
        and item["position_value"] is not None
        and item.get("weight_pct") is not None
    ]
    if not held:
        return None
    symbols = [item["symbol"] for item in held]
    weights = {item["symbol"]: Decimal(item["weight_pct"]) / 100 for item in held}
    closes_by_symbol = _single_provider_closes(db, symbols, start, end)

    covariance: dict[tuple[str, str], Decimal] = {}
    for symbol_a in symbols:
        for symbol_b in symbols:
            # Sample covariance is symmetric. The reverse pair is the same value.
            if (symbol_b, symbol_a) in covariance:
                covariance[(symbol_a, symbol_b)] = covariance[(symbol_b, symbol_a)]
                continue
            value = _pairwise_covariance(
                closes_by_symbol[symbol_a], closes_by_symbol[symbol_b]
            )
            if value is None:
                return None
            covariance[(symbol_a, symbol_b)] = value

    with localcontext(Context(prec=50)):
        sigma_w = {
            symbol_a: sum(
                (covariance[(symbol_a, symbol_b)] * weights[symbol_b] for symbol_b in symbols),
                Decimal(0),
            )
            for symbol_a in symbols
        }
        contributions = {symbol: weights[symbol] * sigma_w[symbol] for symbol in symbols}
        portfolio_variance = sum(contributions.values(), Decimal(0))
        if portfolio_variance <= 0:
            return None
        results = []
        for item in sorted(held, key=lambda entry: entry["symbol"]):
            symbol = item["symbol"]
            pct = (contributions[symbol] / portfolio_variance * 100).quantize(
                FOUR_PLACES, rounding=ROUND_HALF_UP
            )
            results.append({
                "symbol": symbol,
                "weight_pct": item["weight_pct"],
                "risk_contribution_pct": format(pct, "f"),
            })
        return results


def _beta_indexes(series: list[dict]) -> tuple[list[Decimal | None], list[Decimal | None]]:
    """Paired indexes. A missing benchmark on a funded day stays a skip.

    Unavailable price days are omitted. Their published indexes already chain
    across that gap. A null portfolio index stays in the list as a barrier.
    Zero stays in the list so a terminal total loss can be paired. It is not
    reused as a denominator.
    """
    paired_twr: list[Decimal | None] = []
    paired_benchmark: list[Decimal | None] = []
    for point in series:
        if point["status"] != "available":
            continue
        twr_index = _optional_decimal(point.get("twr_index"))
        benchmark_index = _optional_decimal(point.get("benchmark_index"))
        if benchmark_index is None and twr_index is not None and twr_index > 0:
            continue
        if twr_index is None or benchmark_index is None:
            paired_twr.append(None)
            paired_benchmark.append(None)
            continue
        paired_twr.append(twr_index)
        paired_benchmark.append(benchmark_index)
    return paired_twr, paired_benchmark


def build_risk_metrics_response(db: Session, user_id: int, email: str, range_token: str) -> dict:
    require_performance_range(range_token)
    with consistent_read(db):
        try:
            clock = snapshot_clock(db)
        except SnapshotClockError as exc:
            raise HTTPException(status_code=500, detail="Portfolio snapshot time is missing.") from exc
        # One valuation feeds correlation symbols and allocation. Performance
        # reuses this clock and this portfolio for reconciliation.
        portfolio = _value_portfolio(db, user_id, email, clock=clock)
        performance = _performance(
            db, user_id, email, range_token, clock=clock, portfolio=portfolio,
        )
        allocation = allocation_from_portfolio(db, portfolio)
        return _metrics_from_snapshot(db, performance, portfolio, allocation)


def _metrics_from_snapshot(
    db: Session,
    performance: dict,
    portfolio: dict,
    allocation: dict,
) -> dict:
    available = [point for point in performance["series"] if point["status"] == "available"]
    paired_twr, paired_benchmark = _beta_indexes(performance["series"])
    beta_pair_count, portfolio_beta = _beta(paired_twr, paired_benchmark)
    observed_periods = len(available)
    drawdown_values = [
        Decimal(point["drawdown_pct"])
        for point in available
        if point.get("drawdown_pct") is not None
    ]
    twr_values = [_optional_decimal(point.get("twr_index")) for point in available]
    returns, historical_volatility_pct = _volatility_from_twr(twr_values)
    # Count ratios that were actually defined. A sealed or empty index is not
    # imputed, and it is not dropped so neighbors can be divided.
    return_count = len(returns)
    tail = _historical_var_and_es(returns)
    requested_start = date.fromisoformat(performance["requested_start"])
    requested_end = date.fromisoformat(performance["requested_end"])
    correlations = _held_correlations(db, portfolio, requested_start, requested_end)
    stress_scenarios = _stress_scenarios(allocation)
    risk_contributions = _risk_contributions(
        db, allocation, requested_start, requested_end
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
        "stress_scenarios": stress_scenarios,
        "risk_contributions": risk_contributions,
    }
