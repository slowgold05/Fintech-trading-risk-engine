# P3-B lifecycle UI — verification

Codex reviewed the lifecycle code and all seven captures and accepted code `404c5f1850bcaaa2a1a00a18218278f697e00d8f` on `codex/v2-order-lifecycle-20261106`. Draft [PR 21](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/21) is stacked on PR 20. [CI 42333295430](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42333295430) is the accepted code run: all 7 jobs succeeded. No formal GitHub approval is claimed. The pull request stays a draft until documentation-head CI finishes. This note does not record that later head. Full P3-B stays open, and no phase box is checked. The earlier detail read remains historical in [P3B_DETAIL_VERIFICATION.md](P3B_DETAIL_VERIFICATION.md) and [P3B_LIFECYCLE_CONTRACT.md](P3B_LIFECYCLE_CONTRACT.md).

## Accepted code CI

Backend Python 3.12, fresh isolated PostgreSQL 17.11: 263 passed, 4 optional browser modules skipped, 864 warnings, 108.19s. Frontend: 187 passed, 21 files, 17.99s; lint and build passed. Headless Linux browser: 7 passed, 1 hosted case deselected, 109 warnings, 91.13s. Static analysis, dependency, secrets, and security jobs passed.

An earlier run, [CI 42332795515](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42332795515), failed on the narrow populated grid. The local minimum-width fix in `404c5f1` is the accepted code above, and CI 42333295430 then passed.

## PostgreSQL lock order

`tests/test_order_cancel_postgres.py` ran in that isolated backend job. Both proofs passed. Each pauses the holder after the `MarketSymbol` `FOR UPDATE` and uses `pg_blocking_pids` to observe the waiter blocked on that holder before release.

Fill-then-cancel: the fill wins, both orders are filled with remaining zero, and the waiting cancel returns 409. Cancel-then-buy: the cancel wins with the one share still remaining, and the waiting limit buy rests open with no fill. Ledger reconciliation succeeded in both proofs.

## Browser evidence

`tests/browser/test_p3b_lifecycle.py` uses the real service on the disposable browser database. The fixture writes a synthetic maker position, fifty-two maker limit sells, and one owner limit buy of fifty-three. Those orders are not placed by the browser. The existing ticket browser test still covers actual placement on its own.

The owner starts at cash `$94,800` and buying power `$94,700`. Detail shows original `53.000000`, filled `52.000000`, remaining `1.000000`, limit `100.000000 USD`, and visible UTC created and read times. Fills page as fifty then two, and the whole-order count stays 52. Reading, paging, and retry leave the six owner activity counts unchanged. Blocking the order URL hides the financial fields, shows "Order details could not be loaded.", and Retry restores the first page. Details open from the keyboard. Cancel keeps the fifty-two fills and remaining one, shows a UTC canceled time, and the dashboard returns to cash `$94,800` and buying power `$94,800`. Root and main do not overflow at 390×844.

Codex reviewed `details-desktop`, `details-mobile`, `fills-desktop`, `fills-mobile`, `page-two`, `detail-error`, and `canceled`.

## Boundaries

This slice adds no application backend, migration, grant, dependency, or policy. Existing migration and grant proofs stay inside isolated CI only. No hosted or development database mutation. No merge, deploy, or AWS change.

The mounted-only unknown-order retry still drops its intent on reload or unmount. That remains a release gate. Next is chart-to-ticket symbol-only integration, then watchlists. P1 provider, calendar, and ingestion stay open. Remaining P3-A, P4 and later, and the core release gate stay open. Chart-to-ticket symbol-only integration, named as next at this revision, is now accepted in [P3B_CHART_TICKET_VERIFICATION.md](P3B_CHART_TICKET_VERIFICATION.md).
