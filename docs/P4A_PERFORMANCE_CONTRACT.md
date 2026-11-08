# P4-A Performance: daily valuation and time-weighted return — contract

Written before any implementation, the same way P1-A/P1-B/P1-C and the indicator contracts were.
This is the first slice of Phase 4.1 ("Portfolio performance engine"): daily portfolio
valuations and time-weighted returns, reconciled to the ledger. It does **not** implement
money-weighted returns, benchmark comparison, drawdowns, performance-by-position, or allocation
by sector — those are separate, later units, explicitly out of scope here.

## 1. What already exists (read, not rebuilt)

- `app/services/portfolio_valuation.py`'s `_value_portfolio` computes **today's** valuation
  (cash, holdings, cost basis, realized/unrealized P&L) from one consistent snapshot. This unit
  reuses its logic and conventions (money quantized to cents, quantities to 6 places, "complete"
  vs. "incomplete" status) for a **historical series**, not just today.
- `app/services/ledger_service.py`'s `LedgerEntry` records exactly two cash-affecting event
  kinds today: `"opening_snapshot"` (once, when an account is first touched — a one-time backfill
  of whatever cash/holdings already existed) and `"trade"` (every buy/sell). A third,
  `"reset"`, wipes an account back to a target cash figure (used for tests/demos) and is already
  treated by `_realized_subquery` as a new inception boundary for realized P&L — this unit must
  treat it the same way for valuation history.
- **Correction (found during implementation review, before this unit shipped):** an earlier
  draft of this contract said no deposit/withdrawal feature exists. That was wrong — I had not
  found `app/services/cash_movements.py` during the first research pass. `post_movement` already
  posts real `"cash_deposit"`/`"cash_withdrawal"` ledger events today
  (`("cash", None, "USD", signed)` + `("offset", None, "USD", -signed)`, `signed` positive for a
  deposit, negative for a withdrawal) via the live `POST /cash/...` route. This is not a future,
  hypothetical event kind — it is real and already shippable. Section 5 below is corrected to
  actually exclude these flows from the return ratio, not just to leave a documented seam for a
  "later unit." Shipping the ratio without this exclusion would violate the roadmap's own
  explicit acceptance criterion ("Cash deposits are not investment return") for real accounts
  that have ever used this feature — not a hypothetical edge case.
- `Trade.realized_pnl`/`realized_pnl_pct` are already computed correctly (FIFO, against `Lot`
  rows) at execution time in `app/services/trade_execution.py`. This unit reads those values; it
  does not recompute FIFO cost itself.
- `app/services/market_history.py`'s `MarketBarDaily` rows are the only source of historical
  daily closes. Real provider backfill remains gated (unapproved, per P1-C) — this unit's tests
  use synthetic fixtures, the same way every other market-data unit in this project does; the
  real-world usefulness of this route is gated exactly like `/market/symbols/{symbol}/history`
  already is, not a new blocker this unit introduces.

## 2. Scope

New read-only route: `GET /portfolio/performance?range=1y|2y` (reusing the same `range` values
`app/services/market_history.py` already supports — no new range vocabulary). Returns a daily
time series of reconstructed account value and a time-weighted-return index, for trading days
only (per the existing reviewed NYSE calendar), from the user's performance inception through the
latest trading day that has a computable value. Writes nothing. One consistent snapshot read, the
same discipline `_value_portfolio`/`read_symbol_history` already use.

## 3. Inception

A user's performance-measurement inception is the `created_at` of their latest `"reset"` ledger
event, or their `"opening_snapshot"` event if they have never been reset — the exact same rule
`_realized_subquery` already applies for realized P&L, applied here for the whole series instead
of just a sum. The series starts at the first trading day on or after that inception timestamp's
date that is also `>= requested_start` (the range window may clip an old inception further back
than the window covers; it never extends the series before inception).

## 4. Daily account value

For each trading day `d` in range, `account_value(d) = cash(d) + sum(quantity(asset, d) * close(asset, d))`
over every asset with a nonzero `quantity(asset, d)`:

