# Daily portfolio valuation and time-weighted return verification

This is the first slice of Phase 4.1 ("Portfolio performance engine"): a new
`GET /portfolio/performance?range=1y|2y` route returning a daily time series of reconstructed
account value and a time-weighted-return index, reconciled against today's live valuation.
Design written first, as its own contract — [P4A_PERFORMANCE_CONTRACT.md](P4A_PERFORMANCE_CONTRACT.md) —
the same way P1-A/P1-B/P1-C and the indicator contracts were, because this is a genuinely new
feature (not an extension of existing chart/indicator work), and because getting portfolio
accounting correct needs the same independent-reference rigor as any other financial
calculation in this project.

## A correctness bug I found in my own contract before any code shipped

My first draft of the contract claimed "there is no deposit/withdrawal feature in the product
today," and scoped the time-weighted-return formula accordingly (no flow exclusion, just
documenting a seam for "a future unit"). That claim was wrong — I had not found
`app/services/cash_movements.py` during research. `post_movement` already posts real
`"cash_deposit"`/`"cash_withdrawal"` ledger events via the live `POST /cash/...` route; it is not
a hypothetical future feature. Shipping the return ratio without excluding these flows would have
been a genuine bug the first time any account actually deposited or withdrew cash within a
measured window — a deposit would have inflated the reported return, a withdrawal would have
deflated it, exactly the mistake the roadmap's own Phase 4.1 acceptance criteria explicitly warn
against ("Cash deposits are not investment return").

I caught this myself, after Grok's implementation of my (wrong) original contract had already
landed and I was reviewing it line by line. I corrected the contract (section 5) with the actual
required formula — summing every deposit/withdrawal dated since the last available day, not just
the current day, so a flow landing on a gap day is still correctly excluded once the series
resumes — verified a new 4-day extension of the reference scenario independently in Python before
touching any code, then implemented the fix myself directly (a precise, well-defined formula
extension to an already well-structured file, not open-ended — consistent with how smaller gaps
were fixed directly elsewhere in this session) rather than sending it back to Grok.

## Implemented by Grok (the core engine), corrected by me (the flow exclusion)

Grok's original implementation (`app/services/performance_service.py`,
`app/routers/portfolio.py`, `tests/test_portfolio_performance.py`) was otherwise careful and
correct against the contract as written at the time:
- Reused `portfolio_valuation.py`'s exact money/quantization helpers and
  `_realized_subquery`'s latest-reset-else-opening-snapshot inception rule precisely — proved by
  a test that checks both rules agree on the same seeded scenario.
- One query each for ledger entries and raw closes, regardless of window length — proved by a
  dedicated query-count test using the project's existing `before_cursor_execute` event-listener
  pattern.
- The ambiguous-multi-provider-row rule (more than one `"raw"` close for the same symbol/date is
  treated as missing, not silently resolved) — implemented exactly as specified.
- `reconciliation`'s null-vs-populated rules (weekend, gap-on-today) each got their own test.

My correction added: `_cash_flows` (extracts signed deposit/withdrawal amounts, cash-leg only,
from the already-fetched `entries` list — no new query) and `_flow_since` (sums flows in
`(after, through]`, correctly carrying a flow across a gap), wired into the existing loop by
tracking `last_available_date` alongside `last_value`/`last_index` and subtracting
`_flow_since(...)` from the numerator before dividing.

## Independent verification

- Re-derived the original 6-day reference scenario in Python before this unit was handed to
  Grok; Grok's test file's numbers matched exactly.
- After finding the deposit/withdrawal gap, independently computed a 4-day extension (deposit,
  withdrawal, a deposit landing on a gap day, then resume) in a separate Python script before
  writing any test or implementation code: every one of those four days is investment-return-flat
  (`twr_index` stays `1.075000`) since nothing but cash moved — confirmed the fix produces exactly
  that, and that a naive un-excluded calculation would have produced a visibly wrong
  `~1.175000` on the deposit day. The new test asserts both the correct number and explicitly
  that the wrong number does *not* appear, so the test proves the exclusion fired.
- `git status` confirmed only the originally-scoped files changed (my correction only touched
  the files already in scope — `performance_service.py` and its own test file — plus the
  contract doc, which Grok was told was read-only and I am the author of).
- `python -m pytest -q tests/test_portfolio_performance.py`: **9 passed** (8 from Grok's run +
  1 new).
- Full backend suite: **344 passed, 28 skipped**, same 2 pre-existing unrelated
  Windows-local SQLite-locking errors documented since PR #27.
- Reran every existing test after the fix to confirm zero regression: when no deposit/withdrawal
  exists, `_flow_since` always returns `0`, so `account - 0 == account` — mathematically
  identical to the pre-fix formula for every scenario that has no flows, confirmed by all 8
  original tests passing unchanged.

## What this unit does not do

Money-weighted return, benchmark comparison, historical drawdowns, performance by
position/asset, portfolio allocation by security or sector, and any frontend chart/UI are all
separate, later units. No migration. No new deposit/withdrawal event kind or UI — the existing
one is reused read-only. No merge or deploy is claimed.
