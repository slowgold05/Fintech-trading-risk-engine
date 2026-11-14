# Phase 6 follow-up — point-in-time correctness for `generate_forecast`

Roadmap item named in [P6E_FORECAST_EVALUATION_VERIFICATION.md](P6E_FORECAST_EVALUATION_VERIFICATION.md)
and `app/scripts/run_forecast_evaluation.py`'s own docstring as still open:
"actually wiring/running a real evaluation against real Kronos weights
(requires first fixing `generate_forecast`'s own 'always reads latest
history' limitation this unit's own offline script surfaced — not
attempted by any unit so far)." That script's own comment states the
problem precisely: `generate_forecast` "re-reads the latest cached
history itself, so calling it on these windows would show each cutoff
bars from after that cutoff" — i.e. using it inside a walk-forward
backtest today would leak future data into every historical window.

This contract fixes exactly that leak, as a pure, fully-testable code
change — no `torch`, no Kronos weights, no `requirements-forecast.txt`
install needed to verify it (same discipline as every other
Kronos-adjacent unit this session: prove the logic with mocks, never
pretend to exercise real weights without actually installing them).

## The fix

`app/services/forecast_kronos.py`'s `generate_forecast` gains one new
optional keyword-only parameter: `as_of: date | None = None`.

- When `as_of` is `None` (the default — every existing caller,
  `app/routers/forecasts.py`'s live production path included, is
  unaffected and unchanged): behavior is identical to today. No existing
  test's expected behavior changes.
- When `as_of` is given: after `read_symbol_history` returns `bars`,
  filter to only bars whose `session_date <= as_of` **before** computing
  `len(bars) < lookback` and before slicing `window = bars[-lookback:]`.
  This guarantees the model's input window never contains a bar dated
  after the requested cutoff. The existing "insufficient history" `ValueError`
  message and condition stay exactly as they are, just evaluated against
  the filtered list instead of the full one — so a window that doesn't
  have enough *pre-cutoff* history still fails the same documented way.
- `_next_trading_sessions(last_date, horizon)` (computing the future
  session dates to forecast) is unchanged — it already starts from
  `window[-1]`'s own date, which after the fix is guaranteed to be
  `<= as_of` when `as_of` is given, so the forecasted future sessions
  correctly start after the cutoff, not after "today."
- `input_cutoff` in the returned dict (already `window[-1]["session_date"]`)
  needs no change — it already reports the true last bar used, which is
  the correct value in both modes.

No other function in `forecast_kronos.py` changes. No change to
`app/routers/forecasts.py` or any other caller — this is purely additive.

## Second change: give `run_forecast_evaluation.py`'s adapter a real path

`_kronos_forecaster` in `app/scripts/run_forecast_evaluation.py` is
currently a stub that always raises `NotImplementedError`. Confirmed the
exact calling convention by reading `app/services/forecast_evaluation.py`
directly (do not re-derive this — it is already confirmed, not a guess):
`run_walk_forward_evaluation`'s `forecaster` callback is invoked as
`forecaster(observed, horizon)` — exactly two positional arguments,
`observed` a list of `{"session_date", "close", ...}` bar dicts (the
history strictly *before* the window being forecast) and `horizon` an
int — and **must return a flat `list[float]` of predicted close prices**,
paired index-for-index against the window's actual closes by
`_mean_absolute_error`/`_directional_accuracy`. It does not return a dict
and takes no other arguments.

`generate_forecast` cannot be that callback directly — it takes
`db`/`symbol`/`provider`/`adjustment_type`/`sample_count` that
`run_walk_forward_evaluation` never passes, and returns a dict of forecast
*bars* (OHLCV), not a flat close-price list. So the script needs a thin
closure, not a direct reference:

- `_load_bars` (already queries full OHLCV from `MarketBarDaily`, just
  currently discards everything but `session_date`/`close` before
  returning) keeps its full-OHLCV query but returns the complete row
  shape (`open`, `high`, `low`, `close`, `volume`, `session_date`) instead
  of the narrowed one, since `generate_forecast` needs all five fields.
- Build the real forecaster as a closure over the script's own `db`,
  `symbol`, `provider`, `adjustment_type`, and a fixed `sample_count`
  (e.g. `1`, matching the simplest reproducible case — not configurable
  via a new CLI flag unless the contract is revisited), something like:
  ```python
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
  ```
  **Capping `lookback` at `settings.forecast_kronos_max_lookback` is
  required** — `bars` passed into the closure is the *entire* observed
  history up to the cutoff (which grows with each window and can exceed
  the configured max), not something already bounded to the configured
  lookback the way `generate_forecast`'s own `ValueError` guard expects.
  Passing `len(bars)` unmodified would make later (older-cutoff, more
  history) windows fail that guard for a reason unrelated to real data
  insufficiency.
- This part still requires `forecast_kronos_enabled` and the heavy
  dependencies (`torch`, the vendored Kronos package, downloaded weights)
  to actually execute for real; the contract here only requires that the
  adapter is **correct**, not that this unit installs `torch` or
  downloads weights to run it — that remains a separate, later decision,
  exactly as already disclosed in `FORECAST_LAB_OPEN_LIMITATIONS.md`.

## Test plan

`tests/test_forecast_kronos.py`: extend the existing monkeypatched-history
fixture pattern (see `test_generate_forecast_builds_correct_input_window_and_future_sessions`)
with new tests:

1. A fixture of 10 trading-day bars; call with `as_of` set to the 7th
   bar's date. Assert the `FakePredictor`'s captured `df`/`x_timestamp`
   never include bars 8-10, and `input_cutoff` equals the 7th bar's date.
2. Same fixture, `as_of` set to a date with fewer than `lookback`
   pre-cutoff bars available; assert the same "insufficient history"
   `ValueError` as the existing un-cutoff test, with a message reflecting
   the filtered count, not the full fixture's count.
3. Omit `as_of` entirely (or pass `None` explicitly); assert output is
   byte-for-byte identical to the existing test's expectations — proving
   the default path is unchanged.

If `run_forecast_evaluation.py`'s own calling-convention investigation
(reading `run_walk_forward_evaluation`'s real signature) turns up any
mismatch with what's assumed above, stop and report the exact
discrepancy rather than guessing — same standing rule as every other unit
this session.
