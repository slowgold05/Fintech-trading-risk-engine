# P3A — Cached daily SMA/EMA indicator contract

**Status:** Backend code accepted by Grok at `770ced43a7ab27c993ed266b72ddc9768061ce5f`. Evidence: [P3A_INDICATOR_VERIFICATION.md](P3A_INDICATOR_VERIFICATION.md). This file is the contract for that backend read. Chart integration later added one additive field to the response, documented in section 7; see [P3A_CHART_INTEGRATION_VERIFICATION.md](P3A_CHART_INTEGRATION_VERIFICATION.md) for that acceptance. This file is not a phase-completion record. Other indicators stay open.

**Authority:** `Sentinel_Markets_2_0_Roadmap.md` Phase 3 (advanced charting: SMA and EMA only, as the next backend slice) and the public reader `read_symbol_history` in `app/services/market_history.py`, exposed today as `GET /market/symbols/{symbol}/history`.

**Slice:** One backend-only read of cached daily closes. SMA and EMA. No other indicator.

## 1. What this slice is

Add a public read service and one route that:

1. Accept the same required history query as `read_symbol_history`: `interval`, `range`, `provider`, `adjustment_type`.
2. Also require `name` and `period`. `period` has no default.
3. Call the existing public `read_symbol_history` **once**.
4. Compute SMA or EMA in memory from that response’s accepted bars.
5. Return indicator points aligned 1:1 with those bars, plus the history identity fields from that same response.

The history function already opens one `consistent_read`, pins one snapshot clock, applies eligibility, and projects accepted bars. The indicator path must use that result as its only market snapshot.

## 2. Out of scope for this proposal

This document does not authorize any of the following, and an implementation of this slice must not include them:

- Frontend, chart library, preferences, or client calls.
- Dependency additions or version changes.
- Schema migrations, new tables, new columns, or writers.
- Provider calls, ingestion, schedulers, or a second cache.
- Trading, orders, auth, or account routes.
- Bollinger Bands, RSI, MACD, parameter persistence, or intraday intervals.
- Edits to Phase 3 checkboxes, the roadmap, or any other backlog file.
- A second SQL read of `MarketBarDaily` or any other market table from the indicator path.
- A second clock, a second `consistent_read`, a second provider, or a second cache lookup.
- Weakening `read_symbol_history` eligibility, status codes, or validation messages.
- Filling missing session dates, resetting the recurrence across a gap, or treating N as a count of exchange sessions.

`coverage_status` and `expected_session_count` are copied verbatim from the single history read. As of the reviewed exchange calendar (see [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md)), those history values are real comparisons against the standard NYSE annual schedule, not always `not_verified`/`null` as when this slice was first written. `collection` remains the history value. This slice must not claim a complete two-year series beyond what the calendar comparison states, and the calendar itself does not claim coverage of ad hoc closures.

## 3. Route

```text
GET /market/symbols/{symbol}/indicators
```

Mounted on the existing public market router beside history. The route declares the required query parameters and delegates. It does not query the database itself.

A missing required query key is rejected by FastAPI before the service runs. When the service is called, it still validates the arguments it receives: invalid history values use the existing history detail strings, and invalid `name` or `period` values use the indicator detail strings in section 4.

## 4. Query

All of these are required. None of them default. On the route, a missing required query key is a normal FastAPI 422 validation response. This contract does not promise the service detail strings below for a missing HTTP key.

| Parameter | Rule |
| --- | --- |
| `symbol` | Path. Same rule as history: nonempty, unpadded, at most the existing symbol max length. Unknown symbol is HTTP 404 `Unknown symbol.` from `read_symbol_history`. |
| `interval` | Required query. Only `1d`. A supplied value other than `1d` is HTTP 422 `interval must be 1d.` |
| `range` | Required query. Only `2y`. A supplied value other than `2y` is HTTP 422 `range must be 2y.` |
| `provider` | Required query. Same nonempty, unpadded, max-length rule as history. |
| `adjustment_type` | Required query. Only `raw` or `split_adjusted`. Any other supplied value is HTTP 422 `adjustment_type must be raw or split_adjusted.` |
| `name` | Required query. Exact `sma` or `ema`. No default. Any other supplied token, including different case, is HTTP 422 with the indicator detail below. |
| `period` | Required query. No default. An integer in the closed range 2 through 200. Supplied query text must be a canonical ASCII integer with no leading zeros. A direct service argument may be an `int` in that range. A `bool` is not accepted. |

