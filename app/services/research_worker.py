from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.research_job import ResearchJob
from app.models.research_report import ResearchReport
from app.services.sec_service import get_sec_company_filings, get_sec_company_fundamentals


def _now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _claim_job(db: Session) -> ResearchJob | None:
    job = db.execute(
        select(ResearchJob)
        .where(ResearchJob.status == "queued")
        .order_by(ResearchJob.id.asc())
        .with_for_update()
        .limit(1)
    ).scalars().first()
    if job is None:
        return None
    job.status = "running"
    job.updated_at = _now()
    db.flush()
    return job


def _gather_sources(db: Session, symbol: str) -> list[dict]:
    sources = []
    try:
        fundamentals = get_sec_company_fundamentals(symbol, db)
        sources.append({
            "type": "sec_fundamentals",
            "status": "ok",
            "detail": fundamentals.get("name") or symbol,
        })
    except Exception as exc:
        sources.append({"type": "sec_fundamentals", "status": "unavailable", "detail": exc.__class__.__name__})
    try:
        filings = get_sec_company_filings(symbol, db, limit=5)
        sources.append({
            "type": "sec_filings",
            "status": "ok",
            "detail": f"{len(filings['filings'])} recent filings",
        })
    except Exception as exc:
        sources.append({"type": "sec_filings", "status": "unavailable", "detail": exc.__class__.__name__})
    return sources


def process_one_job(db: Session) -> ResearchJob | None:
    job = _claim_job(db)
    if job is None:
        return None
    try:
        sources = _gather_sources(db, job.symbol)
        report = ResearchReport(job_id=job.id, user_id=job.user_id, symbol=job.symbol, sources=sources)
        db.add(report)
        job.status = "completed"
    except Exception as exc:
        job.status = "failed"
        job.error_message = str(exc)[:500]
    job.updated_at = _now()
    db.commit()
    return job


def process_pending_research_jobs(db: Session, max_jobs: int) -> list[ResearchJob]:
    processed = []
    for _ in range(max_jobs):
        job = process_one_job(db)
        if job is None:
            break
        processed.append(job)
    return processed