- `cash(d)`: the running cash balance after all ledger entries dated on or before `d`'s end
  (reuse the existing ledger's `amount` postings on the `"cash"` account — sum them chronologically
  up to and including day `d`; do not re-derive this from `User.cash_balance`, which is only
  today's live figure).
- `quantity(asset, d)`: the running net position in that asset after all `"trade"` (and, if
  present, `"reset"`) ledger postings on the `"position"` account up to and including day `d`.
- `close(asset, d)`: the single stored `MarketBarDaily` row for `(asset's symbol, d,
  adjustment_type="raw")`, **regardless of provider** — if more than one provider has a row for
  that exact `(symbol, date, "raw")`, this is a genuine ambiguity (Phase 1's "reconcile
  conflicting provider data" is explicitly not implemented anywhere in this project yet); treat
  it the same way a missing price is treated (see below), do not silently pick one. Use `"raw"`
  (not split-adjusted) to match `price_at_execution`'s own convention — valuation should reflect
  real traded dollars, not a split-normalized series.

If any held asset (nonzero quantity that day) has no unambiguous `"raw"` close for day `d`, that
whole day's `account_value` is `null` and `status` is `"unavailable"` for that day, with the
specific symbol(s) responsible listed — mirroring `_value_portfolio`'s existing
`unavailable_symbols` convention exactly, just per-day instead of once. Never substitute a
previous day's price, an average, or a partial sum that silently excludes the missing asset's
contribution — the existing project-wide rule against fabricating financial figures applies here
exactly as it does in `_value_portfolio` and the indicator/history work.

## 5. Time-weighted return (corrected — deposits/withdrawals are real, not hypothetical)

`twr_index` is a cumulative growth factor, `1.000000` at the first day the series has a
computable value (the "base day" — not necessarily the literal inception date if that date
itself is unavailable). For each later day `d` with a computable `account_value(d)`:

```
flow(d) = sum of "cash_deposit"/"cash_withdrawal" ledger amounts (signed: deposit positive,
          withdrawal negative) dated strictly after last_available's date, through and
          including day d's date.

twr_index(d) = twr_index(last_available) * (account_value(d) - flow(d)) / account_value(last_available)
```

where `last_available` is the most recent earlier day in the series that had a computable value
(not necessarily the immediately preceding calendar/trading day — if a gap exists, this correctly
chains across it rather than resetting to `1.0` or breaking permanently). A day with
`account_value == null` also has `twr_index == null`.

`flow(d)` must sum every `cash_deposit`/`cash_withdrawal` posting dated anywhere in
`(last_available's date, d's date]` — **not only on day `d` itself** — so that a flow landing on
a gap day (one with no computable `account_value`, e.g. a missing price) is still correctly
excluded once the series resumes at the next available day, rather than silently polluting that
day's return or forcing the sub-period to be marked `"unavailable"` just because a deposit
happened to land on a day with no price data. `account_value` itself is unaffected — it already
correctly includes deposited/withdrawn cash as a real snapshot of what the account is worth that
day; only the *return ratio* needs the flow excluded, because a deposit is new money, not a
gain, and a withdrawal is removed money, not a loss.

**Independently verified extension of the section 8 reference scenario** (continuing from Day 5,
`account_value "1075.00"`, `twr_index "1.075000"`), proving the exclusion is necessary and
correct — all three new days are investment-return-flat (no trade, no price change on XYZ)
despite real cash moving, which a buggy un-excluded ratio would NOT show flat:
- Day 6: deposit `$100.00`, no trade, close unchanged at `$60.00`. Cash `775 + 100 = 875.00`.
  `account_value = 875.00 + 5*60.00 = 1175.00`. `flow(D6) = 100.00`.
  `twr_index = 1.075000 * (1175.00 - 100.00) / 1075.00 = 1.075000 * 1 = 1.075000` (unchanged —
  correct; a naive un-excluded ratio would wrongly compute `1.075000 * 1175/1075 ≈ 1.175000`, an
  apparent 17.5% gain purely from depositing cash).
- Day 7: withdraw `$50.00`, no trade, close unchanged. Cash `875 - 50 = 825.00`.
  `account_value = 825.00 + 300.00 = 1125.00`. `flow(D7) = -50.00`.
  `twr_index = 1.075000 * (1125.00 - (-50.00)) / 1175.00 = 1.075000 * 1 = 1.075000` (unchanged —
  correct; withdrawing cash is not a loss).
- Day 8: no stored close for XYZ (another gap), **and** a `$20.00` deposit lands this same day.
  Day 8 stays `"unavailable"` (same missing-price rule as section 4) — but the deposit is not
  lost, it is carried forward via `flow` accumulation to whichever day the series next resumes.
- Day 9: close resumes at `$60.00` (same price). Cash `825 + 20 = 845.00` (the Day 8 deposit
  already landed in cash). `account_value = 845.00 + 300.00 = 1145.00`. `last_available` is
  Day 7 (`1125.00`, index `1.075000`); `flow(D9)` sums every deposit/withdrawal dated after Day
  7 through Day 9 inclusive — that is just the Day 8 deposit, `flow(D9) = 20.00`.
  `twr_index = 1.075000 * (1145.00 - 20.00) / 1125.00 = 1.075000 * 1 = 1.075000` (unchanged —
  correct, and proves the exclusion works even when the flow itself landed on an unavailable
  day).

This is real, load-bearing scope for this unit — not a deferred nicety. `cash_movements.py`'s
`post_movement` is a live, already-shippable route; shipping `twr_index` without this exclusion
would be a genuine, user-visible bug the first time any account deposits or withdraws cash
within a measured window.

## 6. Response shape

```json
{
  "user": {"id": 1, "email": "..."},
  "range": "1y",
  "requested_start": "2025-11-07",
  "requested_end": "2026-11-07",
  "inception_at": "2025-11-10T14:03:00Z",
  "read_at": "2026-11-07T18:00:00Z",
  "status": "complete",
  "series": [
    {
      "session_date": "2025-11-10",
      "status": "available",
      "account_value": "1000.00",
      "unavailable_symbols": [],
      "twr_index": "1.000000"
    }
  ],
  "reconciliation": {
    "latest_series_date": "2025-11-10",
    "latest_series_value": "1000.00",
    "current_total_account_value": "1000.00",
    "matches": true
  }
}
```

- `status` (top-level) is `"complete"` only if every day in `series` has `status: "available"`;
  otherwise `"incomplete"` — mirrors `_value_portfolio`'s own `valuation_status` convention, at
  the series level.
- `reconciliation` is only populated (non-null) when `latest_series_date` is today's trading day
  (i.e. the series actually reaches "now") and that day's value is available: compare it against
  a fresh call to the existing `_value_portfolio` (same read, same snapshot clock) and report
  whether the two agree to the cent. When the series doesn't reach today (clock boundary, no data
  yet for today) or today's value is unavailable, `reconciliation` is `null` — do not fabricate a
  comparison against a day that isn't actually "now."
- `account_value`/`twr_index` are decimal-text, matching this project's existing convention for
  every other money/ratio field (6 places for `twr_index`, matching indicator-value precision;
  cents for `account_value`, matching `_value_portfolio`'s money convention).

## 7. Errors

Same validation as `read_symbol_history`'s `range` parameter: `range not in {"1y", "2y"}` is
HTTP 422 with `"range must be 1y or 2y."`. An unknown user is the existing auth-layer 404/401
behavior — no new error path.

## 8. Required tests (independent reference, not just "passes")

A hand-computed, independently-derived reference scenario (prices and trades chosen for clean
exact decimals, verified by a separate calculation before implementation, not derived from the
code under test):

- Inception (opening snapshot): cash `$1000.00`, no holdings. Day 0 value `1000.00`, `twr_index
  1.000000`.
- Day 1: buy 10 XYZ at `$50.00` (cash → `500.00`). Day 1 close `$52.00`. Value
  `500.00 + 10*52.00 = 1020.00`. `twr_index = 1.000000 * 1020/1000 = 1.020000`.
- Day 2: no trades. Close `$54.00`. Value `500.00 + 10*54.00 = 1040.00`.
  `twr_index = 1.020000 * 1040/1020 = 1.040000` (exact: `1.02 * 52/51 = 1.04`).
- Day 3: sell 5 XYZ at `$55.00` (realized P&L `25.00` on those 5 shares at cost `50.00`; cash →
  `775.00`). Day 3 close `$55.00`. Value `775.00 + 5*55.00 = 1050.00`.
  `twr_index = 1.040000 * 1050/1040 = 1.050000` (exact: `1.04 * 105/104 = 1.05`).
- Day 4: no stored close for XYZ (simulated gap). Value `null`, `twr_index null`,
  `unavailable_symbols: ["XYZ"]`, day `status: "unavailable"`, top-level `status: "incomplete"`.
- Day 5: close resumes at `$60.00`. Holdings still 5 XYZ, cash `775.00`. Value
  `775.00 + 5*60.00 = 1075.00`. Chains across the Day 4 gap from Day 3's value/index:
  `twr_index = 1.050000 * 1075/1050 = 1.075000` (exact: `1.05 * 43/42 = 1.075`).

Assert every one of these six days' `account_value`/`twr_index`/`status` exactly, **and then
continue the same scenario through the three additional days in section 5** (Day 6 deposit, Day 7
withdrawal, Day 8 gap-with-a-deposit, Day 9 resume) asserting each of those exactly too —
including explicitly asserting that a *naive* un-excluded calculation would have produced a
different, wrong number on Day 6 (e.g. assert the real `twr_index` is `"1.075000"`, not the
`"1.175000"`-ish figure an un-excluded ratio would give), so the test actually proves the
exclusion fired, not merely that some number came out. Plus:
- The `"reset"`-as-new-inception rule: a user with a `"reset"` event after some trades has their
  series start at the reset, not at the original `opening_snapshot`, and pre-reset trades do not
  appear in the series at all (mirroring `_realized_subquery`'s own existing reset-boundary rule
  for realized P&L — add a test proving both use the same boundary for the same scenario).
- An ambiguous day (two different providers both have a `"raw"` row for the same symbol/date) is
  treated as unavailable, not silently resolved by picking one.
- `reconciliation` populates and matches when the series reaches today with an available value,
  and is `null` when it does not reach today or today is unavailable.
- `range` validation (422 for anything other than `"1y"`/`"2y"`).
- No provider call, and query count does not grow with the number of trading days in the window
  (reuse `_value_portfolio`'s/`read_symbol_history`'s existing query-bounding discipline — do not
  issue one query per day).

## 9. What this unit does not do

Money-weighted return, benchmark comparison (SPY or otherwise), historical drawdowns,
performance by position/asset, portfolio allocation by security or sector, and any frontend
chart/UI for this data are all separate, later units. No migration (reads existing tables only).
Deposit/withdrawal **exclusion from the return ratio** is in scope and required (section 5) —
only a new deposit/withdrawal *event kind* or UI is out of scope (the existing one is reused
read-only). No merge or deploy is claimed by implementing this contract.

## 10. Historical drawdown addendum (2026-11-07) — a second slice on the same route

Written before implementation, appended to the same contract after section 1-9's first slice
(`GET /portfolio/performance`) shipped. This adds `drawdown_pct` to each series point — the
percentage decline from the running peak `account_value` (among available days only, from the
series' own base day through that day) to that day's value. No new query, no new data source:
purely derived from the `account_value` sequence the route already computes.

### Formula

For each available day `d`, `peak(d) = max(account_value(day) for every available day from the
series' first available day through d, inclusive)`. Then:

```
drawdown_pct(d) = ((peak(d) - account_value(d)) / peak(d)) * 100
```

quantized to 4 decimal places, `ROUND_HALF_UP`, rendered as decimal text — the same precision
`trade_execution.py`'s `realized_pnl_pct` already uses for a percentage field in this codebase,
reused for consistency rather than inventing a new one. A new all-time-high day has
`drawdown_pct == "0.0000"` (not null, not omitted — zero is a real, correct value, same
"null means unknown, zero means a real zero" rule every other money/percentage field in this
project already follows). A day with `account_value == null` (a gap) also has
`drawdown_pct == null` — the peak itself is carried forward across a gap unchanged (a gap day
cannot set a new peak, since it has no value), the same way `last_available`/`twr_index` already
carry forward across a gap in section 5.

### Reference (continuing the same worked scenario from sections 8 and 5)

Peak tracked across the whole 10-day scenario (`D0` through `D9`, including the extended
deposit/withdrawal days):

```
D0  1000.00  peak 1000.00  drawdown_pct "0.0000"
D1  1020.00  peak 1020.00  drawdown_pct "0.0000"
D2  1040.00  peak 1040.00  drawdown_pct "0.0000"
D3  1050.00  peak 1050.00  drawdown_pct "0.0000"
D4  (gap)    peak unchanged (1050.00)  drawdown_pct null
D5  1075.00  peak 1075.00  drawdown_pct "0.0000"
D6  1175.00  peak 1175.00  drawdown_pct "0.0000"
D7  1125.00  peak 1175.00 (unchanged — 1125 < 1175)  drawdown_pct "4.2553"
D8  (gap)    peak unchanged (1175.00)  drawdown_pct null
D9  1145.00  peak 1175.00 (unchanged — 1145 < 1175)  drawdown_pct "2.5532"
```

(`D7`: `(1175.00 - 1125.00) / 1175.00 * 100 = 4.255319...` → `4.2553`. `D9`:
`(1175.00 - 1145.00) / 1175.00 * 100 = 2.553191...` → `2.5532`. Verified independently in a
separate Decimal script before implementation, not derived from the code under test.)

### What this addendum does not do

Does not add a top-level "maximum drawdown" summary field, a drawdown-duration figure, or any
frontend/chart rendering — those remain open, separate, later units if wanted. Does not change
any existing field's meaning or the response's top-level shape beyond one new key per series
point.

## 11. Daily dollar P&L addendum (2026-11-07) — a third slice on the same route

Written before implementation, appended after sections 1-10. Adds `daily_pnl` to each series
point — the dollar change in `account_value` from the last available day to this one, excluding
any cash deposit/withdrawal in between (the same exclusion section 5's `twr_index` already
applies, reused here so the two fields can never disagree about what counts as a flow). No new
query, no new data source: reuses the existing `_flow_since`/`last_value`/`last_available_date`
machinery the TWR calculation already maintains in the same loop.

### Formula

For an available day `d` with a prior available day (`last_available` is not `None`):

```
daily_pnl(d) = account_value(d) - flow(d) - account_value(last_available)
```

using the exact same `flow(d)` (`_flow_since(flows, last_available, d)`) section 5 already
computes for `twr_index`. Quantized to cents, `ROUND_HALF_UP`, as decimal text — the same
money convention every other dollar field in this response already uses. The series' first
available day (no prior day to diff against) has `daily_pnl == null`, not zero — there is no
"previous day" to have changed from, which is a different fact from "the account didn't move,"
and this project's convention is that `null` means unknown/inapplicable while `0.00` means a
real, measured zero. A day with `account_value == null` (a gap) also has `daily_pnl == null`.

### Reference (continuing the same 10-day worked scenario)

```
D0  null          (first available day, nothing to diff against)
D1  "20.00"        (1020.00 - 0 - 1000.00)
D2  "20.00"        (1040.00 - 0 - 1020.00)
D3  "10.00"        (1050.00 - 0 - 1040.00)
D4  null           (gap)
D5  "25.00"        (1075.00 - 0 - 1050.00, chains across the D4 gap)
D6  "0.00"         (1175.00 - 100.00 deposit - 1075.00 — the $100 is excluded, true P&L is flat)
D7  "0.00"         (1125.00 - (-50.00) withdrawal - 1175.00 — excluded, flat)
D8  null           (gap)
D9  "0.00"         (1145.00 - 20.00 (the D8 deposit, carried forward) - 1125.00 — flat)
```

Verified independently in a separate Decimal script before implementation, not derived from the
code under test. Every day where `twr_index` stayed flat (`1.075000` → `1.075000`) has
`daily_pnl == "0.00"`, and every day where it moved has the matching nonzero dollar figure — the
two fields are two views of the same excluded-flow logic and must never contradict each other
for the same day; a test should assert this cross-check explicitly (a day's `daily_pnl == "0.00"`
if and only if `twr_index` is unchanged from the prior available day, for at least the four
flow-bearing days in this reference), not just assert each field's own number in isolation.

### What this addendum does not do

Does not add a top-level cumulative-P&L-since-inception summary field (that needs a second,
inception-anchored running total, not just a day-over-day diff — a separate, later addendum if
wanted). Does not change any existing field's meaning. Does not add frontend rendering.

## 12. Cumulative dollar P&L addendum (2026-11-07) — a fourth slice on the same route

Written before implementation, appended after sections 1-11. Adds `cumulative_pnl` to each
series point — the total dollar gain or loss since the series' own base day (the first available
day, where `twr_index` is defined as `1.000000`), excluding every deposit/withdrawal posted since
then. Complements `daily_pnl` (section 11), which measures change since the *previous* available
day; this measures change since the *first* one. No new query, no new data source: reuses the
exact `_flow_since` helper section 5/11 already use, anchored at the base day's date instead of
`last_available`'s.

### Formula

Let `base_value` be `account_value` on the series' first available day (the same day
`twr_index` is set to `1.000000`), and `base_date` that day's date. For a later available day
`d`:

```
cumulative_pnl(d) = account_value(d) - base_value - _flow_since(flows, base_date, d)
```

(`_flow_since(flows, base_date, d)` sums every deposit/withdrawal dated in `(base_date, d]` —
the exact same function `twr_index`/`daily_pnl` already call, just with `base_date` instead of
`last_available_date` as the `after` argument.) The base day itself has `cumulative_pnl ==
"0.00"` (a real, measured zero — it is day zero of its own measurement, not unknown). A gap day
has `cumulative_pnl == null`, same as every other field in this response.

This is consistent with `daily_pnl` by construction (a telescoping sum of every `daily_pnl` from
the day after the base day through `d` equals `cumulative_pnl(d)` exactly, because both reuse the
same flow-exclusion logic) — a test should prove this consistency explicitly for at least one
day with intervening gaps and flows, not just assert `cumulative_pnl`'s own numbers in isolation.

### Reference (continuing the same 10-day worked scenario)

```
D0  "0.00"    (base day)
D1  "20.00"   (1020.00 - 1000.00 - 0)
D2  "40.00"   (1040.00 - 1000.00 - 0)
D3  "50.00"   (1050.00 - 1000.00 - 0)
D4  null      (gap)
D5  "75.00"   (1075.00 - 1000.00 - 0)
D6  "75.00"   (1175.00 - 1000.00 - 100.00 deposit)
D7  "75.00"   (1125.00 - 1000.00 - 50.00 net flow: +100 deposit, -50 withdrawal)
D8  null      (gap)
D9  "75.00"   (1145.00 - 1000.00 - 70.00 net flow: +100 -50 +20)
```

Verified independently in a separate Decimal script before implementation, not derived from the
code under test. Note `cumulative_pnl` correctly stays flat at `"75.00"` from D5 through D9
despite real cash moving in and out, exactly mirroring why `daily_pnl` was `"0.00"` on each of
those same days (D6, D7, D9) — the two fields must agree, by construction, on every day where
nothing but cash moved.

### What this addendum does not do

Does not add a top-level summary field outside the per-day series (the last point's
`cumulative_pnl` already is that total — a dedicated top-level duplicate is not needed). Does
not add money-weighted return or benchmark comparison. Does not add frontend rendering.

## 13. Benchmark comparison addendum (2026-11-07) — a fifth slice on the same route

Written before implementation, appended after sections 1-12. Adds `benchmark_index` to each
series point — a time-weighted-return index for a fixed benchmark symbol, `"SPY"`, computed the
same way the account's own `twr_index` is (chained sub-period price ratios, base `1.000000` on
the series' first day it has data), but **independently** of the account's own availability or
cash flows. `"SPY"` is hardcoded in this unit, not configurable — "a fixed benchmark now, a
choice of benchmark later" is the explicit, documented scope boundary (the roadmap itself says
"SPY or another benchmark," naming SPY first).