A supplied `period` is malformed, and therefore HTTP 422 with the indicator detail below, when it is empty, padded, not a canonical ASCII integer without leading zeros (`02`, `+2`), a non-integer (`2.0`, `2e1`), a boolean, or an integer outside 2..200 (`0`, `1`, `201`, negatives). A direct service call accepts an `int` in range and rejects a `bool`.

Supplied invalid history values keep the existing history detail strings. The indicator service must call the same validation path history uses (by calling `read_symbol_history`, which validates before it reads). It must not replace those messages with weaker ones and must not accept a value history rejects.

Indicator failures for a supplied invalid `name` or `period` use HTTP 422 and a stable detail that names the field:

- `name` must be `sma` or `ema`.
- `period` must be an integer from 2 through 200.

Validate supplied `name` and `period` in the service before relying on the computed series. A direct service call with a bad `name` or `period` fails even when the history arguments are valid. A direct service call with a bad history argument fails with the history error and does not compute. A missing HTTP query key never reaches that service detail.

## 5. Single snapshot and accepted bars

The indicator service calls:

```text
read_symbol_history(
    db,
    symbol=symbol,
    interval=interval,
    range_token=range,
    provider=provider,
    adjustment_type=adjustment_type,
)
```

exactly once on the request session. That call is the only read. Computation uses the returned dict. It does not re-query bars, quotes, symbols, or the clock.

Accepted bars are `response["bars"]` in the order `read_symbol_history` already returns (session date ascending). Their projection is already restricted to:

- `quality_status == "valid"`
- a parseable session date
- a parseable `fetched_at` that is not after the snapshot clock

Rows that fail those rules are absent from `bars`. Their count is `excluded_row_count` on the history response. The indicator copies that count into its own metadata. Excluded rows are not closes, not warmup input, and not dates in `points`.

Eligibility stays inside `read_symbol_history`. This slice must not reimplement a looser filter and must not add a row history excluded.

### Malformed accepted OHLC

The new service validates the accepted projection. This check does not replace or weaken `read_symbol_history`. Each accepted bar’s `open`, `high`, `low`, and `close` must parse as a finite `Decimal`, and the four prices must satisfy:

```text
0 < low <= min(open, close) <= max(open, close) <= high
```

The close is the only series input. If any accepted bar fails the parse, is non-finite, is non-positive, or breaks that OHLC relation, the request fails with HTTP 500. That is the same failure class history uses for a canonical price that is not a finite decimal. The indicator check is stricter than publication of a history bar: history may still return a bar the indicator then rejects. Rejecting it here must not change history’s own API.

The failure applies to the whole response. The service must not drop the row, must not substitute zero, and must not emit a partial point list. Volume is not an indicator input. A history response that already failed inside `_price_text` never reaches this step.

`observed_valid_closes` equals the number of accepted bars only when every accepted bar survives that OHLC check. That is also the length of `points`.

## 6. Series definition

Let `C[0..M-1]` be the accepted closes in returned order, as `Decimal` values parsed from the bar projection. `M = observed_valid_closes`. `N = period`.

Session identity is the accepted bar’s `session_date` string. Points are 1:1 with accepted bars: point `i` has `session_date = bars[i].session_date`.

The window is the last N **observed valid stored closes** in that sequence. It is not N exchange sessions, not N calendar days, and not a filled daily grid.

Missing dates stay missing. The implementation must not insert a calendar or exchange session, must not forward-fill a close, and must not reset SMA state or the EMA carry because two accepted dates are not adjacent.

### 6.1 SMA

For each index `i`:

- If `i < N - 1`, `value` is `null`.
- If `i >= N - 1`, `value` is the arithmetic mean of `C[i-N+1 .. i]` (sum of those N closes divided by N).

### 6.2 EMA

`alpha = Decimal(2) / Decimal(N + 1)`.

Seed is the SMA of the first N closes, `mean(C[0 .. N-1])`.

For each index `i`:

