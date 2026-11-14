"""Offline walk-forward evaluation for one cached symbol.

Queries ``MarketBarDaily``, scores ``app.services.forecast_evaluation``, and
writes one ``ForecastEvaluation`` row only when a real forecaster returns.
Tests and CI do not run this script.

``_make_kronos_forecaster`` adapts ``generate_forecast`` to that callback.
Each window's ``as_of`` is the last observed session, so the model re-read
cannot include bars after the cutoff. Lookback is capped at
``settings.forecast_kronos_max_lookback``. A real run still needs
``requirements-forecast.txt`` installed and ``forecast_kronos_enabled`` on.
Do not store a placeholder run as if the weights had been exercised.
"""

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models.forecast_evaluation import ForecastEvaluation
from app.models.market_bar_daily import MarketBarDaily
from app.services.forecast_evaluation import run_walk_forward_evaluation
from app.services.forecast_kronos import generate_forecast


_BASELINE_TYPE = "last_observed_close"


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


def _make_kronos_forecaster(db, symbol, provider, adjustment_type):
    def forecaster(bars, horizon):
        lookback = min(len(bars), settings.forecast_kronos_max_lookback)
        as_of = date.fromisoformat(bars[-1]["session_date"])
        result = generate_forecast(
            db, symbol=symbol, provider=provider, adjustment_type=adjustment_type,
            lookback=lookback, horizon=horizon, sample_count=1, as_of=as_of,
        )
        return [bar["close"] for bar in result["bars"]]
    return forecaster


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Score a walk-forward forecast evaluation for one cached symbol."
    )
    parser.add_argument("--symbol", required=True)
    parser.add_argument("--horizon", type=int, default=10)
    parser.add_argument("--window-count", type=int, default=5)
    parser.add_argument("--provider", default="yahoo")
    parser.add_argument("--adjustment-type", default="raw")
    args = parser.parse_args()
    if args.horizon < 1:
        parser.error("--horizon must be at least 1")
    if args.window_count < 1:
        parser.error("--window-count must be at least 1")

    with SessionLocal() as db:
        bars = _load_bars(
            db,
            symbol=args.symbol,
            provider=args.provider,
            adjustment_type=args.adjustment_type,
        )
        try:
            report = run_walk_forward_evaluation(
                bars,
                horizon=args.horizon,
                window_count=args.window_count,
                forecaster=_make_kronos_forecaster(
                    db, args.symbol, args.provider, args.adjustment_type,
                ),
            )
        except RuntimeError:
            print(
                "A real evaluation requires the optional forecast dependencies "
                "(requirements-forecast.txt) with forecast_kronos_enabled on. "
                "No ForecastEvaluation row was written.",
                file=sys.stderr,
            )
            sys.exit(1)

        row = ForecastEvaluation(
            symbol=args.symbol,
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
            notes=None,
        )
        db.add(row)
        db.commit()
        print(
            f"Wrote forecast evaluation {row.id} for {row.symbol}: "
            f"model_mae={row.model_mae} baseline_mae={row.baseline_mae} "
            f"weights_exercised={row.weights_exercised}"
        )


if __name__ == "__main__":
    main()
