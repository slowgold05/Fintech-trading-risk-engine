"""Offline walk-forward evaluation for one cached featured symbol.

Queries ``MarketBarDaily``, scores ``app.services.forecast_evaluation``, and
writes one ``ForecastEvaluation`` row only when a real forecaster returns.
Tests and CI do not run this script. The row's review status stays pending.
This script does not enable ``forecast_kronos_enabled``, does not write a
``ForecastResult``, and does not schedule precompute.

Only the ``split_adjusted`` series is scored. A raw series steps at every
split, and that step would be scored as a forecast miss. The series must
hold every standard NYSE session between its first and last bar, or nothing
is scored and no row is written.

``_make_kronos_forecaster`` adapts ``generate_forecast`` to that callback.
Each window's ``as_of`` is the last observed session, so the model re-read
cannot include bars after the cutoff. Lookback is capped at
``settings.forecast_kronos_max_lookback``. A real run needs
``requirements-forecast.txt`` installed. Do not store a placeholder run as
if the weights had been exercised. Symbols outside the 12 featured stocks
are rejected before any row is written.
"""

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import func, select

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.forecast_universe import ForecastSymbolRejected, require_featured_forecast_symbol
from app.models.forecast_evaluation import ForecastEvaluation
from app.models.market_bar_daily import MarketBarDaily
from app.scripts.backfill_massive_history import OBSERVED_CLOSED_SESSIONS
from app.services.exchange_calendar import expected_session_dates
from app.services.forecast_evaluation import run_walk_forward_evaluation
from app.services.forecast_kronos import generate_forecast


_BASELINE_TYPE = "last_observed_close"
EVALUATION_ADJUSTMENT_TYPE = "split_adjusted"
EVALUATION_SAMPLE_COUNT = 1


class EvaluationCoverageError(ValueError):
    """The cached series is missing sessions inside its own span."""


def _session_text(value) -> str:
    if isinstance(value, str):
        return value
    return value.isoformat()


def _load_bars(db, *, symbol: str, provider: str, adjustment_type: str) -> list[dict]:
    """Full chronological history for one symbol, provider, and adjustment.

    The selected columns match ``_symbol_history``. Bars whose
    ``quality_status`` is not ``"valid"`` are dropped, the same exclusion
    that reader already applies. This script does not add a second rule.
    """
    rows = db.execute(
        select(
            MarketBarDaily.session_date,
            MarketBarDaily.open,
            MarketBarDaily.high,
            MarketBarDaily.low,
            MarketBarDaily.close,
            MarketBarDaily.volume,
            MarketBarDaily.quality_status,
        )
        .where(
            MarketBarDaily.symbol == symbol,
            MarketBarDaily.provider == provider,
            MarketBarDaily.adjustment_type == adjustment_type,
        )
        .order_by(MarketBarDaily.session_date.asc())
    )
    bars = []
    for row in rows:
        if row.quality_status != "valid":
            continue
        bars.append({
            "open": float(row.open),
            "high": float(row.high),
            "low": float(row.low),
            "close": float(row.close),
            "volume": float(row.volume),
            "session_date": _session_text(row.session_date),
        })
    return bars


def _require_complete_coverage(bars: list[dict]) -> None:
    """Every NYSE session from the first bar to the last must be present.

    A missing session shifts every later window and stretches a 10-session
    horizon over more calendar time than it claims. The one-off closures the
    backfill already recorded are not sessions.
    """
    if not bars:
        raise EvaluationCoverageError("no valid bars are cached for this series.")
    present = {bar["session_date"] for bar in bars}
    first = date.fromisoformat(bars[0]["session_date"])
    last = date.fromisoformat(bars[-1]["session_date"])
    missing = [
        day.isoformat() for day in expected_session_dates(first, last)
        if day.isoformat() not in present and day not in OBSERVED_CLOSED_SESSIONS
    ]
    if missing:
        shown = ", ".join(missing[:5])
        raise EvaluationCoverageError(
            f"{len(missing)} session(s) are missing between {first} and {last} (first: {shown})."
        )


def _require_current(db, bars: list[dict], *, symbol: str, provider: str) -> None:
    """The series must reach the newest session this provider has stored for the symbol.

    A backfill that is still running has no gap inside its span. It is only
    short, and scoring it would move every cutoff to an earlier date.
    """
    newest = db.execute(
        select(func.max(MarketBarDaily.session_date)).where(
            MarketBarDaily.symbol == symbol,
            MarketBarDaily.provider == provider,
        )
    ).scalar_one_or_none()
    if newest is not None and _session_text(newest) != bars[-1]["session_date"]:
        raise EvaluationCoverageError(
            f"the series ends {bars[-1]['session_date']}, but {provider} bars for "
            f"{symbol} are stored through {_session_text(newest)}."
        )


