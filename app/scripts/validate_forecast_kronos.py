"""Write the Kronos model card, report, and inventory row.

The checks use a synthetic bar fixture and a fake predictor. This script does
not download weights, does not call the real model, and does not set approval.
There is no accuracy threshold: nothing here is a hit rate.
"""

import json
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.core.config import settings
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.forecast_kronos import _next_trading_sessions, generate_forecast
from app.services.model_inventory import merge_models
import app.services.forecast_kronos as forecast_kronos


REPORT = ROOT / "grc" / "models" / "reports" / "SM-FC-02.md"
CARD = ROOT / "grc" / "models" / "cards" / "SM-FC-02.md"
MODEL_ID = "SM-FC-02"
SOURCE_COMMIT = "67b630e67f6a18c9e9be918d9b4337c960db1e9a"

REFERENCE_VECTORS = (
    (date(2026, 11, 6), 3, (date(2026, 11, 9), date(2026, 11, 10), date(2026, 11, 11))),
    (date(2026, 11, 25), 3, (date(2026, 11, 27), date(2026, 11, 30), date(2026, 12, 1))),
)


def _trading_days_ending(last: date, count: int) -> list[date]:
    found: list[date] = []
    day = last
    while len(found) < count:
        if is_nyse_trading_day(day):
            found.append(day)
        day -= timedelta(days=1)
    found.reverse()
    return found


def _bars(sessions: list[date]) -> list[dict]:
    bars = []
    for index, session in enumerate(sessions):
        bars.append({
            "session_date": session.isoformat(),
            "open": f"{100 + index}.25",
            "high": f"{101 + index}.25",
            "low": f"{99 + index}.25",
            "close": f"{100 + index}.50",
            "volume": str(1000 + index),
        })
    return bars


def _as_dates(series) -> list[date]:
    values = []
    for item in list(series):
        if isinstance(item, datetime):
            values.append(item.date())
        else:
            values.append(item)
    return values


class _History:
    def __init__(self, bars: list[dict] | None = None, *, forbid: bool = False):
        self.bars = bars or []
        self.forbid = forbid
        self.calls = 0

    def __call__(self, db, *, symbol, interval, range_token, provider, adjustment_type):
        self.calls += 1
        if self.forbid:
            raise RuntimeError("read_symbol_history is not part of the bounds check")
        return {"bars": self.bars}


def _rejected(call, text: str) -> bool:
    try:
        call()
    except ValueError as exc:
        return text in str(exc).lower()
    except Exception:
        return False
    return False


def _request(**overrides):
    payload = {
        "symbol": "AAPL",
        "provider": "yahoo",
        "adjustment_type": "raw",
        "lookback": 1,
        "horizon": 1,
        "sample_count": 1,
    }
    payload.update(overrides)
    return generate_forecast(None, **payload)


def _bounds_rejection(field: str, **overrides) -> bool:
    history = _History(forbid=True)
    forecast_kronos.read_symbol_history = history
    rejected = _rejected(lambda: _request(**overrides), field)
    return rejected and history.calls == 0