- If `i < N - 1`, `value` is `null`.
- If `i == N - 1`, `value` is that seed.
- If `i > N - 1`, `value` is `alpha * C[i] + (1 - alpha) * previous`, where `previous` is the **unrounded** EMA at `i - 1`.

The carry is the unrounded `Decimal`. The implementation must not quantize the seed, the alpha product, or the carry before the next step. A later bar’s EMA is a function of that full-precision carry.

When `M < N`, every point is `null`. There is no seed and no later term.

### 6.3 Precision

Compute inside an explicitly bounded local decimal context. Use precision 50 (`decimal.Context(prec=50)`) for the SMA division and the EMA recurrence, applied locally so the process-wide context is unchanged. Precision 50 is the bound for this slice; a review may raise it only by an explicit edit to this contract. Do not use binary floats.

Quantize **only** the number placed in the response, and only after the recurrence for that index has been stored for the next step:

- Quantum `Decimal("0.000001")` (six decimal places).
- Rounding `ROUND_HALF_UP`.
- Render with `format(quantized, "f")` so the JSON value is a string, matching history price text.

`null` stays JSON `null`. Quantized text is never `"0.000000"` as a stand-in for warmup or a missing close.

## 7. Response

HTTP 200 body. Identity and metadata below are copied from the single `read_symbol_history` result, except `status`, which this section defines, and the indicator fields this section adds.

| Field | Source |
| --- | --- |
| `symbol` | history |
| `interval` | history (`"1d"`) |
| `range` | history (`"2y"`) |
| `provider` | history |
| `adjustment_type` | history |
| `coverage_status` | history (see [P1C_EXCHANGE_CALENDAR_VERIFICATION.md](P1C_EXCHANGE_CALENDAR_VERIFICATION.md) for the possible values) |
| `expected_session_count` | history (integer, or `null` only when `coverage_status` is `"not_verified"`) |
| `collection` | history |
| `read_at` | history snapshot clock, unchanged |
| `requested_start` | history |
| `requested_end` | history |
| `available_start` | history (first accepted session, or `null`) |
| `available_end` | history (last accepted session, or `null`) |
| `excluded_row_count` | history |
| `name` | request `sma` or `ema` |
| `period` | request integer |
| `source` | `"observed_valid_closes"` |
| `observed_valid_closes` | numeric count of accepted bars used as closes |
| `session_basis` | `"not_exchange_sessions"` |
| `status` | section 8 |
| `points` | array of `{ "session_date", "value" }` |
| `history` | the single `read_symbol_history` result, unmodified, nested verbatim |

`source` is the literal string `observed_valid_closes`. It names the series as those observed valid stored closes. It is not a provider id and not a second data fetch. The numeric field `observed_valid_closes` remains the count of those closes.

`points` preserves accepted-bar order. `session_date` is the history bar’s date string. `value` is `null` or a six-place decimal string.

The top level of this body has no `bars` array and does not include open, high, low, or volume directly. The additive `history` field nests the complete original history response from that same single read, including its own `bars`, so a client can plot candles and the indicator overlay from one response and one database snapshot instead of issuing or combining two independently fetched reads. This field was added for chart integration (accepted at `c93250bde11ebfafbb4a4f7bb3072ad28f0ac65b`; see [P3A_CHART_INTEGRATION_VERIFICATION.md](P3A_CHART_INTEGRATION_VERIFICATION.md)) and does not change the single-read rule in section 5: `history` is the same dict already returned by that one `read_symbol_history` call, not a second query.

`status` is never `complete`. A long cached series stays `partial` when any value is computed. `coverage_status` on that same body reflects the reviewed exchange calendar's comparison, not a fixed value.

## 8. Status

| Accepted bars `M` | Computed values | `status` | `points` |
| --- | --- | --- | --- |
| `M == 0` | none | `unavailable` | `[]` |
| `M >= 1` and `M < N` | none (every point is warmup) | `insufficient` | length `M`, every `value` is `null` |
| `M >= N` | at least the seed or an SMA at index `N - 1` | `partial` | length `M`; first `N - 1` values `null`; the rest computed |

`unavailable` is the empty accepted-bar outcome, including a known symbol whose rows were all excluded. `excluded_row_count` may be greater than zero in that body. Unknown symbols do not use this status; they are HTTP 404 from history.

