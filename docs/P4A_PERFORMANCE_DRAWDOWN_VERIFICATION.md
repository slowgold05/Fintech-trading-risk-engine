# Historical drawdown verification

This unit adds `drawdown_pct` to each point of `GET /portfolio/performance`'s daily series —
the percentage decline from the running peak `account_value` (among available days only) to
that day's value. A second slice on the already-shipped
[PR #37](P4A_PERFORMANCE_VERIFICATION.md) route. No new query, no new data source — purely
derived from the `account_value` sequence the route already computes. Design written first, as
a new contract section — [P4A_PERFORMANCE_CONTRACT.md](P4A_PERFORMANCE_CONTRACT.md) section 10 —
with an independently computed reference table, the same way every financial-calculation unit in
this project has been.

## Implemented by Grok, independently verified by me

Scoped to exactly 2 files via per-file `--allow` rules (the contract doc was marked read-only
and left untouched). Grok's implementation:
- A single `peak: Decimal | None` local tracked alongside the existing `last_value`/`last_index`/
  `last_available_date`, updated only on the `"available"` branch of the existing per-day loop
  (`peak = account if peak is None else max(peak, account)`) — a gap day's `continue` statement
  already skips past this update, so the peak is correctly frozen across a gap without any new
  branching logic.
- `drawdown_pct` quantized to 4 decimal places with `ROUND_HALF_UP`, reusing the same precision
  `trade_execution.py`'s `realized_pnl_pct` already uses for a percentage field, per the
  contract's instruction to reuse rather than invent a new convention.
- Added a new, well-reasoned test (`test_drawdown_peak_survives_a_gap_day`) that explicitly
  states what the *wrong* behavior would produce (a gap that reset the peak would make the
  post-gap day a new high, reporting `"0.0000"` instead of the correct `"2.5532"`) — proving the
  test actually distinguishes correct from incorrect behavior, not merely checking that some
  number came out.
- Updated every existing series-point dict literal in the test file with the new key, including
  ones inside tests not directly about drawdown (the reset-boundary test, the ambiguous-provider
  test) — grepped for completeness rather than only touching the obviously-relevant tests.

Independent verification I did myself:
- `git status` confirmed only the 2 scoped files changed, plus my own untouched contract
  addition.
- Independently computed the full drawdown reference table (continuing the same 10-day scenario
  from sections 5 and 8) in a separate Python/Decimal script before writing the task — the two
  non-zero values, `"4.2553"` and `"2.5532"`, matched Grok's test file exactly.
- Re-ran `tests/test_portfolio_performance.py`: **10 passed** (9 existing + 1 new).
- Re-ran the full backend suite: **345 passed, 28 skipped**, same 2 pre-existing unrelated
  Windows-local SQLite-locking errors documented since PR #27.
- Read the full diff against the contract; confirmed the peak-update code is unreachable for a
  gap day (placed after the `if missing: ... continue` branch), confirmed division by `peak` is
  safe in every scenario this addendum introduces (an available day's `account_value` is always
  used to seed or grow `peak`, so `peak` is never a stale/wrong value when a drawdown is
  computed from it).

## What changed

- `app/services/performance_service.py`: new `DRAWDOWN_UNIT` constant; `peak` tracked in the
  existing per-day loop; `drawdown_pct` added to both the `"available"` and `"unavailable"`
  branches of the existing series-point construction.
- `tests/test_portfolio_performance.py`: `drawdown_pct` added to every existing series-point
  assertion; one new dedicated peak-survives-a-gap test.
- `docs/P4A_PERFORMANCE_CONTRACT.md`: new section 10, written by me before implementation,
  untouched by Grok.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_portfolio_performance.py`: **10 passed**, 0 failed.
- `python -m pytest -q` (full backend suite): **345 passed, 28 skipped**, 2 pre-existing
  unrelated errors (documented above).
- No file outside `app/services/performance_service.py` and
  `tests/test_portfolio_performance.py` was touched.

Does not add a top-level maximum-drawdown summary field, a drawdown-duration figure, or any
frontend rendering — all remain open, separate, later units. No merge or deploy is claimed.