def run_checks() -> dict:
    """Exercise guards and output shape. Does not load Kronos weights."""
    original_read = forecast_kronos.read_symbol_history
    original_load = forecast_kronos._load_predictor
    try:
        lookback_rejected = _bounds_rejection(
            "lookback", lookback=settings.forecast_kronos_max_lookback + 1,
        )
        horizon_rejected = _bounds_rejection(
            "horizon", horizon=settings.forecast_kronos_max_horizon + 1,
        )
        sample_count_rejected = _bounds_rejection(
            "sample_count", sample_count=settings.forecast_kronos_max_sample_count + 1,
        )

        short = _bars(_trading_days_ending(date(2026, 11, 6), 2))
        short_history = _History(short)
        forecast_kronos.read_symbol_history = short_history
        insufficient_rejected = (
            _rejected(lambda: _request(lookback=5), "insufficient") and short_history.calls == 1
        )

        reference_matched = all(
            tuple(_next_trading_sessions(start, count)) == expected
            for start, count, expected in REFERENCE_VECTORS
        )

        fixture_count = 8
        lookback = 3
        horizon = 3
        sample_count = 2
        fixture = _bars(_trading_days_ending(date(2026, 11, 6), fixture_count))
        window = fixture[-lookback:]

        class _FakePredictor:
            def __init__(self):
                self.kwargs = None

            def predict(self, **kwargs):
                self.kwargs = kwargs
                import pandas as pd

                count = kwargs["pred_len"]
                return pd.DataFrame({
                    "open": [10.0 + index for index in range(count)],
                    "high": [11.0 + index for index in range(count)],
                    "low": [9.0 + index for index in range(count)],
                    "close": [10.5 + index for index in range(count)],
                    "volume": [100.0 + index for index in range(count)],
                })

        fake = _FakePredictor()
        forecast_kronos.read_symbol_history = _History(fixture)
        forecast_kronos._load_predictor = lambda: fake
        result = _request(lookback=lookback, horizon=horizon, sample_count=sample_count)
        expected_x = [date.fromisoformat(bar["session_date"]) for bar in window]
        expected_y = _next_trading_sessions(expected_x[-1], horizon)
        output_dates = [bar["session_date"] for bar in result["bars"]]
        output_shape_matched = (
            fake.kwargs is not None
            and len(fake.kwargs["df"]) == lookback
            and float(fake.kwargs["df"].iloc[0]["open"]) == float(window[0]["open"])
            and _as_dates(fake.kwargs["x_timestamp"]) == expected_x
            and _as_dates(fake.kwargs["y_timestamp"]) == expected_y
            and fake.kwargs["pred_len"] == horizon
            and fake.kwargs["sample_count"] == sample_count
            and fake.kwargs["verbose"] is False
            and result["input_cutoff"] == window[-1]["session_date"]
            and len(result["bars"]) == horizon
            and output_dates == [day.isoformat() for day in expected_y]
            and fixture[0]["session_date"] != window[0]["session_date"]
        )
        return {
            "lookback_over_max_rejected": lookback_rejected,
            "horizon_over_max_rejected": horizon_rejected,
            "sample_count_over_max_rejected": sample_count_rejected,
            "insufficient_history_rejected": insufficient_rejected,
            "reference_vectors_matched": reference_matched,
            "output_shape_matched": output_shape_matched,
            "fixture_sessions": fixture_count,
            "lookback": lookback,
            "horizon": horizon,
            "sample_count": sample_count,
            "input_cutoff": result["input_cutoff"],
            "window_start": window[0]["session_date"],
            "future_sessions": output_dates,
            "weights_exercised": False,
            "accuracy_evaluated": False,
        }
    finally:
        forecast_kronos.read_symbol_history = original_read
        forecast_kronos._load_predictor = original_load


def _flag(value: bool) -> str:
    return "yes" if value else "no"


