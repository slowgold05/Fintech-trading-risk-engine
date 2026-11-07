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

`coverage_status` remains the history value `not_verified`. `expected_session_count` remains `null`. `collection` remains the history value. This slice must not claim a verified exchange calendar or a complete two-year series.

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
| `coverage_status` | history (`"not_verified"`) |
| `expected_session_count` | history (`null`) |
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

`status` is never `complete`. A long cached series stays `partial` when any value is computed. `coverage_status` stays `not_verified` on that same body.

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