`insufficient` means the symbol has at least one accepted close and fewer than `period` of them. Warmup nulls are present and labeled by status. They are not zeros and not omitted dates.

`partial` means at least one numeric value was computed. It is the only success status that contains numbers. It does not mean the two-year window is complete.

No branch returns `complete`.

## 9. Errors

| Condition | Result |
| --- | --- |
| Missing required query key on the route | Normal FastAPI 422 validation. No service detail string is promised. |
| Supplied invalid `interval`, `range`, `provider`, `adjustment_type`, or `symbol` shape | Same status and detail as `read_symbol_history` (422, or the existing symbol 422) |
| Unknown symbol | HTTP 404 `Unknown symbol.` |
| Supplied invalid `name` or `period` | HTTP 422 with the indicator detail in section 4 |
| Snapshot clock missing | HTTP 500 from history (`Market read clock is missing.`) |
| Accepted bar OHLC non-finite, non-positive, or breaking `0 < low <= min(open, close) <= max(open, close) <= high` | HTTP 500; no zero close; no point list |
| History canonical price or volume failure | Propagate that history HTTP 500; do not catch it and continue |

The indicator service must not translate 404 or 422 into an empty 200, and must not translate a price failure into `value: "0.000000"`.

## 10. Worked shapes (normative)

`N = 3`. Accepted closes in order: `1`, `2`, `6`. Alpha = `2/4 = 1/2`.

SMA points:

| session index | value before response quantize |
| --- | --- |
| 0 | `null` |
| 1 | `null` |
| 2 | `(1+2+6)/3 = 3` |

EMA points:

| session index | unrounded value |
| --- | --- |
| 0 | `null` |
| 1 | `null` |
| 2 | seed `(1+2+6)/3 = 3` |
| — | a fourth close `C` would be `(1/2)*C + (1/2)*3` using the unrounded seed |

Response text for `3` is `"3.000000"`.

These three closes are not an arithmetic progression that would make a later EMA equal the SMA by accident. Tests in section 11 must use a longer non-linear series and compare against an independent hand calculation, including at least one EMA term after the seed.

If those closes were on dates with a gap (for example session dates 10 January, 12 January, 15 January), the three points above are still the whole series. No 11 January or 13–14 January point is inserted, and the EMA carry is not reset.

If `M = 0`, status is `unavailable` and `points` is `[]`.

If `M = 2` and `N = 3`, status is `insufficient` and both values are `null`.

## 11. Tests required when this slice is implemented

Tests are part of the future implementation, not part of this document’s acceptance. When the slice is built, the suite must include the following. Place each test at the boundary that can observe it. Do not duplicate every case on both the service and the route.

