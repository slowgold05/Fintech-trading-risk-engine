"""Backfill Massive grouped-daily bars for the S&P 500 and index ETFs.

One grouped request covers every US stock for a session. The client paces at
the free-plan limit. Each session is committed on its own, and a later run
skips dates that already have stored bars for the requested symbols.

Reads MASSIVE_API_KEY and DATABASE_URL from the environment. Prints counts
and a few sample bars. Does not print the key.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from datetime import date, datetime, timezone
from pathlib import Path

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.services.exchange_calendar import expected_session_dates
from app.services.market_history import two_calendar_years_before
from app.services.market_providers import ProviderUnavailable
from app.services.massive_ingestion import backfill_two_years, ingest_one_day, nyse_calendar_today
from app.services.sp500_constituents import load_sp500_constituents

# Same ETF proxies the market overview uses for the major indexes.
INDEX_ETFS = (
    ("SPY", "S&P 500 proxy"),
    ("QQQ", "Nasdaq 100 proxy"),
    ("DIA", "Dow Jones proxy"),
    ("IWM", "Russell 2000 proxy"),
)
_SAMPLE_SYMBOLS = ("AAPL", "MSFT", "SPY", "QQQ", "DIA", "IWM", "BRK.B", "BF.B")
DEFAULT_STATUS_FILENAME = "massive-backfill-status.json"
CLOSED_SESSIONS_FILENAME = "massive-backfill-closed-sessions.json"
# 2025-01-09: the local grouped call stored no bars for all 507 symbols.
# NYSE was closed that day, and the date is strictly before the latest
# finished session, so a rerun records it as skipped and does not request it
# again. An empty file for the latest finished session, or a newer date, is
# not written here: those bars may not be published yet.
OBSERVED_CLOSED_SESSIONS = (date(2025, 1, 9),)


def universe() -> list[tuple[str, str, bool]]:
    rows: list[tuple[str, str, bool]] = []
    seen: set[str] = set()
    for row in load_sp500_constituents():
        symbol = str(row["ticker"]).strip().upper()
        if not symbol or symbol in seen:
            continue
        seen.add(symbol)
        name = str(row.get("security") or symbol).strip() or symbol
        rows.append((symbol, name, False))
    for symbol, name in INDEX_ETFS:
        if symbol not in seen:
            seen.add(symbol)
            rows.append((symbol, name, True))
    return rows


def ensure_symbols(db, rows: list[tuple[str, str, bool]]) -> int:
    wanted = [symbol for symbol, _name, _is_etf in rows]
    existing = {
        symbol
        for (symbol,) in db.query(MarketSymbol.symbol).filter(MarketSymbol.symbol.in_(wanted))
    }
    added = 0
    for symbol, name, is_etf in rows:
        if symbol in existing:
            continue
        db.add(MarketSymbol(
            symbol=symbol,
            company_name=name[:255],
            exchange="US",
            is_etf=is_etf,
            is_test=False,
            is_active=True,
            refresh_tier="daily",
            heatmap_size="small" if is_etf else "micro",
            source="sp500_constituents",
        ))
        added += 1
    if added:
        db.commit()
    return added


def _quality(db, day: date, symbols: list[str], report: dict) -> dict:
    rows = (
        db.query(MarketBarDaily)
        .filter(
            MarketBarDaily.session_date == day,
            MarketBarDaily.provider == "massive",
            MarketBarDaily.adjustment_type == "raw",
            MarketBarDaily.symbol.in_(symbols),
        )
        .all()
    )
    problems = []
    closes = []
    samples = {}
    for row in rows:
        close = row.close
        closes.append(close)
        if not (row.low <= row.open <= row.high and row.low <= row.close <= row.high):
            problems.append(row.symbol)
        elif close is None or close <= 0 or row.volume < 0:
            problems.append(row.symbol)
        if row.symbol in _SAMPLE_SYMBOLS:
            samples[row.symbol] = {
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": int(row.volume),
                "quality": row.quality_status,
            }
    missing = list(report.get("missing") or [])
    return {
        "day": day.isoformat(),
        "requested": len(symbols),
        "rows": len(rows),
        "valid": sum(1 for row in rows if row.quality_status == "valid"),
        "flagged": sum(1 for row in rows if row.quality_status == "flagged"),
        "rejected": list(report.get("rejected") or []),
        "missing_count": len(missing),
        "missing_sample": missing[:20],
        "ohlc_problems": problems,
        "close_min": float(min(closes)) if closes else None,
        "close_max": float(max(closes)) if closes else None,
        "samples": samples,
        "error": report.get("error", ""),
    }


def closed_sessions_path() -> Path:
    return Path(tempfile.gettempdir()) / CLOSED_SESSIONS_FILENAME


def load_closed_sessions() -> set[date]:
    found = set(OBSERVED_CLOSED_SESSIONS)
    path = closed_sessions_path()
    if not path.exists():
        return found
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, TypeError):
        return found
    if not isinstance(raw, list):
        return found
    for item in raw:
        try:
            found.add(date.fromisoformat(str(item)))
        except ValueError:
            continue
    return found


def save_closed_sessions(days: set[date]) -> None:
    payload = sorted(day.isoformat() for day in days)
    try:
        closed_sessions_path().write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:
        print(f"closed-session file was not written: {exc.__class__.__name__}", file=sys.stderr, flush=True)


def _write_status(path: Path, payload: dict) -> None:
    try:
        path.write_text(json.dumps(payload), encoding="utf-8")
    except OSError as exc:
        print(f"status file was not written: {exc.__class__.__name__}", file=sys.stderr, flush=True)


def _compact(report: dict) -> dict:
    gaps = report["symbols_with_gaps"]
    examples = {}
    for symbol, days in list(gaps.items())[:10]:
        examples[symbol] = days[:5]
    return {
        "sessions_attempted": report["sessions_attempted"],
        "sessions_with_data": report["sessions_with_data"],
        "sessions_skipped": report["sessions_skipped"],
        "sessions_not_yet_available": report["sessions_not_yet_available"],
        "sessions_failed": report["sessions_failed"],
        "symbols_fully_covered": len(report["symbols_fully_covered"]),
        "symbols_with_gaps": len(gaps),
        "gap_examples": examples,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill Massive daily bars for the S&P 500 and index ETFs.")
    parser.add_argument("--day", help="Ingest one session date (YYYY-MM-DD) instead of the two-year window.")
    parser.add_argument(
        "--status-file",
        default=str(Path(tempfile.gettempdir()) / DEFAULT_STATUS_FILENAME),
        help="Progress JSON path. Updated after each session.",
    )
    args = parser.parse_args()
    if not settings.massive_api_key:
        print("MASSIVE_API_KEY is empty.", file=sys.stderr)
        raise SystemExit(2)

    rows = universe()
    symbols = [symbol for symbol, _name, _is_etf in rows]
    status_path = Path(args.status_file)
    db = SessionLocal()
    try:
        added = ensure_symbols(db, rows)
        print(f"symbols={len(symbols)} inserted_missing={added}", flush=True)
        if args.day:
            day = date.fromisoformat(args.day)
            as_of = nyse_calendar_today()
            report = ingest_one_day(db, day, symbols, settings.massive_api_key, today=as_of)
            reason = report.get("skip_reason")
            if reason in {"market_closed", "not_yet_available"}:
                db.rollback()
                if reason == "market_closed":
                    closed = load_closed_sessions()
                    closed.add(day)
                    save_closed_sessions(closed)
                print(json.dumps({"day": day.isoformat(), "skipped": True, "skip_reason": reason}), flush=True)
                _write_status(status_path, {
                    "state": "done",
                    "mode": "day",
                    "skipped": True,
                    "skip_reason": reason,
                    "day": day.isoformat(),
                })
                return
            db.commit()
            summary = _quality(db, day, symbols, report)
            print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
            _write_status(status_path, {"state": "done", "mode": "day", **summary})
            if summary["ohlc_problems"] or summary["rows"] == 0:
                raise SystemExit(1)
            return

        end = nyse_calendar_today()
        sessions = expected_session_dates(two_calendar_years_before(end), end)
        state = {"done": 0, "failed": 0, "skipped": 0}
        closed = load_closed_sessions()

        def on_day(report: dict) -> None:
            state["done"] += 1
            if report.get("error"):
                state["failed"] += 1
            if report.get("skipped"):
                state["skipped"] += 1
            if report.get("skip_reason") == "market_closed":
                closed.add(date.fromisoformat(report["day"]))
                save_closed_sessions(closed)
            _write_status(status_path, {
                "state": "running",
                "last_day": report["day"],
                "sessions_done": state["done"],
                "sessions_planned": len(sessions),
                "failed": state["failed"],
                "skipped": state["skipped"],
                "skip_reason": report.get("skip_reason", ""),
                "error": report.get("error", ""),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
            print(
                f"{report['day']} valid={report['written_valid']} flagged={report['written_flagged']} "
                f"missing={len(report['missing'])} skipped={bool(report.get('skipped'))} "
                f"reason={report.get('skip_reason') or ''} failed={bool(report.get('error'))}",
                flush=True,
            )

        _write_status(status_path, {
            "state": "running",
            "sessions_done": 0,
            "sessions_planned": len(sessions),
            "failed": 0,
            "skipped": 0,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        report = backfill_two_years(
            db,
            symbols,
            settings.massive_api_key,
            today=end,
            commit_each=True,
            on_day=on_day,
            closed_dates=closed,
        )
        summary = _compact(report)
        print(json.dumps(summary, indent=2, sort_keys=True), flush=True)
        _write_status(status_path, {"state": "done", "mode": "two_years", **summary})
    except (ProviderUnavailable, ValueError) as exc:
        db.rollback()
        message = str(exc)
        if "apiKey" in message or "api_key" in message.lower():
            message = exc.__class__.__name__
        print(message, file=sys.stderr)
        _write_status(status_path, {"state": "failed", "error": message[:180]})
        raise SystemExit(1) from exc
    except Exception as exc:
        db.rollback()
        _write_status(status_path, {"state": "failed", "error": exc.__class__.__name__})
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