### Why independent of the account's own day-availability

The account's `twr_index`/`account_value`/etc. are null on a day the account has a missing
asset price (section 4), and the TWR formula excludes deposits/withdrawals (section 5). None of
that applies to a benchmark index — it is just SPY's own price history, chained the same way,
using only SPY's own close availability. A day can have an available account value and an
unavailable `benchmark_index` (SPY itself has a data gap that day), or vice versa — the two
fields are not required to agree on which days are known. This is deliberately simpler than the
account's own chain: no flow exclusion term, because a benchmark price return has no deposits.

### Formula

Let `C_SPY(d)` be the single stored `MarketBarDaily` row for `("SPY", d, adjustment_type="raw")`
— the same ambiguity rule section 4 already defines (more than one provider row for the same
date is treated as missing, not silently resolved) applies here too, independently. For the
first trading day in the series that has an unambiguous `C_SPY`, `benchmark_index = 1.000000`.
For each later day `d` with an unambiguous `C_SPY(d)`:

```
benchmark_index(d) = benchmark_index(last_spy_available) * C_SPY(d) / C_SPY(last_spy_available)
```

where `last_spy_available` is the most recent earlier day in the series that itself had an
unambiguous SPY close (chaining across a SPY-only gap, exactly the way section 5 already chains
the account's own index across an account-side gap — same technique, independent tracking
variable). A day with no unambiguous SPY close has `benchmark_index == null`, and does not move
`last_spy_available` forward.

