from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import get_current_user
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult
from app.models.market_symbol import MarketSymbol
from app.models.user import User
from app.schemas.forecast_job import ForecastJobCreate
from app.services.market_history import SUPPORTED_ADJUSTMENTS

router = APIRouter(dependencies=[Depends(get_current_user)])

_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"
_INVALID_ADJUSTMENT = "adjustment_type must be raw or split_adjusted."
_TOO_MANY_JOBS = "Too many pending forecast jobs. Cancel one before creating another."
_NOT_QUEUED = "Forecast job is no longer queued."
_JOB_CAP = 5


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _iso_z(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _job_out(job: ForecastJob) -> dict:
    return {
        "id": job.id,
        "symbol": job.symbol,
        "provider": job.provider,
        "adjustment_type": job.adjustment_type,
        "lookback": job.lookback,
        "horizon": job.horizon,
        "sample_count": job.sample_count,
        "status": job.status,
        "created_at": _iso_z(job.created_at),
        "updated_at": _iso_z(job.updated_at),
        "error_message": job.error_message,
    }


@router.post("/jobs", status_code=201)
def create_forecast_job(
    payload: ForecastJobCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    known = db.execute(
        select(MarketSymbol.symbol).where(
            MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True)
        )
    ).first()
    if not known:
        raise HTTPException(status_code=400, detail=_UNKNOWN_SYMBOL)

    if payload.adjustment_type not in SUPPORTED_ADJUSTMENTS:
        raise HTTPException(status_code=422, detail=_INVALID_ADJUSTMENT)
    if payload.lookback > settings.forecast_kronos_max_lookback:
        raise HTTPException(
            status_code=422,
            detail=f"lookback must not exceed {settings.forecast_kronos_max_lookback}.",
        )
    if payload.horizon > settings.forecast_kronos_max_horizon:
        raise HTTPException(
            status_code=422,
            detail=f"horizon must not exceed {settings.forecast_kronos_max_horizon}.",
        )
    if payload.sample_count > settings.forecast_kronos_max_sample_count:
        raise HTTPException(
            status_code=422,
            detail=f"sample_count must not exceed {settings.forecast_kronos_max_sample_count}.",
        )

    pending = db.execute(
        select(func.count(ForecastJob.id)).where(
            ForecastJob.user_id == current_user.id,
            ForecastJob.status.in_(("queued", "running")),
        )
    ).scalar_one()
    if pending >= _JOB_CAP:
        raise HTTPException(status_code=409, detail=_TOO_MANY_JOBS)

    job = ForecastJob(
        user_id=current_user.id,
        symbol=payload.symbol,
        provider=payload.provider,
        adjustment_type=payload.adjustment_type,
        lookback=payload.lookback,
        horizon=payload.horizon,
        sample_count=payload.sample_count,
        status="queued",
    )
    db.add(job)
    db.commit()
    return _job_out(job)


@router.get("/jobs")
def list_forecast_jobs(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(ForecastJob)
        .where(ForecastJob.user_id == current_user.id)
        .order_by(ForecastJob.id.desc())
        .limit(limit)
    ).scalars().all()
    return {"jobs": [_job_out(job) for job in rows]}


@router.get("/jobs/{job_id}")
def get_forecast_job(
    job_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.execute(
        select(ForecastJob).where(
            ForecastJob.id == job_id, ForecastJob.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Forecast job not found")
    return _job_out(job)


@router.post("/jobs/{job_id}/cancel")
def cancel_forecast_job(
    job_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    found = db.execute(
        select(ForecastJob.id).where(
            ForecastJob.id == job_id, ForecastJob.user_id == current_user.id
        )
    ).one_or_none()
    if found is None:
        raise HTTPException(status_code=404, detail="Forecast job not found")
    job = db.execute(
        select(ForecastJob)
        .where(ForecastJob.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()
    if job.status != "queued":
        raise HTTPException(status_code=409, detail=_NOT_QUEUED)
    job.status = "cancelled"
    job.updated_at = _now()
    db.commit()
    return _job_out(job)


def _result_out(result: ForecastResult) -> dict:
    return {
        "id": result.id,
        "job_id": result.job_id,
        "symbol": result.symbol,
        "provider": result.provider,
        "adjustment_type": result.adjustment_type,
        "model_name": result.model_name,
        "tokenizer_name": result.tokenizer_name,
        "lookback": result.lookback,
        "horizon": result.horizon,
        "sample_count": result.sample_count,
        "input_cutoff": result.input_cutoff,
        "generated_at": _iso_z(result.generated_at),
        "bars": result.bars,
    }


@router.get("")
def list_forecast_results(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(ForecastResult)
        .where(ForecastResult.user_id == current_user.id)
        .order_by(ForecastResult.id.desc())
        .limit(limit)
    ).scalars().all()
    return {"results": [_result_out(result) for result in rows]}


@router.get("/{forecast_id}")
def get_forecast_result(
    forecast_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = db.execute(
        select(ForecastResult).where(
            ForecastResult.id == forecast_id, ForecastResult.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Forecast not found")
    return _result_out(result)
