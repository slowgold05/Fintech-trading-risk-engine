from collections.abc import Callable
from datetime import datetime, timedelta, timezone
import sys
import threading
from uuid import uuid4

from app.core.config import settings
from app.core.database import SessionLocal
from app.scripts.run_controls import app_control_results, persist_results
from app.services.control_evidence import backfill_missing_file_evidence
from app.services.market_cache_service import massive_key_is_set, refresh_quote_cache
from app.services.research_valuation import refresh_wanted_references
from app.services.aml_cases import run_live_aml
from app.services.research_briefs import build_daily_briefs
from app.services.research_worker import process_pending_research_jobs
from app.services.forecast_worker import process_pending_forecast_jobs
from app.services.scheduler_lock import acquire_scheduler, release_scheduler
from app.services.surveillance_cases import run_live_surveillance


def _log(message: str) -> None:
    print(f"scheduled-job {message}", file=sys.stderr, flush=True)


def refresh_market_caches(db) -> dict:
    summary = {}
    for tier, limit in (("hot", settings.scheduled_market_hot_limit), ("daily", settings.scheduled_market_daily_limit)):
        remaining = limit
        requested = 0
        refreshed = 0
        error_count = 0
        source = settings.market_quote_source
        # One grouped-daily call covers the tier when Massive is configured.
        # A missing key uses the Yahoo path, in batches of 50, and says so.
        one_batch = source == "massive" and massive_key_is_set()
        reported_source = source
        fallback_reason = None
        while remaining > 0:
            batch = remaining if one_batch else min(50, remaining)
            result = refresh_quote_cache(db, tier, batch, source=source)
            requested += result["requested"]
            refreshed += result["refreshed"]
            error_count += len(result["errors"])
            reported_source = result.get("source", source)
            if result.get("fallback_reason"):
                fallback_reason = result["fallback_reason"]
            if result["requested"] == 0 or result["refreshed"] == 0:
                break
            remaining -= result["requested"]
        summary[tier] = {
            "requested": requested,
            "refreshed": refreshed,
            "error_count": error_count,
            "source": reported_source,
        }
        if fallback_reason:
            summary[tier]["fallback_reason"] = fallback_reason
    return summary


def run_app_controls(db) -> list[dict]:
    return persist_results(db, app_control_results(db))


def run_scheduled_cycle() -> None:
    owner = f"{uuid4().hex}"
    with SessionLocal() as db:
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        stale_before = now - timedelta(hours=settings.scheduled_job_interval_hours)
        if not acquire_scheduler(db, owner, now, stale_before):
            _log("cycle skipped; another process holds the scheduler")
            return
        try:
            _run_scheduled_steps(db)
        finally:
            release_scheduler(db, owner)


def _run_scheduled_steps(db) -> None:
    try:
        refresh = refresh_market_caches(db)
    except Exception as exc:
        db.rollback()
        refresh = {"error": exc.__class__.__name__}
        _log(f"market refresh failed: {exc.__class__.__name__}")
    try:
        references = refresh_wanted_references(db)
    except Exception as exc:
        db.rollback()
        references = {"error": exc.__class__.__name__}
        _log(f"reference refresh failed: {exc.__class__.__name__}")
    try:
        results = run_app_controls(db)
    except Exception as exc:
        db.rollback()
        results = []
        _log(f"control run failed: {exc.__class__.__name__}")
    try:
        imported = backfill_missing_file_evidence(db)
    except Exception as exc:
        db.rollback()
        imported = []
        _log(f"evidence backfill failed: {exc.__class__.__name__}")
    try:
        surveillance = run_live_surveillance(db)
    except Exception as exc:
        db.rollback()
        surveillance = {"error": exc.__class__.__name__}
        _log(f"surveillance scan failed: {exc.__class__.__name__}")
    try:
        aml = run_live_aml(db)
    except Exception as exc:
        db.rollback()
        aml = {"error": exc.__class__.__name__}
        _log(f"aml scan failed: {exc.__class__.__name__}")
    try:
        research = process_pending_research_jobs(db, settings.scheduled_research_job_limit)
    except Exception as exc:
        db.rollback()
        research = {"error": exc.__class__.__name__}
        _log(f"research jobs failed: {exc.__class__.__name__}")
    try:
        briefs = build_daily_briefs(db, settings.scheduled_daily_brief_limit)
    except Exception as exc:
        db.rollback()
        briefs = {"error": exc.__class__.__name__}
        _log(f"daily briefs failed: {exc.__class__.__name__}")
    try:
        forecasts = process_pending_forecast_jobs(db, settings.scheduled_forecast_job_limit)
    except Exception as exc:
        db.rollback()
        forecasts = {"error": exc.__class__.__name__}
        _log(f"forecast jobs failed: {exc.__class__.__name__}")
    statuses = ",".join(f"{item['control_id']}={item['status']}" for item in results)
    _log(
        f"refresh={refresh} references={references} controls={statuses or 'none'} "
        f"imported={imported} surveillance={surveillance} aml={aml} research={research} "
        f"briefs={briefs} forecasts={forecasts}"
    )


def start_scheduled_jobs() -> Callable[[], None]:
    stop = threading.Event()

    def loop() -> None:
        if stop.wait(20):
            return
        while not stop.is_set():
            try:
                run_scheduled_cycle()
            except Exception as exc:
                _log(f"cycle failed: {exc.__class__.__name__}")
            if stop.wait(settings.scheduled_job_interval_hours * 3600):
                return

    threading.Thread(target=loop, name="scheduled-controls", daemon=True).start()
    return stop.set
