"""Versioned templates for evidence-backed Today and Portfolio sentences."""

from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read
from app.schemas.night_portfolio_review import (
    Coverage, Insight, InsightEvidence, OmittedInsight, PortfolioInsights, Provenance, Surface, Window,
)
from app.services.night_portfolio_review import NEW_YORK, ReviewSnapshot, review_in_snapshot

RULES_VERSION = "v1"
TODAY_WINDOW: Window = "1y"
CONCENTRATION_THRESHOLD = Decimal("0.25")
DISPLAY_RATIO_UNIT = Decimal("0.0001")


def _count(label: str, value: int, start: date, end: date) -> InsightEvidence:
    return InsightEvidence(label=label, value=value, unit="count", from_date=start, to_date=end)


def _ratio(
    label: str, value: Decimal, start: date, end: date, source: Provenance | None = None,
) -> InsightEvidence:
    displayed = value.quantize(DISPLAY_RATIO_UNIT, rounding=ROUND_HALF_UP)
    return InsightEvidence(
        label=label, value=format(displayed if displayed else abs(displayed), "f"),
        unit="ratio", from_date=start, to_date=end, source=source,
    )


def _percent(evidence: InsightEvidence) -> str:
    return f"{Decimal(evidence.value) * 100:.2f}%"


def _close_change_v1(data: ReviewSnapshot) -> Insight | OmittedInsight:
    values = data.values
    review = data.review
    if review.end_used is not None and review.end_used != review.requested_end:
        return OmittedInsight(rule="close_change", reason="The latest entitled session has no account value.")
    if len(values) < 2:
        return OmittedInsight(rule="close_change", reason="Two valued sessions in the one-year lookback are required.")
    if not data.recent_close_compatible:
        return OmittedInsight(rule="close_change", reason="Marks and posted share units could not be reconciled.")

    previous, latest = list(values)[-2:]
    net = InsightEvidence(
        label="net_account_change", value=format(values[latest].pnl, ".2f"), unit="usd",
        from_date=previous, to_date=latest,
    )
    gap = sum(previous < day < latest for day in review.missing_sessions)
    evidence = [net]
    gap_text = ""
    if gap:
        evidence.append(_count("intervening_missing_sessions", gap, previous, latest))
        gap_text = f", with {gap} unvalued {'session' if gap == 1 else 'sessions'} in between"
    return Insight(
        rule="close_change",
        text=f"Net of external flows, the account value changed by {net.value} USD from {previous} to {latest}{gap_text}.",
        evidence=evidence,
    )


def _spy_comparison_v1(data: ReviewSnapshot) -> Insight | OmittedInsight:
    review = data.review
    metrics = review.metrics
    start, end = review.start_used, review.end_used
    if end is not None and end != review.requested_end:
        return OmittedInsight(rule="spy_comparison", reason="The latest entitled session has no account value.")
    if metrics.return_ratio is None or metrics.spy_return_ratio is None or data.spy_source is None:
        return OmittedInsight(rule="spy_comparison", reason="A portfolio return and one SPY series need the same valued endpoints.")
    if any(
        point.portfolio_return_ratio is None or point.spy_return_ratio is None
        for point in review.points if start <= point.session_date <= end
    ):
        return OmittedInsight(rule="spy_comparison", reason="A portfolio or SPY session is missing inside the comparison.")
    if review.contribution.coverage != "available":
        return OmittedInsight(rule="spy_comparison", reason="Marks and posted share units could not be reconciled.")

    source = Provenance(
        provider=data.spy_source.provider, basis=data.spy_source.adjustment,
        session_date=end, observed_at=None, coverage="available",
    )
    portfolio = _ratio("portfolio_return", Decimal(metrics.return_ratio), start, end)
    spy = _ratio("spy_price_return", Decimal(metrics.spy_return_ratio), start, end, source)
    basis = source.basis.replace("_", "-")
    return Insight(
        rule="spy_comparison",
        text=(f"From {start} to {end}, the portfolio returned {_percent(portfolio)} "
              f"and SPY returned {_percent(spy)} using {source.provider} {basis} closes."),
        evidence=[portfolio, spy],
    )


def _largest_holding_v1(data: ReviewSnapshot) -> Insight | OmittedInsight:
    exposure = data.review.exposure
    allocation = data.allocation
    if exposure.coverage == "stale":
        return OmittedInsight(rule="largest_holding", reason="One or more quotes are older than the latest entitled close.")
    if exposure.coverage != "available" or exposure.as_of is None:
        return OmittedInsight(rule="largest_holding", reason="A current, fully priced account is required.")
    if not allocation["securities"]:
        return OmittedInsight(rule="largest_holding", reason="The account has no holdings.")
    total = Decimal(allocation["total_account_value"])
    if total <= 0:
        return OmittedInsight(rule="largest_holding", reason="The priced account has no positive value.")
    holding = min(
        allocation["securities"], key=lambda row: (-Decimal(row["position_value"]), row["symbol"]),
    )
    weight = Decimal(holding["position_value"]) / total
    if weight < CONCENTRATION_THRESHOLD:
        return OmittedInsight(rule="largest_holding", reason="No holding meets the concentration threshold.")
    day = exposure.as_of.astimezone(NEW_YORK).date()
    evidence = _ratio("largest_holding_weight", weight, day, day)
    return Insight(
        rule="largest_holding",
        text=f"On {day}, {holding['symbol']} was the largest holding at {_percent(evidence)} of priced assets and cash.",
        evidence=[evidence],
    )


def _coverage_gap_v1(data: ReviewSnapshot, surface: Surface) -> Insight | OmittedInsight:
    review = data.review
    count = len(review.missing_sessions)
    expected = review.expected_sessions
    start, end = review.requested_start, review.requested_end
    subject = "The account had no value"
    if not count and surface == "portfolio" and review.start_used is not None and review.end_used is not None:
        start, end = review.start_used, review.end_used
        days = [point.session_date for point in review.points if start <= point.session_date <= end]
        expected = len(days)
        count = sum(day not in data.spy for day in days)
        subject = "The selected SPY series lacked a usable close"
    if not count:
        return OmittedInsight(rule="coverage_gap", reason="The requested sessions have no valuation gaps.")
    return Insight(
        rule="coverage_gap",
        text=f"{subject} on {count} of {expected} expected NYSE sessions from {start} to {end}.",
        evidence=[_count("missing_sessions", count, start, end), _count("expected_sessions", expected, start, end)],
    )


def _today_coverage(data: ReviewSnapshot) -> Coverage:
    review = data.review
    if review.end_used is not None and review.end_used != review.requested_end:
        return "stale"
    if len(data.values) < 2:
        return "missing"
    if review.missing_sessions or not data.recent_close_compatible:
        return "partial"
    return "available"


def build_insights(db: Session, user_id: int, email: str, surface: Surface, window: Window | None) -> PortfolioInsights:
    today = surface == "today"
    with consistent_read(db):
        data = review_in_snapshot(
            db, user_id, email, TODAY_WINDOW if today else window or "1m", check_recent_close=today,
        )
    rules = [_close_change_v1(data)] if today else [_spy_comparison_v1(data), _largest_holding_v1(data)]
    rules.append(_coverage_gap_v1(data, surface))
    return PortfolioInsights(
        surface=surface, read_at=data.review.read_at, coverage=_today_coverage(data) if today else data.review.coverage,
        items=[result for result in rules if isinstance(result, Insight)],
        omitted=[result for result in rules if isinstance(result, OmittedInsight)],
    )
