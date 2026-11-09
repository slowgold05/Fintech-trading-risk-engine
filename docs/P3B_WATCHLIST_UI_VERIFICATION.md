# P3-B watchlist UI — verification

Codex reviewed the watchlist UI and viewed six captures from the accepted code run, and accepted UI code `70f68c72a17ec703dfc9ca5d7da1011472cc53ab`. The targeted Docker zlib fix is `4b6bb03566fb2c9e6ac756505a6a24a577f37d00`. Draft [PR 24](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/24) is stacked on backend [PR 23](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/23). [CI 42383808088](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42383808088) is the accepted code run: all 7 jobs succeeded. No formal GitHub approval is claimed. PR 24 stays a draft until documentation-head CI finishes. This note does not record that later head. Full P3-B stays open, and no phase box is checked. The backend remains historical in [P3B_WATCHLIST_VERIFICATION.md](P3B_WATCHLIST_VERIFICATION.md) at `31333a319e5a0104dacbf8ff1dfa4be2059513c6`.

## Accepted code CI

Backend, Python 3.12, fresh PostgreSQL 17: 277 passed, 6 optional Selenium modules skipped, 906 warnings, 120.86s. Frontend: 246 tests in 23 files; lint and build passed. Browser: 9 passed, 1 hosted case excluded, 109 warnings, 118.84s. That browser job includes the new watchlist journey. Security, static analysis, dependency, and secrets jobs passed. The dependency job passed with no ignores.

The existing frontend bundle-size warning remains. Main is 559.91 kB, still over the 500 kB warning.

## Earlier CI and the image fix

[CI 42383634137](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42383634137) was cancelled after the security-scan image failed on `zlib1g`. `4b6bb03566fb2c9e6ac756505a6a24a577f37d00` targets that package only: `apt --only-upgrade` installed `zlib1g` `1:1.3.dfsg+really1.3.1-1+deb13u1`. CI 42383808088 is the run after that fix.

The initial UI commit attempt tripped the secret scanner on fake fixture tokens. Those values were replaced with short mock values. The hooks stayed intact.

## Browser evidence

Codex viewed these six PNGs from CI 42383808088: `public`, `persisted`, `lists-desktop`, `lists-mobile`, `second-owner-empty`, and `deleted`.

The public page makes no private watchlist calls. Created lists, members, and ordering survive reload; rename, removal, and deletion are verified afterward. One document moves A to B to A while A's list remains. The database rows stay on the owning user. A window sentinel remains unchanged across that journey, proving no document reload. (Actual harness sets `__p3wStay=1`.) The layout fits at 390 px wide. A draft holds actual focus and does not start history or research XHR. Trade carries only the symbol. Cancelled delete leaves the list. Completed delete removes it and leaves no orphan items. Cash, the six financial counts, and the ledger reconcile stay unchanged.

The small browser fixture fallback, used after Grok stalls, is a self-contained seed and a logout wait. Application source for that journey is the Grok UI.

## Unit evidence

Unit tests cover a late owner response aborted while a request is still pending, session and mutation response isolation, a known acknowledgement followed by refresh failure, an uncertain failure, and the list and member caps.

## Boundaries

This UI slice does not change hosted login, merge, deploy, migration, or grants. No hosted database mutation. The mounted-only unknown-order retry still drops its intent on reload or unmount. That remains a release gate.

## Next

Next is the backend-only cached daily SMA/EMA unit described in [P3A_INDICATOR_CONTRACT.md](P3A_INDICATOR_CONTRACT.md). That contract is a proposed review. It is not implemented. Full P3-A and full P3-B stay open. P1 provider, calendar, and ingestion stay open. P4 and later stay open. The mounted-only unknown-order reload retry stays a release gate.
