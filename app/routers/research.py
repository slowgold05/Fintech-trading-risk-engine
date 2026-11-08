from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Query
import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.user import User
from app.schemas.research_job import ResearchJobCreate
from app.services.sec_service import get_sec_company_filings

router = APIRouter(dependencies=[Depends(get_current_user)])


@router.get("/filings/{symbol}")
def research_filings(
    symbol: str,
    forms: str | None = Query(default=None),
    limit: int = Query(default=10, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Previews a company's recent SEC EDGAR filings. Does not write to the caller's own book."""
    form_list = [item.strip() for item in forms.split(",")] if forms else None
    try:
        return get_sec_company_filings(symbol, db, forms=form_list, limit=limit)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="SEC EDGAR is temporarily unavailable.")


_UNKNOWN_SYMBOL = "Unknown or inactive stock symbol"
_TOO_MANY_JOBS = "Too many pending research jobs. Cancel one before creating another."
_NOT_QUEUED = "Research job is no longer queued."
_JOB_CAP = 10


def _iso_z(value):
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _job_out(job: ResearchJob) -> dict:
    return {
        "id": job.id,
        "symbol": job.symbol,
        "status": job.status,
        "created_at": _iso_z(job.created_at),
        "updated_at": _iso_z(job.updated_at),
        "error_message": job.error_message,
    }


@router.post("/jobs", status_code=201)
def create_research_job(
    payload: ResearchJobCreate,
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

    pending = db.execute(
        select(func.count(ResearchJob.id)).where(
            ResearchJob.user_id == current_user.id,
            ResearchJob.status.in_(("queued", "running")),
        )
    ).scalar_one()
    if pending >= _JOB_CAP:
        raise HTTPException(status_code=409, detail=_TOO_MANY_JOBS)

    job = ResearchJob(user_id=current_user.id, symbol=payload.symbol, status="queued")
    db.add(job)
    db.commit()
    return _job_out(job)


@router.get("/jobs")
def list_research_jobs(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(ResearchJob)
        .where(ResearchJob.user_id == current_user.id)
        .order_by(ResearchJob.id.desc())
        .limit(limit)
    ).scalars().all()
    return {"jobs": [_job_out(job) for job in rows]}


@router.get("/jobs/{job_id}")
def get_research_job(
    job_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    job = db.execute(
        select(ResearchJob).where(
            ResearchJob.id == job_id, ResearchJob.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Research job not found")
    return _job_out(job)


@router.post("/jobs/{job_id}/cancel")
def cancel_research_job(
    job_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    found = db.execute(
        select(ResearchJob.id).where(
            ResearchJob.id == job_id, ResearchJob.user_id == current_user.id
        )
    ).one_or_none()
    if found is None:
        raise HTTPException(status_code=404, detail="Research job not found")
    job = db.execute(
        select(ResearchJob)
        .where(ResearchJob.id == job_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    ).scalar_one()
    if job.status != "queued":
        raise HTTPException(status_code=409, detail=_NOT_QUEUED)
    job.status = "cancelled"
    job.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return _job_out(job)

