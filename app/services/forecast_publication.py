"""The only writer of a user-visible forecast result.

An evaluation whose review is still pending cannot pass. Absence of an
evaluation does not approve anything; it leaves the existing worker path
unchanged until a row exists. ``FORECAST_KRONOS_ENABLED`` stays off here.
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.forecast_evaluation import ForecastEvaluation
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult

UNREVIEWED_PUBLICATION = "An unreviewed evaluation cannot reach a publish path."


class ForecastPublicationRejected(RuntimeError):
    """A forecast result was refused because the latest evaluation is unreviewed."""


def latest_evaluation(db: Session, symbol: str) -> ForecastEvaluation | None:
    return db.execute(
        select(ForecastEvaluation)
        .where(ForecastEvaluation.symbol == symbol)
        .order_by(ForecastEvaluation.id.desc())
        .limit(1)
    ).scalars().first()


def evaluation_is_reviewed(evaluation: ForecastEvaluation | None) -> bool:
    return evaluation is not None and evaluation.review_status == "approved"


def assert_forecast_publication_allowed(db: Session, *, symbol: str) -> None:
    row = latest_evaluation(db, symbol)
    if row is not None and not evaluation_is_reviewed(row):
        raise ForecastPublicationRejected(UNREVIEWED_PUBLICATION)


def publish_forecast_result(db: Session, *, job: ForecastJob, payload: dict, generated_at) -> ForecastResult:
    """Store one forecast result. This is the publish path."""
    assert_forecast_publication_allowed(db, symbol=str(job.symbol))
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
