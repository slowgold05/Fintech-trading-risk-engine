# Trade Impact Preview frontend wiring verification

Adds a new "Trade impact preview" card to `/portfolio`, the first **mutation**-driven frontend
unit this session's Phase 4 work has shipped (every prior card — allocation, attribution, risk
metrics — fetches automatically; this one previews a hypothetical trade on form submit, calling
`POST /portfolio/trade-impact`, PR #54). With this unit, every backend endpoint this session
shipped under Phase 4 (performance, allocation, attribution, risk-metrics, trade-impact) has
some frontend surface.

## Implemented by Grok, independently reviewed by me

Four files touched: `frontend/src/api/tradeImpact.ts` (new), `frontend/src/types/schemas.ts`
(additive — four new interfaces), `frontend/src/pages/Portfolio.tsx` (one new card, no existing
card touched), and the test file (extended, all prior tests unchanged).

- Mirrors `CashPanel`'s existing `useMutation` pattern on this same page rather than introducing
  a different state-management style, and `QuickTradePanel`'s buy/sell toggle visual, for
  consistency with established conventions.
- Correctly computed a client-side `symbol_position_value` delta (`after - before`) rather than
  assuming a non-existent `changes.symbol_position_value` field — the real backend contract's
  `changes` object only carries `cash_balance`/`total_account_value`/`cash_weight_pct`/
  `symbol_weight_pct`, not a position-value delta, and the implementation correctly fills that
  one real gap in the schema rather than crashing or rendering a wrong value.
- `changes.cash_balance`/`changes.total_account_value` (dollar deltas) use plain
  `formatCurrency` (which already renders a `-` for negative values); the two *percentage*
  deltas, `changes.cash_weight_pct`/`changes.symbol_weight_pct`, correctly use
  `formatSignedPercent` instead — matching the exact split I specified.
- Warnings render without hiding the numeric result — the dedicated test drives this with an
  extreme, deliberately infeasible trade (cash balance going to `-$400.00`, weight going to
  `106.25%`) and asserts both the warning label and every numeric figure still render,
  faithfully reproducing the backend's own "never a rejection" design on the frontend.
- A genuinely thorough test addition beyond what I asked: the reference test explicitly asserts
  that submitting the form calls `previewTradeImpact` exactly once with the exact expected
  payload, and that **no other mocked API function is invoked** by the submit — `createTrade`,
  `createCashMovement`, `setLegalName`, `fetchOrders`, `fetchTrades`, `fetchRisk`,
  `fetchPortfolioPnl` are all explicitly checked as not called, and the read-only queries'
  call counts are confirmed unchanged — a strong, explicit proof that this preview truly has no
  side effects anywhere else in the app, not just an absence of a database write on the backend
  (already verified when PR #54 shipped).

## Independent verification

- Reviewed the full diff of all four files directly (not Grok's self-report).
- `npm run test` inside `frontend/`: **368 passed** (0 failed) — up from 365 before this unit (3
  new tests; all 365 pre-existing tests, including every other card's tests, still pass
  unchanged).
- `npm run build` inside `frontend/`: `tsc -b && vite build` succeeded with no type errors.
- Re-confirmed the reference test reuses the exact backend contract numbers from
  `docs/P4F_TRADE_IMPACT_PREVIEW_CONTRACT.md` (cash `$1000→$800`, position `$300→$500`, weights
  `62.50%→50.00%`/`18.75%→31.25%`), already independently verified when PR #54 shipped — no new
  financial arithmetic exists in this frontend slice.
- No manual browser/visual check was performed — verified via the automated component test and
  production build only, the same disclosed boundary established for every prior frontend
  wiring unit this session.

## What this unit does not do

Does not add portfolio-volatility/VaR impact or sector-exposure before/after to the preview
(the backend itself does not yet compute these — PR #54's own "first slice" scope). Does not
change any existing card. Does not add a range selector anywhere. This closes the frontend arc
for every Phase 4 backend endpoint shipped this session.