1. **Hand reference.** Independent expected SMA and EMA values written out in the test, not produced by the production helper. Covers the seed index and at least two later EMA terms.
2. **Non-trivial EMA.** Closes are not linear and not constant, so EMA after the seed differs from SMA on the same window. Equality only on the shared seed is expected; later equality fails the test.
3. **Period bounds.** Accept `2` and `200`. Reject a supplied `period` of `1`, `201`, a non-integer, or padded text, and reject any supplied `name` other than `sma` or `ema`, using the indicator detail strings. Exercise these supplied-value failures at the service, and at the route when the route is what parses the query text.
4. **Strict missing queries.** Route only. Each omitted required query key (`interval`, `range`, `provider`, `adjustment_type`, `name`, `period`) returns FastAPI’s normal 422 validation response for a missing field. Do not assert the history or indicator service detail strings for those omissions. No parameter is filled in by the server. A separate case supplies an invalid history value (`interval`, `range`, `provider`, or `adjustment_type` present but illegal) and asserts the existing history detail string.
5. **Known symbol, empty series.** A symbol that exists and has no accepted bars returns 200 `unavailable`, `points: []`, `observed_valid_closes: 0`, history window fields intact.
6. **Unknown symbol.** HTTP 404 `Unknown symbol.`
7. **Excluded rows.** Invalid quality, missing session date, missing `fetched_at`, and `fetched_at` after the snapshot clock stay out of `points` and out of the close inputs. `excluded_row_count` matches history. A series that becomes empty only because every row was excluded is `unavailable`.
8. **Clock.** `read_at` equals the history snapshot clock for the same database state. The indicator path does not read a second clock.
9. **No future leak.** A bar with `fetched_at` after the clock is excluded by history and does not change SMA, EMA, `observed_valid_closes`, or point dates.
10. **No intermediate quantization.** A recurrence whose unrounded carry rounds differently from a carry quantized at each step must match the unrounded carry. The test compares full-precision expected text at six places and fails if the implementation quantizes between steps. SMA uses the same rule: divide at the local high precision, quantize once for the response.
11. **Malformed OHLC.** In the new service, an accepted projection fails the request when any of open, high, low, or close is non-finite or non-positive, or when the bar breaks `0 < low <= min(open, close) <= max(open, close) <= high`. The response is not a numeric series and contains no zero indicator value. The public history API is unchanged for the same bar.
12. **Read-only.** The request issues no insert, update, or delete. Provider functions and writers are not called.
13. **Financial counts.** Row counts and quantities for canonical bars, quotes, and any order or ledger tables used by the existing concurrency fixtures are unchanged by the indicator read.
14. **Snapshot reuse.** One test spies or counts `read_symbol_history` and shows a single call per indicator request. A SQL or session-execute counter shows the indicator service adds no statement of its own beyond that call. Two different indicator names on two requests may each call history once; a single request must not.
15. **Concurrency regression.** The existing history snapshot and concurrency tests still pass. The new route does not take a second snapshot that could observe a different clock or a different bar set than `read_symbol_history` on that session.

Warmup, gap, and status tests belong with the hand reference: first `N - 1` nulls, gap dates absent, status `insufficient` when `1 <= M < N`, status `partial` when `M >= N`, and no body with `status: complete`.

## 12. Implementation note for reviewers

The intended shape is a thin service, for example `read_symbol_indicators(...)`, plus one route that passes query values through. The service:

1. Validates `name` and `period`.
2. Calls `read_symbol_history` once.
3. Validates the accepted OHLC projection (finite, positive, and `0 < low <= min(open, close) <= max(open, close) <= high`) and builds points under a local `Context(prec=50)`.
4. Quantizes each emitted numeric value once.
5. Returns the history identity fields with the indicator fields and status in this contract.

It should import and call the public history function. Copying `_symbol_history`’s SQL, clock read, or eligibility would be a second snapshot and is outside this proposal.

Backend code at `770ced43a7ab27c993ed266b72ddc9768061ce5f` is accepted. Evidence: [P3A_INDICATOR_VERIFICATION.md](P3A_INDICATOR_VERIFICATION.md). This contract is not a phase-completion record. Chart integration and other indicators stay open.

## 13. RSI addendum (2026-11-07)

RSI is Wilder's Relative Strength Index, added as a third `name` value alongside `sma` and `ema`. It uses the same route, `GET /market/symbols/{symbol}/indicators`, the same `read_symbol_indicators` entry point, and the same response shape. `period` is the same integer from 2 through 200. A supplied `name` other than `sma`, `ema`, or `rsi` is HTTP 422 `name must be sma, ema, or rsi.` That detail supersedes the `name` sentence in section 4 for this added value. Sections 1–12 are otherwise unchanged.

The series uses the same accepted closes `C[0..M-1]` as SMA and EMA. Arithmetic runs in the same local `Context(prec=50)`. Each emitted number is quantized once with the same six-place `ROUND_HALF_UP` text. There is no second close-extraction path.

The 0-based lists `diffs`, `gains`, and `losses` each have length `M - 1`. `diffs[k] = C[k+1] - C[k]`. `gains[k]` is `diffs[k]` when that diff is positive, and `0` otherwise. `losses[k]` is `-diffs[k]` when that diff is negative, and `0` otherwise.

Warm-up is `period + 1` closes, not `period`. The seed needs `period` diffs, and a diff needs two closes, so the first RSI attaches to the bar at index `period` (the `(period + 1)`-th close). Indexes `0 .. period-1` are `null`: exactly `period` leading nulls.

Seed averages use the first `period` diffs, which span `C[0 .. period]`:

