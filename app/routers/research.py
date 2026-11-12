from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path, Query
import requests
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.market_symbol import MarketSymbol
from app.models.research_job import ResearchJob
from app.models.research_report import ResearchReport
from app.models.research_brief import ResearchBrief
from app.models.user import User
from app.schemas.research_job import ResearchJobCreate
from app.services.job_admission import admission_transaction, lock_owner
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


def _process_one_job_in_background() -> None:
    from app.core.database import SessionLocal
    from app.services.research_worker import process_pending_research_jobs

    db = SessionLocal()
    try:
        process_pending_research_jobs(db, max_jobs=1)
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()


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
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    owner_id = int(current_user.id)
    known = db.execute(
        select(MarketSymbol.symbol).where(
            MarketSymbol.symbol == payload.symbol, MarketSymbol.is_active.is_(True)
        )
    ).first()
    if not known:
        raise HTTPException(status_code=400, detail=_UNKNOWN_SYMBOL)

    with admission_transaction(db):
        lock_owner(db, owner_id)
        pending = db.execute(
            select(func.count(ResearchJob.id)).where(
                ResearchJob.user_id == owner_id,
                ResearchJob.status.in_(("queued", "running")),
            )
        ).scalar_one()
        if pending >= _JOB_CAP:
            raise HTTPException(status_code=409, detail=_TOO_MANY_JOBS)

        job = ResearchJob(user_id=owner_id, symbol=payload.symbol, status="queued")
        db.add(job)
        db.flush()
        background_tasks.add_task(_process_one_job_in_background)
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


def _report_out(report: ResearchReport) -> dict:
    return {
        "id": report.id,
        "job_id": report.job_id,
        "symbol": report.symbol,
        "created_at": _iso_z(report.created_at),
        "sources": report.sources,
        "bull_case": report.bull_case,
        "bear_case": report.bear_case,
        "synthesis": report.synthesis,
        "risks": report.risks,
        "model_version": report.model_version,
        "prompt_version": report.prompt_version,
        "backend_detail": report.backend_detail,
    }


@router.get("/reports")
def list_research_reports(
    limit: int = Query(default=50, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(ResearchReport)
        .where(ResearchReport.user_id == current_user.id)
        .order_by(ResearchReport.id.desc())
        .limit(limit)
    ).scalars().all()
    return {"reports": [_report_out(report) for report in rows]}


@router.get("/reports/{report_id}")
def get_research_report(
    report_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    report = db.execute(
        select(ResearchReport).where(
            ResearchReport.id == report_id, ResearchReport.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if report is None:
        raise HTTPException(status_code=404, detail="Research report not found")
    return _report_out(report)


def _brief_out(brief: ResearchBrief) -> dict:
    return {
        "id": brief.id,
        "brief_date": brief.brief_date.isoformat(),
        "created_at": _iso_z(brief.created_at),
        "entries": brief.entries,
    }


@router.get("/briefs")
def list_research_briefs(
    limit: int = Query(default=30, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = db.execute(
        select(ResearchBrief)
        .where(ResearchBrief.user_id == current_user.id)
        .order_by(ResearchBrief.brief_date.desc(), ResearchBrief.id.desc())
        .limit(limit)
    ).scalars().all()
    return {"briefs": [_brief_out(brief) for brief in rows]}


@router.get("/briefs/{brief_id}")
def get_research_brief(
    brief_id: int = Path(gt=0),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    brief = db.execute(
        select(ResearchBrief).where(
            ResearchBrief.id == brief_id, ResearchBrief.user_id == current_user.id
        )
    ).scalar_one_or_none()
    if brief is None:
        raise HTTPException(status_code=404, detail="Research brief not found")
    return _brief_out(brief)