This needs one additional query for the window's SPY raw closes (reuse the existing
`_raw_closes` query shape, just for the fixed symbol `"SPY"` instead of the held symbols) — still
one query for the whole window, not one per day, so the existing query-count-does-not-grow test
must still hold with this added.

### Reference (a new, independent SPY close sequence over the same 10 trading days)

```
day   SPY close   benchmark_index
D0    400.00      "1.000000"
D1    404.00      "1.010000"
D2    408.00      "1.020000"
D3    404.00      "1.010000"
D4    412.00      "1.030000"   (SPY has data here even though the account's own day is a gap —
                                 proves the two fields are independent)
D5    416.00      "1.040000"
D6    420.00      "1.050000"
D7    (no close)  null          (SPY itself has a gap on a day the account is fully available —
                                 proves independence the other direction)
D8    (no close)  null
D9    424.00      "1.060000"   (chains from D6 across the two-day SPY gap, skipping D7/D8)
```

Verified independently in a separate Decimal script before implementation, not derived from the
code under test. Note this SPY close sequence is intentionally unrelated to XYZ's own gap days
(D4 for XYZ, D8 for SPY-vs-account in the existing scenario) specifically to prove the two
chains never need to agree on which days are known.

### What this addendum does not do

Does not add a configurable benchmark symbol, a relative-performance field (e.g.
`account_minus_benchmark`), or any frontend rendering — those are separate, later units if
wanted. Does not change any existing field's meaning.
