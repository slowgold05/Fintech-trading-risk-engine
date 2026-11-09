from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.research_job import ResearchJob
from app.models.research_report import ResearchReport
from app.services.research_llm import generate_synthesis
from app.services.research_tradingagents import generate_tradingagents_synthesis
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
        synthesis_fields = {
            "bull_case": None, "bear_case": None, "synthesis": None, "risks": None,
            "model_version": None, "prompt_version": None, "backend_detail": None,
        }
        if settings.research_synthesis_enabled:
            backend = settings.research_synthesis_backend
            try:
                if backend == "tradingagents":
                    synthesis_fields = generate_tradingagents_synthesis(
                        job.symbol, _now().date().isoformat()
                    )
                    source_type = "local_llm_tradingagents"
                    detail = f"synthesis generated via tradingagents ({settings.research_llm_model})"
                else:
                    synthesis_fields = generate_synthesis(job.symbol, sources)
                    synthesis_fields["backend_detail"] = None
                    job.prompt_tokens = synthesis_fields.pop("prompt_tokens", None)
                    job.completion_tokens = synthesis_fields.pop("completion_tokens", None)
                    job.duration_ms = synthesis_fields.pop("duration_ms", None)
                    source_type = "local_llm"
                    detail = f"synthesis generated via {settings.research_llm_model}"
                sources.append({"type": source_type, "status": "ok", "detail": detail})
            except Exception as exc:
                source_type = "local_llm_tradingagents" if backend == "tradingagents" else "local_llm"
                sources.append({"type": source_type, "status": "unavailable", "detail": exc.__class__.__name__})
        report = ResearchReport(
            job_id=job.id, user_id=job.user_id, symbol=job.symbol, sources=sources,
            **synthesis_fields,
        )
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