- `avg_gain = sum(gains[0:period]) / period`
- `avg_loss = sum(losses[0:period]) / period`

The bar at index `period` takes its RSI from that seed pair. For each later index `i`, the averages roll forward with Wilder's smoothing on the diff that ends at that bar (`gains[i-1]` and `losses[i-1]`):

- `avg_gain = (avg_gain * (period - 1) + gains[i-1]) / period`
- `avg_loss = (avg_loss * (period - 1) + losses[i-1]) / period`

The averages stay unrounded `Decimal` values. An average is not quantized before the next bar.

RSI from one `avg_gain` / `avg_loss` pair:

- If `avg_loss == 0` and `avg_gain > 0`, RSI is `100`.
- If `avg_loss == 0` and `avg_gain == 0` (flat prices: no movement in the window), RSI is `50`. Relative strength is undefined at `0/0`. `50` is a documented convention — the neutral value on RSI's 0–100 scale — not a value derived from the ratio.
- Otherwise `rs = avg_gain / avg_loss` and RSI is `100 - 100 / (1 + rs)`.

Status for `name=rsi` uses that warm-up length. `M == 0` is `unavailable` with `points: []`. `1 <= M < period + 1` is `insufficient`, and every value is `null`. `M >= period + 1` is `partial`. SMA and EMA keep the thresholds in section 8.

The frontend does not yet support `rsi`. The `IndicatorName` type and the indicator `<select>` in `DailyHistory.tsx` are unchanged by this unit. This is backend groundwork only, mirroring how the original SMA/EMA backend was its own accepted unit before the chart-integration unit that followed it.

An exact RSI of `0` is a known, deferred frontend gap. Real inputs can produce it, not only the `100` and `50` cases above: a window whose gains are all zero and whose average loss is positive. `frontend/src/components/historyData.ts`'s `canonicalPrice` validator, reused for indicator point values, currently requires a strictly positive value. An eventual RSI frontend-integration unit will need to loosen that check for indicator values specifically. OHLC bar prices must stay strictly positive. This unit does not change that validator. The same integration will also have to treat RSI warm-up as `period` leading nulls; the overlay builder today expects the SMA/EMA warm-up of `period - 1`.

## 14. MACD addendum (2026-11-07) — design, not yet implemented

This section is written before any code change, the same way the original indicator proposal
(sections 1-12) and the RSI addendum (section 13) were written before their implementations.
MACD needs a real design decision this contract records explicitly, because it differs from
SMA/EMA/RSI in two structural ways: it conventionally takes *three* periods (fast, slow, signal),
not one, and it produces *three* numbers per bar (the MACD line, the signal line, and the
histogram), not one.

### 14.1 Query contract

`name=macd` is a fourth accepted value, alongside `sma`, `ema`, `rsi`. The `name` error detail
becomes `name must be sma, ema, rsi, or macd.` No router change and no new query parameter: the
existing required `period` parameter (the same integer 2 through 200, same validation) is reused,
but **for `macd` it means the signal period**, not a single moving-average window. The fast period
is fixed at `12` and the slow period is fixed at `26` — the universal industry-standard MACD
defaults, not configurable in this unit. A future unit could add `fast_period`/`slow_period`
query parameters if customizing them is ever needed; this unit deliberately does not, to keep the
query contract additive and unambiguous (reusing `period` for a different meaning per `name` is
itself a compromise, accepted here only because every other option either requires a router change
or a second required parameter most callers would never vary).

### 14.2 Series definition

