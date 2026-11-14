# P3-A cached daily SMA/EMA — backend verification

Accepted code `770ced43a7ab27c993ed266b72ddc9768061ce5f` on `codex/v2-cached-indicators-20261107`. Draft [PR 25](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/25) is stacked on ready [PR 24](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/24) at `d8ff5167b7b33d90c3e3e15b5abe34ddeb50050e`. [CI 42384433382](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42384433382) is that base's final run: all 7 jobs succeeded. [CI 42385514478](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42385514478) is the accepted indicator-code run: all 7 jobs succeeded. Grok implemented the source; Codex reviewed it and accepted the backend unit against this CI evidence. No formal GitHub approval is claimed. PR 25 stays a draft until documentation-head CI finishes. This note does not record that later head. No merge or deploy.

This acceptance covers the backend read in [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md) only. It does not close P3-A, the indicator warm-up on the chart, or any other indicator. It checks no roadmap box.

## Accepted code CI

Backend, Python 3.12, fresh PostgreSQL 17: 303 passed, 6 optional Selenium modules skipped, 916 warnings, 129s. Frontend: 246 tests in 23 files; lint and build passed. Browser: 9 passed, 1 hosted case excluded, 109 warnings, 121.59s. That browser job is the existing journey regression. No frontend file changed in this unit, and no new screenshots were inspected. Security, static analysis, dependency, and secrets jobs passed with the rest of the seven.

## Local checks

Python 3.14.6, `AUDIT_DATABASE_URL` unset, before the last three test additions: 279 passed, 27 skipped, 956 warnings, 76.87s. No local PostgreSQL proof is claimed for this note.

Focused final run: 40 passed, 38 warnings, 0.91s. That count is 26 new indicator cases plus 14 history cases.

## Proofs in the new tests

The hand reference is an independent non-linear fraction series, written in the test, not produced by the production helper. An early EMA carry that is quantized at each step diverges from the unrounded carry: `4.083333` versus `4.083334`. Exact half-up renders `1.000001`. Names are strict. Unhashable inputs are rejected. `period` is the closed range 2 through 200. Missing queries fail before the service detail. Warm-up values are null. An empty series stays empty. An unknown symbol is HTTP 404. Invalid OHLC on an accepted bar is HTTP 500 for the whole response. Provider and adjustment selections stay separate. Future `fetched_at` rows and non-valid quality stay excluded by the history read. The indicator path stubs `read_symbol_history` once and issues no extra SQL. Financial row counts stay unchanged. Provider calls stay blocked.

## Boundaries

No UI, dependency, schema, grant, migration, auth, trading, provider, scheduling, or hosted action. The response copies history identity from that single read and adds SMA or EMA points. It does not nest the history payload. `coverage_status` stays `not_verified`.

## Next

Next is an optional SMA/EMA chart integration. That unit should return one original nested history response from the same single indicator read, so candles and the overlay share one snapshot. That nest is not implemented here. The current response has no history nest. Full calendar and ingestion stay open. P4 and later stay open. The mounted-only unknown-order reload retry stays a release gate.
