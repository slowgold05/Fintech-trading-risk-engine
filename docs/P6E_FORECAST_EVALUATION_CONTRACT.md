# Walk-forward forecast evaluation contract

Fifth unit of roadmap Phase 6 (Experimental Forecast Lab) — section 6.3's
walk-forward evaluation methodology, the roadmap's own explicit gate before any
"broad exposure" of the Forecast Lab ("Walk-forward results and baseline
comparisons are reviewed before broad exposure" is a named exit criterion). This
unit builds the **evaluation methodology itself** — rolling windows, point-in-time
correctness, a documented baseline comparison, per-window error reporting,
disclosed sample sizes — as real, independently-verified, tested code. It does
**not** run a real evaluation against real Kronos weights (the same disclosed
boundary every Kronos-touching unit this session has had: no `torch` install, no
Hugging Face download, no real inference exercised here) — it proves the harness
itself is correct against a synthetic fixture and a trivial mock forecaster, the
same "shape and guard validation, not an accuracy claim" discipline PR #76's own
`SM-FC-02` governance artifacts already established.

## Scope decision: evaluation is offline/administrative, not a per-user API action

Running `window_count` walk-forward windows through a real model is far heavier
than even a single forecast job (PR #77's own 5-job cap, PR #78's 1-job-per-cycle
scheduler limit already reflect how expensive one real call is). Roadmap 6.3's own
language ("evaluate... before tuning parameters," "retain failed evaluations and
weak results") describes a research/validation activity a maintainer runs
deliberately, not a feature a signed-in trader triggers. So this unit does **not**
add a `POST /forecasts/evaluations` route — evaluation runs are written by an
offline script (`app/scripts/run_forecast_evaluation.py`, mirroring
`validate_forecast_kronos.py`'s own "script writes rows directly" shape), and the
two new `GET` routes are **read-only**, listing whatever evaluation runs already
exist (an empty list is a legitimate, expected state until a maintainer actually
runs one for real).

## Scope decision: the evaluation harness takes bars directly, not a date range

A full production-grade "fetch an arbitrary historical point-in-time window" data
path does not exist yet (`read_symbol_history`'s own `range_token`s are relative to
*now*, not an arbitrary past cutoff — building that flexible historical reader is
its own separate concern, not needed to deliver the actual roadmap-mandated
methodology). This unit's harness operates on an already-fetched, already-ordered
list of historical bars passed in directly by its caller — the offline script is
responsible for assembling that list (e.g., by querying `MarketBarDaily` directly
for a symbol's full history, which is a simple, already-reviewed query shape used
throughout this codebase). This keeps the methodology itself fully testable and
correct without also having to build new production data-access infrastructure
that only this one offline script would use.

## New service: `app/services/forecast_evaluation.py`

- `_mean_absolute_error(actual: list[float], predicted: list[float]) -> float`:
  `mean(|a - p|)` over paired values.
- `_directional_accuracy(reference: float, actual: list[float], predicted:
  list[float]) -> float`: for each day `i`, compares `sign(actual[i] - prev)` to
  `sign(predicted[i] - prev)`, where `prev` is `reference` for `i == 0` and the
  **real** `actual[i-1]` for `i > 0` (never the model's own prior prediction — this
  prevents compounding one wrong call into every later day's score). A flat/no-move
  prediction (`sign == 0`) only counts as a hit when the actual move was also flat.
  Returns the hit fraction.
- `_baseline_last_close(reference: float, horizon: int) -> list[float]`: the
  "last observed close repeated for every future day" baseline named in roadmap
  6.3 (`"last observed close"`) — the simplest, most literal reading of that named
  baseline.
- `evaluate_walk_forward_window(history_bars: list[dict], cutoff_index: int,
  horizon: int, forecaster) -> dict`: splits `history_bars` at `cutoff_index` —
  everything before it is the forecaster's input (point-in-time: the forecaster
  never sees `history_bars[cutoff_index:]`), the next `horizon` bars starting at
  `cutoff_index` are the real, already-known "actual future." Calls
  `forecaster(history_bars[:cutoff_index], horizon)` (a callable the caller
  supplies — `generate_forecast`-shaped in production, a trivial mock in tests) to
  get `horizon` predicted closes. Computes model MAE/directional accuracy and
  baseline MAE/directional accuracy (against the same actual future), both scored
  against the same `reference_close = history_bars[cutoff_index - 1]["close"]`.
  Returns a dict with both sets of metrics plus `cutoff_date` (for the report).
- `run_walk_forward_evaluation(history_bars: list[dict], *, horizon: int,
  window_count: int, forecaster) -> dict`: selects `window_count` **non-overlapping**
  windows, walking backward from the end of `history_bars` (the most recent
  possible window first, excluding the last `horizon` bars since those have no
  "actual future" to compare against) — each window's cutoff is `horizon` bars
  before the previous window's cutoff, so no two windows share any of the same
  "actual future" bars. Raises `ValueError` with a readable message if
  `history_bars` is too short to produce `window_count` non-overlapping windows of
  the requested `horizon` (do not silently produce fewer than asked). Returns a
  dict: `{"windows": [...]` (per-window detail from `evaluate_walk_forward_window`),
  `"model_mae"`/`"model_directional_accuracy"`/`"baseline_mae"`/
  `"baseline_directional_accuracy"` (each averaged across all windows),
  `"window_count"`, `"horizon"}`.

### Reference vectors (hand-verified independently before implementation)

Single-window example: `reference_close = 99`, `actual = [100, 102, 101]`,
`predicted (model) = [101, 101, 103]`.

- Model MAE: `mean(|100-101|, |102-101|, |101-103|) = mean(1, 1, 2) = 1.3333...`
- Model directional accuracy: day 0 (`100` vs ref `99` → up; `101` vs `99` → up →
  **match**), day 1 (`102` vs prev-actual `100` → up; `101` vs `100` → up →
  **match**), day 2 (`101` vs prev-actual `102` → down; `103` vs `102` → up →
  **mismatch**) → `2/3 = 0.6667`.
- Baseline (flat at `99`): MAE `mean(1, 3, 2) = 2.0`; directional accuracy: day 0
  (actual up, baseline flat → mismatch), day 1 (actual up, baseline `99` vs
  prev-actual `100` → down → mismatch), day 2 (actual down, baseline `99` vs
  prev-actual `102` → down → **match**) → `1/3 = 0.3333`.

These four numbers (`1.3333`, `0.6667`, `2.0`, `0.3333`, all to 4 decimal places)
are the exact values a unit test must reproduce from this exact fixture.

## New model: `app/models/forecast_evaluation.py`

```python
class ForecastEvaluation(Base):
    __tablename__ = "forecast_evaluations"

    id = Column(Integer, primary_key=True)
    symbol = Column(String(20), ForeignKey("market_symbols.symbol", ondelete="RESTRICT"), nullable=False)
    provider = Column(String(32), nullable=False)
    adjustment_type = Column(String(20), nullable=False)
    horizon = Column(Integer, nullable=False)
    window_count = Column(Integer, nullable=False)
    model_mae = Column(Float, nullable=False)
    model_directional_accuracy = Column(Float, nullable=False)
    baseline_type = Column(String(32), nullable=False)
    baseline_mae = Column(Float, nullable=False)
    baseline_directional_accuracy = Column(Float, nullable=False)
    weights_exercised = Column(Boolean, nullable=False)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
```

**No `user_id` column.** An evaluation is a model-governance artifact (is this
model any good, in general) like `grc/models/`'s own cards/reports — not a
per-user private resource like a job or a result. `GET /forecasts/evaluations`
therefore lists every row to any authenticated user, the same way `GET
/forecasts/models` reports global configuration to any authenticated user.
`weights_exercised` records honestly whether that specific row came from a real
Kronos run or a mocked/placeholder forecaster — carried through to the API
response so nobody mistakes a shape-validation run for a real accuracy result.

## New migration

Chains onto the current head (whatever PR #79 leaves it at). Creates
`forecast_evaluations` with an index on `symbol`. `downgrade()` drops the index
then the table.

## New offline script: `app/scripts/run_forecast_evaluation.py`

Given a `--symbol` (and optional `--horizon`/`--window-count`/`--provider`/
`--adjustment-type` arguments, reasonable defaults), queries `MarketBarDaily`
directly for that symbol's full chronological history (the existing, already-used
query shape — mirror how `market_history.py`'s own `_symbol_history` already
queries this table; do not add a second parsing convention), calls
`run_walk_forward_evaluation` with `generate_forecast` adapted to this harness's
`forecaster(bars, horizon) -> list[float]` calling convention (a small adapter
function in the script itself, not in `forecast_evaluation.py`, which must stay
free of any Kronos-specific dependency so its own tests never need `torch`
installed), and writes one `ForecastEvaluation` row with `weights_exercised =
True`. This script is not invoked by CI or any test — it is a maintainer's manual
tool, run only once `requirements-forecast.txt` is installed, `qforecast_kronos_enabled`
is on, and real cached history exists for the symbol.

## New schema: `app/schemas/forecast_evaluation.py`

```python
class ForecastEvaluationOut(BaseModel):
    id: int
    symbol: str
    provider: str
    adjustment_type: str
    horizon: int
    window_count: int
    model_mae: float
    model_directional_accuracy: float
    baseline_type: str
    baseline_mae: float
    baseline_directional_accuracy: float
    weights_exercised: bool
    notes: str | None
    created_at: str

class ForecastEvaluationCollection(BaseModel):
    evaluations: list[ForecastEvaluationOut]
```

## New routes, added to `app/routers/forecasts.py`

- **`GET /forecasts/evaluations`** — lists every evaluation row, newest first,
  `limit` query param (`default=50, ge=1, le=100`). **No `user_id` filter** — see
  above.
- **`GET /forecasts/evaluations/{evaluation_id}`** — looked up by id alone (no
  ownership filter, since there is no owner) — `404` if the id doesn't exist.

(Route-ordering: `/evaluations` is a literal segment, matched before `/{forecast_id}`
regardless of registration order, same reasoning as `/models`.)

## What this unit does not do

Does not run a real evaluation against real Kronos weights (disclosed boundary).
Does not add a flexible arbitrary-date-range historical data API (deferred — the
offline script queries `MarketBarDaily` directly instead). Does not add a `POST`
route to trigger an evaluation on demand (deliberately offline/administrative).
No chart UI. No frontend. Does not touch any existing route, job, or worker.