Let `C[0..M-1]` be the same accepted closes SMA/EMA/RSI already use. Let `fast = 12`, `slow = 26`,
`signal = period` (the request's `period`, renamed for clarity in this section only).

1. Compute `emaFast[i]` and `emaSlow[i]` exactly as section 6.2 already defines EMA, independently,
   each over the full `C` array with its own period (`12` and `26` respectively). Each stays an
   unrounded `Decimal` internally (no change to the existing `_ema` helper's behavior — it is
   reused twice, once per period, not reimplemented).
2. `macd[i] = emaFast[i] - emaSlow[i]` wherever both are non-null (`i >= slow - 1`, since the
   26-period EMA is the later-starting, more restrictive one — the 12-period EMA already has a
   value by then). For `i < slow - 1`, `macd[i]` is `null` (exactly `slow - 1 = 25` leading nulls,
   the EMA warm-up convention section 6.2 already defines, not RSI's `period`/`period+1` warm-up).
3. Let `macdValues` be the non-null subsequence of `macd`. Compute `signalSeries` as the
   `signal`-period EMA (section 6.2's same algorithm) over `macdValues` (a second, independent
   application of the existing EMA helper, this time over computed MACD values rather than
   observed closes). Map `signalSeries` back onto the full-length array: the first
   `(slow - 1) + (signal - 1)` entries of the full-length `signal` array are `null`; the first real
   `signal` value lands at index `slow + signal - 2`.
4. `histogram[i] = macd[i] - signal[i]` wherever both are non-null; `null` otherwise (same index
   range as `signal`).

All three (`emaFast`, `emaSlow`, `macd`, `signalSeries`) stay unrounded `Decimal` throughout; only
the final emitted text for `value`/`signal`/`histogram` at each point is quantized once with the
existing six-place `ROUND_HALF_UP` convention (`_response_text`), the same single-quantization
rule every other indicator already follows. The signal EMA must run on the *unrounded* `macd`
values, not on the quantized text — reusing the exact precision philosophy RSI's addendum already
established for its own averages.

### 14.3 Response shape — additive only

For `name != "macd"` (`sma`, `ema`, `rsi`), every point stays exactly
`{"session_date": ..., "value": ...}` — byte-identical to today. No existing field, key, or
behavior changes for those three names.

For `name == "macd"`, each point gains two additional keys:
`{"session_date": ..., "value": <MACD line text or null>, "signal": <signal text or null>, "histogram": <histogram text or null>}`.
`value` continues to mean "the headline number for this indicator" (consistent with every other
`name`), which for MACD is the MACD line itself. `signal`/`histogram` are present (not merely
`null`) only on `macd` points; they are absent from `sma`/`ema`/`rsi` points, not present-and-null,
so those three names' JSON shape is unchanged at the key-set level, not just at the value level.

### 14.4 Status and warm-up

`_closes_required(name, period)` (introduced in the RSI addendum) gets a third branch:
`slow` (`26`) for `macd`, independent of the request's `period`/signal value — `unavailable`
(`M == 0`), `insufficient` (`1 <= M < 26`, every point's `value`/`signal`/`histogram` all `null`),
or `partial` (`M >= 26`) uses that threshold. Note that `partial` for MACD can still mean
`signal`/`histogram` are `null` for a trailing stretch of the most recent points if
`M < slow + signal - 1` — this mirrors how SMA/EMA/RSI's own `partial` responses already carry
leading-null points inside an otherwise-"partial" series; it is not a new concept, just a second,
independently-timed warm-up inside one response.

### 14.5 What this unit does and does not do

Backend only, mirroring how the RSI backend landed before its own chart-integration unit. The
frontend `IndicatorName` type, the indicator `<select>`, and `historyData.ts`'s `indicatorOverlay`
are unchanged by this unit — `signal`/`histogram` are not yet parsed or plotted anywhere in the
frontend. A later MACD chart-integration unit will need its own design pass for how to render
three series (MACD line, signal line as a second line on the same sub-scale, histogram as bars)
in one panel, analogous to RSI's own dedicated price scale but with one more series than RSI
needed.

## 15. Bollinger Bands addendum (2026-11-07) — design, not yet implemented

Written before any code change, the same way sections 1-12, 13, and 14 were. Bollinger Bands
are the one indicator left open on the roadmap's Phase 3 line "SMA, EMA, Bollinger Bands, RSI,
and MACD." Like MACD, this indicator produces more than one number per bar; unlike MACD, the
middle band is exactly the existing SMA, not a new calculation, so most of this addendum is
about wiring, not new arithmetic.

### 15.1 Query contract

`name=bollinger` is a fifth accepted value, alongside `sma`, `ema`, `rsi`, `macd`. The `name`
error detail becomes `name must be sma, ema, rsi, macd, or bollinger.` No router change and no
new query parameter: the existing `period` parameter (the same integer 2 through 200, same
validation) is the moving-average window, exactly as it already means for `sma`. The band width
multiplier is fixed at `2` (the universal industry-standard default) and is **not**
configurable in this unit — the same deliberate choice section 14.1 already made for MACD's
fast/slow periods: reusing `period` for yet another per-`name` meaning is an accepted compromise
only because a second required query parameter (`k`, or a band-width multiplier) would be a
router change most callers would never vary. A future unit could add it if ever needed.

### 15.2 Series definition

Let `C[0..M-1]` be the same accepted closes every other indicator uses. For each index `i`:

- `i < period - 1`: `null` for all three emitted numbers — the same SMA warm-up convention
  section 6 already defines (`period - 1` leading nulls, not RSI's `period`/`period+1`).
- `i >= period - 1`: let `window = C[i-period+1 .. i]` (the same `period`-length trailing window
  `_sma` already slides over `closes`).
  - `mean = sum(window) / period` — identical to `_sma`'s existing per-bar value. This unit
    must reuse the existing `_sma` output for the middle band, not recompute an independent
    second mean calculation that could silently diverge from it.
  - `variance = sum((x - mean) ** 2 for x in window) / period` — **population** variance
    (divide by `period`, not `period - 1`), the standard Bollinger Bands convention.
  - `stdev = variance.sqrt()` (`Decimal.sqrt()`, inside the same `Context(prec=50)`
    `localcontext` every other indicator's arithmetic already runs in).
  - `upper = mean + 2 * stdev`, `lower = mean - 2 * stdev`.

All three stay unrounded `Decimal` until the final emitted text; each is quantized exactly once
with the existing six-place `ROUND_HALF_UP` convention (`_response_text`), the same
single-quantization rule every other indicator follows.

### 15.3 Response shape — additive only

For `name != "bollinger"`, every existing response shape is byte-identical — no change. For
`name == "bollinger"`, each point is:

```
{"session_date": ..., "value": <middle band>, "upper": ..., "lower": ...}
```

`value` is deliberately the same key name `sma`/`ema`/`rsi` already use for their one number
(it is literally the SMA), so a caller that only reads `value` from any indicator response
already gets the middle band for free. `upper`/`lower` are the two new keys, parallel to how
`macd` added `signal`/`histogram` alongside its own `value`.

### 15.4 Status and warm-up

`_closes_required(name, period)` gets a fourth branch: `bollinger` uses `period`, identical to
`sma`'s existing branch (the default case already returns `period` for any name not explicitly
listed — confirm this still returns the right value for `bollinger` rather than silently falling
through to a wrong branch). `unavailable` (`M == 0`), `insufficient` (`1 <= M < period`, every
point's `value`/`upper`/`lower` all `null`), `partial` (`M >= period`) — the exact same
thresholds and status semantics `sma` already has, since the warm-up length is identical.

### 15.5 Worked reference (independently verified, not derived from the implementation)

Closes `[10, 12, 11, 13, 14, 12, 15]`, `period = 3`:

```
i=0,1: null (warm-up, period - 1 = 2 leading nulls)
i=2: mean="11.000000" stdev="0.816497" upper="12.632993" lower="9.367007"
i=3: mean="12.000000" stdev="0.816497" upper="13.632993" lower="10.367007"
i=4: mean="12.666667" stdev="1.247219" upper="15.161105" lower="10.172228"
i=5: mean="13.000000" stdev="0.816497" upper="14.632993" lower="11.367007"
i=6: mean="13.666667" stdev="1.247219" upper="16.161105" lower="11.172228"
```

Verified independently with a standalone `Decimal`/`Context(prec=50)` script before
implementation — the `mean` values match what `_sma` already computes for the same inputs; the
`stdev`/`upper`/`lower` values are new.

### 15.6 What this unit does and does not do

Backend only, mirroring how RSI and MACD each landed as their own backend-only unit before any
chart-integration work. The frontend `IndicatorName` type, the indicator `<select>`, and
`historyData.ts`'s overlay builder are unchanged by this unit — `upper`/`lower` are not yet
parsed or plotted anywhere in the frontend. A later Bollinger Bands chart-integration unit would
render the middle/upper/lower as a shaded band around price, not as a separate indicator
sub-panel (unlike RSI/MACD, Bollinger Bands overlay directly on the price scale) — that design
is not part of this unit.