def _make_kronos_forecaster(db, symbol, provider, adjustment_type, seed=None):
    def forecaster(bars, horizon):
        lookback = min(len(bars), settings.forecast_kronos_max_lookback)
        as_of = date.fromisoformat(bars[-1]["session_date"])
        result = generate_forecast(
            db, symbol=symbol, provider=provider, adjustment_type=adjustment_type,
            lookback=lookback, horizon=horizon, sample_count=EVALUATION_SAMPLE_COUNT,
            seed=seed, as_of=as_of,
        )
        if result["input_cutoff"] != bars[-1]["session_date"]:
            raise ValueError(
                f"model input ended {result['input_cutoff']}, not the cutoff {bars[-1]['session_date']}."
            )
        return [bar["close"] for bar in result["bars"]]
    return forecaster


def _process_resources() -> dict:
    """CPU seconds and peak memory of this process, read from the operating system."""
    times = os.times()
    usage = {"cpu_user_s": times.user, "cpu_system_s": times.system, "peak_memory_bytes": None}
    if sys.platform == "win32":
        import ctypes
        from ctypes import wintypes

        class _Counters(ctypes.Structure):
            _fields_ = [
                ("cb", wintypes.DWORD),
                ("PageFaultCount", wintypes.DWORD),
                ("PeakWorkingSetSize", ctypes.c_size_t),
                ("WorkingSetSize", ctypes.c_size_t),
                ("QuotaPeakPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPagedPoolUsage", ctypes.c_size_t),
                ("QuotaPeakNonPagedPoolUsage", ctypes.c_size_t),
                ("QuotaNonPagedPoolUsage", ctypes.c_size_t),
                ("PagefileUsage", ctypes.c_size_t),
                ("PeakPagefileUsage", ctypes.c_size_t),
            ]

        kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel32.GetCurrentProcess.restype = wintypes.HANDLE
        kernel32.K32GetProcessMemoryInfo.argtypes = [
            wintypes.HANDLE, ctypes.POINTER(_Counters), wintypes.DWORD,
        ]
        kernel32.K32GetProcessMemoryInfo.restype = wintypes.BOOL
        counters = _Counters()
        counters.cb = ctypes.sizeof(_Counters)
        if kernel32.K32GetProcessMemoryInfo(kernel32.GetCurrentProcess(), ctypes.byref(counters), counters.cb):
            usage["peak_memory_bytes"] = int(counters.PeakWorkingSetSize)
            usage["peak_pagefile_bytes"] = int(counters.PeakPagefileUsage)
    else:
        import resource

        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        usage["peak_memory_bytes"] = int(peak if sys.platform == "darwin" else peak * 1024)
    return usage


