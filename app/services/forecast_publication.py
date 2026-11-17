"""The only writer of a user-visible forecast result.

A result is stored only when the newest evaluation for the same symbol,
provider, and adjustment series has been approved by a reviewer. No
evaluation, or a newer one that is still pending, refuses the write. The app
role cannot set ``review_status``, so approval comes from outside the worker.
This module does not read or change ``forecast_kronos_enabled``.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.forecast_universe import require_featured_forecast_symbol
from app.models.forecast_evaluation import ForecastEvaluation
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult

APPROVED = "approved"
UNREVIEWED_PUBLICATION = "An unreviewed evaluation cannot reach a publish path."
UNEVALUATED_PUBLICATION = "A forecast without an approved evaluation cannot reach a publish path."
MISMATCHED_PUBLICATION = "The forecast does not match the job it was generated for."


class ForecastPublicationRejected(RuntimeError):
    """A forecast result was refused because no approved evaluation covers it."""


def latest_evaluation(
    db: Session, *, symbol: str, provider: str, adjustment_type: str,
) -> ForecastEvaluation | None:
    return db.execute(
        select(ForecastEvaluation)
        .where(
            ForecastEvaluation.symbol == symbol,
            ForecastEvaluation.provider == provider,
            ForecastEvaluation.adjustment_type == adjustment_type,
        )
        .order_by(ForecastEvaluation.id.desc())
        .limit(1)
    ).scalars().first()


def assert_forecast_publication_allowed(
    db: Session, *, symbol: str, provider: str, adjustment_type: str,
) -> None:
    symbol = require_featured_forecast_symbol(symbol)
    row = latest_evaluation(db, symbol=symbol, provider=provider, adjustment_type=adjustment_type)
    if row is None:
        raise ForecastPublicationRejected(UNEVALUATED_PUBLICATION)
    if row.review_status != APPROVED:
        raise ForecastPublicationRejected(UNREVIEWED_PUBLICATION)


def publish_forecast_result(db: Session, *, job: ForecastJob, payload: dict, generated_at) -> ForecastResult:
    """Store one forecast result. This is the publish path."""
    series = (payload["symbol"], payload["provider"], payload["adjustment_type"])
    if series != (job.symbol, job.provider, job.adjustment_type):
        raise ForecastPublicationRejected(MISMATCHED_PUBLICATION)
    assert_forecast_publication_allowed(
        db, symbol=job.symbol, provider=job.provider, adjustment_type=job.adjustment_type,
    )
    result = ForecastResult(
        job_id=job.id,
        user_id=job.user_id,
        symbol=payload["symbol"],
        provider=payload["provider"],
        adjustment_type=payload["adjustment_type"],
        model_name=payload["model_name"],
        tokenizer_name=payload["tokenizer_name"],
        lookback=payload["lookback"],
        horizon=payload["horizon"],
        sample_count=payload["sample_count"],
        input_cutoff=payload["input_cutoff"],
        generated_at=generated_at,
        bars=payload["bars"],
    )
    db.add(result)
    return result


def forecast_publish_paths():
    """Every function that can place a forecast on a user-visible surface."""
    return (publish_forecast_result,)
