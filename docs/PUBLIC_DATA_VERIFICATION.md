# Public market data verification

Local follow-up on 2026-11-05, uncommitted, on top of `be8ffdc19f78d2942b5e9922ce605d6a5de7d472`. This closes the public-data correction. It does not deploy anything and it does not complete a roadmap phase.

## What changed

Authored public `marketSnapshot` rows are gone. Generated sparklines and timeframe multipliers are gone. Index tiles show the real ETF source symbols. A missing or partial section stays unavailable. Stale heatmap changes are suppressed instead of being painted as a fresh move.

Three review findings were fixed and then accepted in a read-only pass:

- `_format_mover` keeps a missing figure null. It does not turn that gap into zero.
- A market-cap-only or default research score is not presented as a computed score.
- A zero SEC margin is a real reported value. It keeps SEC precedence over an Alpha Vantage fallback such as 0.25. The one chosen margin is both the displayed margin and the score input.

## Evidence already recorded

These results belong to this unit. They do not replace the signed-in evidence in [UI_DATA_TRUTHFULNESS.md](UI_DATA_TRUTHFULNESS.md) or the earlier P0/P1 notes.

- Codex full suite on a fresh isolated PostgreSQL: 174 passed, 1 skipped, 591 warnings, 46.82 seconds. The skip is the Selenium module on Python 3.14.
- Focused market tests: 18 passed.
- Frontend: 31 tests passed. Lint passed. Production build passed. Last bundle: `index-De9jDK5U.js`, 488.79 kB.
- Headless Selenium 4.52 on Python 3.11, against disposable `p0b_browser` at loopback port 54331, with the web app on port 4173 and the API on port 8000. The public cached-ETF, stale, missing-company, and mobile 390×844 check passed. The 7.83 second timing was taken before the final timestamp-copy formatting, so it is not a duration for the formatted copy.
- Browser API requests were blocked at HTTP.
- Chrome DevTools separately inspected the missing-data UI at 1264×800, 390×844, and 632×324 CSS pixels with device scale 2. No horizontal overflow. No generated trends and no timeframe controls. The DevTools review tab is closed. Later browser checks use the headless browser only.
- The mechanical Impeccable detector returned `[]` on Home.

## Boundary

No hosted file, schema, or data changed. Provider ingestion, auth, roles, cash, ledger, execution, and matching were not part of this correction. Phase 0 and Phase 1 stay open.