def _library_versions() -> dict:
    from importlib import metadata

    versions = {"python": sys.version.split()[0]}
    for name in ("torch", "pandas", "numpy", "einops", "huggingface_hub", "safetensors"):
        try:
            versions[name] = metadata.version(name)
        except metadata.PackageNotFoundError:
            versions[name] = None
    return versions


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score a walk-forward forecast evaluation for one cached featured symbol."
    )
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--horizon", type=int, default=10)
    parser.add_argument("--window-count", type=int, default=5)
    parser.add_argument("--provider", default="massive")
    parser.add_argument("--adjustment-type", default=EVALUATION_ADJUSTMENT_TYPE)
    parser.add_argument("--seed", type=int, default=None, help="torch seed set before every window")
    parser.add_argument("--report-json", default=None, help="also write the full report to this file")
    args = parser.parse_args()
    if args.horizon < 1:
        parser.error("--horizon must be at least 1")
    if args.window_count < 1:
        parser.error("--window-count must be at least 1")
    try:
        symbol = require_featured_forecast_symbol(args.symbol)
    except ForecastSymbolRejected as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(2)
    if args.adjustment_type != EVALUATION_ADJUSTMENT_TYPE:
        print(
            f"Only the {EVALUATION_ADJUSTMENT_TYPE} series is evaluated; "
            f"{args.adjustment_type} was refused. No ForecastEvaluation row was written.",
            file=sys.stderr,
        )
        sys.exit(2)

    started = time.perf_counter()
    with SessionLocal() as db:
        bars = _load_bars(
            db,
            symbol=symbol,
            provider=args.provider,
            adjustment_type=args.adjustment_type,
        )
        try:
            _require_complete_coverage(bars)
            _require_current(db, bars, symbol=symbol, provider=args.provider)
        except EvaluationCoverageError as exc:
            print(
                f"{symbol} {args.provider} {args.adjustment_type}: {exc} "
                "No ForecastEvaluation row was written.",
                file=sys.stderr,
            )
            sys.exit(3)
        try:
            report = run_walk_forward_evaluation(
                bars,
                horizon=args.horizon,
                window_count=args.window_count,
                forecaster=_make_kronos_forecaster(
                    db, symbol, args.provider, args.adjustment_type, seed=args.seed,
                ),
            )
        except (RuntimeError, ValueError) as exc:
            print(
                f"The evaluation did not complete: {exc} "
                "A real evaluation requires the optional forecast dependencies "
                "(requirements-forecast.txt). forecast_kronos_enabled was not "
                "turned on. No ForecastEvaluation row was written.",
                file=sys.stderr,
            )
            sys.exit(1)

        elapsed = time.perf_counter() - started
        # review_status is omitted on purpose. Its server default is pending,
        # and the app role is not granted INSERT on that column.
        row = ForecastEvaluation(
            symbol=symbol,
            provider=args.provider,
            adjustment_type=args.adjustment_type,
            horizon=report["horizon"],
            window_count=report["window_count"],
            model_mae=report["model_mae"],
            model_directional_accuracy=report["model_directional_accuracy"],
            baseline_type=_BASELINE_TYPE,
            baseline_mae=report["baseline_mae"],
            baseline_directional_accuracy=report["baseline_directional_accuracy"],
            weights_exercised=True,
            notes=(
                "Model-owner review: PENDING (user). "
                "Walk-forward result only. Not a published forecast."
            ),
        )
        db.add(row)
        db.commit()
        resources = _process_resources()
        print(
            f"model={settings.forecast_kronos_model_name} "
            f"tokenizer={settings.forecast_kronos_tokenizer_name} "
            f"bars={len(bars)} first={bars[0]['session_date']} last={bars[-1]['session_date']} "
            f"seed={args.seed} sample_count={EVALUATION_SAMPLE_COUNT} elapsed_s={elapsed:.3f} "
            f"cpu_user_s={resources['cpu_user_s']:.3f} cpu_system_s={resources['cpu_system_s']:.3f} "
            f"peak_memory_bytes={resources['peak_memory_bytes']}"
        )
        for window in report["windows"]:
            print(
                "window "
                f"cutoff={window['cutoff_date']} "
                f"reference_close={window['reference_close']:.6f} "
                f"model_mae={window['model_mae']:.6f} "
                f"model_dir={window['model_directional_accuracy']:.6f} "
                f"baseline_mae={window['baseline_mae']:.6f} "
                f"baseline_dir={window['baseline_directional_accuracy']:.6f}"
            )
        print(
            f"Wrote forecast evaluation {row.id} for {row.symbol}: "
            f"model_mae={row.model_mae} baseline_mae={row.baseline_mae} "
            f"model_dir={row.model_directional_accuracy} "
            f"baseline_dir={row.baseline_directional_accuracy} "
            f"weights_exercised={row.weights_exercised} "
            f"review_status={row.review_status}"
        )
        if args.report_json:
            Path(args.report_json).write_text(json.dumps({
                "evaluation_id": row.id,
                "symbol": row.symbol,
                "provider": row.provider,
                "adjustment_type": row.adjustment_type,
                "review_status": row.review_status,
                "baseline_type": _BASELINE_TYPE,
                "model_name": settings.forecast_kronos_model_name,
                "tokenizer_name": settings.forecast_kronos_tokenizer_name,
                "forecast_kronos_enabled": settings.forecast_kronos_enabled,
                "seed": args.seed,
                "sample_count": EVALUATION_SAMPLE_COUNT,
                "max_lookback": settings.forecast_kronos_max_lookback,
                "bar_count": len(bars),
                "first_session": bars[0]["session_date"],
                "last_session": bars[-1]["session_date"],
                "elapsed_s": elapsed,
                "resources": resources,
                "versions": _library_versions(),
                "report": report,
            }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