def write_reports() -> dict:
    checks = run_checks()
    future = ", ".join(checks["future_sessions"])
    report = [
        f"# {MODEL_ID} validation report",
        "",
        "**Model:** Kronos bounded daily forecast version 1",
        "**Type:** foundation_timeseries",
        "**Owner:** Market Risk (pending confirmation)",
        "**Status:** Draft. Pending model owner review. This report is not an activation.",
        "",
        "## Principle",
        "",
        "The check follows the SR 11-7 idea that a model is inventoried and validated before a risk rule uses it. "
        "The checks below come from a synthetic cached-bar fixture exercised through `app.services.forecast_kronos`. "
        "They cover bounds rejection, point-in-time windowing, and output shape. "
        "They are not a hit rate, and they are not an accuracy number. No walk-forward evaluation has been performed.",
        "",
        "## Bounds rejection",
        "",
        "Each over-limit call must raise `ValueError` before `read_symbol_history` runs. "
        f"Configured maxima are lookback {settings.forecast_kronos_max_lookback}, "
        f"horizon {settings.forecast_kronos_max_horizon}, "
        f"and sample count {settings.forecast_kronos_max_sample_count}.",
        "",
        f"- Lookback over the max rejected before a history read: {_flag(checks['lookback_over_max_rejected'])}",
        f"- Horizon over the max rejected before a history read: {_flag(checks['horizon_over_max_rejected'])}",
        f"- Sample count over the max rejected before a history read: {_flag(checks['sample_count_over_max_rejected'])}",
        f"- Fewer cached sessions than the requested lookback rejected: {_flag(checks['insufficient_history_rejected'])}",
        "",
        "## Point-in-time window",
        "",
        "Future dates come from `exchange_calendar.is_nyse_trading_day`, walked one calendar day at a time. "
        "The two reference vectors below were checked by calling that function, not by assuming a calendar.",
        "",
        f"- Reference vectors matched: {_flag(checks['reference_vectors_matched'])}",
        "- `2026-11-06` plus 3 sessions: 2026-11-09, 2026-11-10, 2026-11-11.",
        "- `2026-11-25` plus 3 sessions: 2026-11-27, 2026-11-30, 2026-12-01. Thanksgiving, 2026-11-26, is skipped.",
        f"- Fixture length: {checks['fixture_sessions']} synthetic sessions ending 2026-11-06.",
        f"- Requested lookback: {checks['lookback']}. The predictor received the tail, starting {checks['window_start']}.",
        f"- Input cutoff: {checks['input_cutoff']}.",
        f"- Future sessions passed as `y_timestamp` and returned on the bars: {future}.",
        "",
        "## Output shape",
        "",
        "A fake predictor returned one row per requested session. Real weights were not downloaded and `predict` on the vendored model was not called.",
        "",
        f"- Output shape matched the requested horizon: {_flag(checks['output_shape_matched'])}",
        f"- Horizon: {checks['horizon']}",
        f"- Sample count forwarded to the fake predictor: {checks['sample_count']}",
        "- The returned object is one path. `sample_count` is the count Kronos would average internally. This check does not produce several scenario paths.",
        "",
        "## Limitations",
        "",
        "- The fixture is synthetic cached-bar text. It is not a market history.",
        "- No walk-forward accuracy evaluation has been performed.",
        "- Real Kronos weights were not downloaded or exercised. This is shape and guard validation only.",
        "- Nothing in this report is a hit rate or an accuracy number.",
        "- The advisory output cannot change a hard limit or place an order.",
        "",
        "**Approval:** Pending model owner review.",
        "",
    ]
    card = [
        f"# {MODEL_ID} model card",
        "",
        "**Status:** Draft. Pending model owner review.",
        "",
        "## Purpose",
        "",
        "Produce one bounded path of future daily bars from the most recent cached sessions for a symbol. The output is not an approved signal and cannot feed a risk rule.",
        "",
        "## Data",
        "",
        "Price input is the cached daily window from `read_symbol_history` (`interval` `1d`, `range` `2y`). "
        "No live vendor call is made for prices. "
        f"The vendored Kronos source is commit `{SOURCE_COMMIT}`. "
        f"Weight repository names are pinned in settings as `{settings.forecast_kronos_model_name}` and `{settings.forecast_kronos_tokenizer_name}`. "
        "This card was produced from a synthetic fixture. No Hugging Face Hub request was made, and real weights were not exercised.",
        "",
        "## Version",
        "",
        "Version 1. The implementation is `app.services.forecast_kronos`. There is no weight file in this validation.",
        "",
        "## Owner",
        "",
        "Market Risk, pending confirmation. Approval is pending model owner review.",
        "",
        "## Limitations",
        "",
        "- No walk-forward accuracy evaluation has been performed.",
        "- Real model weights were not downloaded or exercised in this environment.",
        "- The recorded checks are shape and guard validation only.",
        "- `sample_count` asks Kronos to average internal samples into one path. This unit does not return an ensemble of paths.",
        "",
        "## Approved uses",
        "",
        "None. Pending model owner review.",
        "",
        "## Prohibited uses",
        "",
        "- Placing an order.",
        "- Changing a hard position, concentration, buying-power, or price-band limit.",
        "- Treating this shape check as validated forecasting accuracy.",
        "- Claiming a walk-forward evaluation has been performed.",
        "",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    CARD.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(report), encoding="utf-8", newline="\n")
    CARD.write_text("\n".join(card), encoding="utf-8", newline="\n")
    merge_models([{
        "id": MODEL_ID,
        "version": 1,
        "title": "Kronos bounded daily forecast",
        "model_type": "foundation_timeseries",
        "owner": "Market Risk (pending confirmation)",
        "activation": "none; pending model owner review and the Phase 6.3 walk-forward evaluation",
        "validation_report": "grc/models/reports/SM-FC-02.md",
        "model_card": "grc/models/cards/SM-FC-02.md",
        "lookback_over_max_rejected": checks["lookback_over_max_rejected"],
        "horizon_over_max_rejected": checks["horizon_over_max_rejected"],
        "sample_count_over_max_rejected": checks["sample_count_over_max_rejected"],
        "insufficient_history_rejected": checks["insufficient_history_rejected"],
        "reference_vectors_matched": checks["reference_vectors_matched"],
        "output_shape_matched": checks["output_shape_matched"],
        "weights_exercised": False,
        "accuracy_evaluated": False,
        "note": "Checks cover bounds rejection, point-in-time windowing, and output shape on a synthetic fixture. They are not a hit rate or an accuracy number.",
    }])
    return checks


def main() -> None:
    checks = write_reports()
    summary = {
        "model_id": MODEL_ID,
        "lookback_over_max_rejected": checks["lookback_over_max_rejected"],
        "horizon_over_max_rejected": checks["horizon_over_max_rejected"],
        "sample_count_over_max_rejected": checks["sample_count_over_max_rejected"],
        "insufficient_history_rejected": checks["insufficient_history_rejected"],
        "reference_vectors_matched": checks["reference_vectors_matched"],
        "output_shape_matched": checks["output_shape_matched"],
        "weights_exercised": False,
        "accuracy_evaluated": False,
    }
    print(json.dumps(summary))
    guards_held = all((
        checks["lookback_over_max_rejected"],
        checks["horizon_over_max_rejected"],
        checks["sample_count_over_max_rejected"],
        checks["insufficient_history_rejected"],
        checks["reference_vectors_matched"],
        checks["output_shape_matched"],
    ))
    if not guards_held:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
