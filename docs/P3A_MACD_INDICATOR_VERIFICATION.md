# MACD indicator backend verification

This unit adds MACD as a fourth `name` value on `GET /market/symbols/{symbol}/indicators`,
alongside `sma`, `ema`, `rsi`. Backend-only. Design is written first, as its own contract section
— [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md) section 14 — the same way the original
SMA/EMA proposal and the RSI addendum were written before their implementations, because MACD
genuinely differs in shape from the first three: it takes three periods conventionally (fast,
slow, signal), not one, and produces three numbers per bar, not one.

## The design decisions, made before any code was written

- **Query contract**: no router change, no new query parameter. The existing required `period`
  is reused, but for `macd` it means the **signal** period only. Fast (`12`) and slow (`26`) are
  fixed industry-standard constants in this unit — not customizable. This is a deliberate,
  documented compromise (reusing one parameter for a different meaning per `name`), accepted
  because every alternative either needs a router change or a second required parameter most
  callers would never vary.
- **Response shape**: additive only. `sma`/`ema`/`rsi` points stay exactly
  `{"session_date", "value"}` — not even a `null`-valued extra key. `macd` points gain `signal`
  and `histogram` keys that are genuinely absent (not present-and-null) on the other three names.
- **Status/warm-up**: `_closes_required` gets a `macd` branch returning the fixed slow period
  (`26`), independent of the request's `period`/signal value.

## Implemented by Grok, independently verified by me

Scoped to exactly 2 files via per-file `--allow` rules (the contract doc was explicitly marked
read-only in the task — Grok was told to flag any discrepancy rather than edit it, and found
none). I computed a 40-point reference table independently beforehand, in a separate Decimal
script, from the formula in the contract — not derived from Grok's implementation, so matching
it is a real correctness check.

Grok's implementation:
- Refactored `_ema` into a thin wrapper over a new `_ema_decimals(series, period)` that returns
  the unrounded `Decimal` sequence, quantizing only in the existing `_ema`'s own return —
  `_ema`'s external behavior (quantized-text list) is completely unchanged, confirmed by every
  existing sma/ema test passing unmodified.
- `_macd(closes, signal_period)` calls `_ema_decimals` on `closes` twice (fast=12, slow=26), then
  a third time on the unrounded MACD subsequence (not the quantized text) for the signal line —
  exactly the precision discipline specified (never double-quantize, never recompute from an
  already-rounded intermediate).
- `_points`/`_response` both wired through the existing `_closes_required` dispatch, with a
  distinct point-shape branch for `macd` that adds `signal`/`histogram` keys only for that name.

Independent verification I did myself:
- `git status` confirmed only the 2 scoped files changed, plus my own untouched contract-doc
  addition (Grok left it exactly as written).
- Re-ran `tests/test_market_indicators.py`: **59 passed** (44 existing + 15 new), full backend
  suite: **335 passed, 28 skipped**, same 2 pre-existing unrelated Windows-local SQLite-locking
  errors documented since PR #27.
- Diffed the test file's 40-point `_MACD_VALUES`/`_MACD_SIGNAL`/`_MACD_HISTOGRAM` reference
  arrays against my own independently-computed table line by line — exact match on all 15 MACD
  values, 7 signal values, and 7 histogram values (25 leading nulls for MACD, 33 for
  signal/histogram, matching `slow - 1` and `slow + signal - 2` respectively).
- Confirmed `test_non_macd_points_omit_signal_and_histogram` genuinely proves the shape
  constraint (checks the exact key set via `set(point) == {"session_date", "value"}`, not just
  values) for all three other names.
- Read every line of `_macd`/`_ema_decimals` against the contract section 14.2 formula.

## What changed

- `app/services/market_indicators.py`: `_NAMES` gained `"macd"`; `_MACD_FAST`/`_MACD_SLOW`
  constants; `_closes_required` gained a `macd` branch; `_ema` refactored onto `_ema_decimals`
  (behavior-preserving); new `_macd`; `_points` gained a `macd`-specific point shape.
- `tests/test_market_indicators.py`: 15 new tests — the 40-point reference vector, the
  insufficient-to-partial boundary at the fixed slow period, a shape-only proof that the other
  three names never gain `signal`/`histogram` keys, and the same period-bounds coverage the
  other names get, plus 1 parametrize-list name-rejection case.
- `docs/P3A_INDICATOR_CONTRACT.md`: new section 14, written by me before implementation,
  untouched by Grok.

## Verification run, 2026-11-07

- `python -m pytest -q tests/test_market_indicators.py`: **59 passed**, 0 failed.
- `python -m pytest -q` (full backend suite), local Python 3.14.6, `AUDIT_DATABASE_URL` unset
  (SQLite): **335 passed, 28 skipped**, 2 pre-existing unrelated errors (documented above).
- No file outside `app/services/market_indicators.py` and `tests/test_market_indicators.py` was
  touched (the contract doc was written by me, separately, before this unit).

This does not add MACD to the frontend — `IndicatorName`, the indicator `<select>`, and
`historyData.ts`'s `indicatorOverlay` are unchanged. A MACD chart-integration unit (rendering
three series — MACD line, signal line, histogram bars — in one panel) is a separate, later unit,
analogous to but larger than RSI's own-scale-panel work. No merge or deploy is claimed.
