from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult
from app.services.forecast_kronos import generate_forecast


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _parse_iso_z(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).replace(tzinfo=None)


def _claim_job(db: Session) -> ForecastJob | None:
    job = db.execute(
        select(ForecastJob)
        .where(ForecastJob.status == "queued")
        .order_by(ForecastJob.id.asc())
        .with_for_update()
        .limit(1)
    ).scalars().first()
    if job is None:
        return None
    job.status = "running"
    job.updated_at = _now()
    db.flush()
    return job


def process_one_job(db: Session) -> ForecastJob | None:
    job = _claim_job(db)
    if job is None:
        return None
    try:
        if not settings.forecast_kronos_enabled:
            raise RuntimeError("Kronos forecasting is disabled (forecast_kronos_enabled is false).")
        result = generate_forecast(
            db,
            symbol=job.symbol,
            provider=job.provider,
            adjustment_type=job.adjustment_type,
            lookback=job.lookback,
            horizon=job.horizon,
            sample_count=job.sample_count,
        )
        forecast_result = ForecastResult(
            job_id=job.id,
            user_id=job.user_id,
            symbol=result["symbol"],
            provider=result["provider"],
            adjustment_type=result["adjustment_type"],
            model_name=result["model_name"],
            tokenizer_name=result["tokenizer_name"],
            lookback=result["lookback"],
            horizon=result["horizon"],
            sample_count=result["sample_count"],
            input_cutoff=result["input_cutoff"],
            generated_at=_parse_iso_z(result["generated_at"]),
            bars=result["bars"],
        )
        db.add(forecast_result)
        job.status = "completed"
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)[:500]
    job.updated_at = _now()
    db.commit()
    return job


def process_pending_forecast_jobs(db: Session, max_jobs: int) -> list[ForecastJob]:
    processed = []
    for _ in range(max_jobs):
        job = process_one_job(db)
        if job is None:
            break
        processed.append(job)
    return processed
