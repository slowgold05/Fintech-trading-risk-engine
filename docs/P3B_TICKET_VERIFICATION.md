# P3-B order ticket verification

Codex accepted the preview/confirm ticket on 2026-11-06. Full P3-B is not done. This note does not claim a formal GitHub approval. PR 19 will be marked ready after the documentation commit's CI. This note does not record a pull-request label.

## Accepted revision

- Commit `90074df585c413b0305aa56d2197cbc5cde3d213` on `codex/v2-order-ticket-20261106`.
- [PR 19](https://github.com/slowgold05/Fintech-trading-risk-engine/pull/19), stacked on PR 18.
- [CI run 42327832410](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42327832410): all 7 jobs succeeded.
- Frontend ticket only. No backend source, new migration, settings, or dependency change. No merge, deploy, or hosted mutation.
- Trades order entry mounts the ticket. The immediate Dashboard `POST /trades/` path is unchanged.

## CI results

- Frontend: 169 tests, 19 files. Lint and build passed.
- Backend, Python 3.12, fresh PostgreSQL 17: 251 passed, 3 optional browser modules skipped, 795 warnings, 85.46s.
- Headless Linux browser: 6 passed, 1 hosted case excluded, 4 warnings, 69.03s.
- Security, static analysis, dependency, and secrets checks passed.
- The browser baseline was corrected because login already has an opening ledger, which stays the baseline, and preview still requires all six owner-table counts to stay unchanged.

## Accepted behavior

- Resting P0-B proof: preview, keyboard confirm, and replay of one order. The reservation is $100. Cash stays $100,000. Buying power drops to $99,900, then returns to $100,000 after cancel. The resting order does not spend cash.
- Empty-book market, real zero: outcome canceled, no fills, cash unchanged.
- A financial edit invalidates the preview. A failed refresh hides the old figures. A blocked sell has no confirm.
- An unknown network failure retries on the same idempotency key. That retry is unit-covered. The existing real-browser idempotency replay is covered. A lost post-commit reply has no browser proof.
- Confirm is available only for an eligible, confirmable preview whose draft still matches and whose step-up flag is boolean. The step-up code goes out only with confirm. Edits clear the preview unless confirm is pending or the outcome is unknown. A reply applies only while mounted, and only for that request generation.
- The client accepts an acknowledgement only after a positive id, matching order identity, status `open`, `filled`, or `canceled`, and finite quantity bounds. Legacy acknowledgement numbers are checked for finite values, bounds, and identity. They are not compared as exact decimals. A failed check remains an unknown outcome and keeps the key.
- Reservation is cash set aside, separate from estimated fill. A real zero stays zero. Unknown money or quantity stays unavailable. The cached preview is indicative. The server revalidates on submit.

## Visual review

Application source was unchanged, so the UI renderer matches the earlier run. The manager viewed 10 unique ticket capture states across two CI runs. Screenshots were not spliced, hidden, or scaled. The sell shots waited for the existing toast to expire.

- [Run 42327395572](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/42327395572), all 7 jobs succeeded: 8 ticket PNGs. Initial desktop shots use an outer 1280×800 frame and CSS 1264×657. Initial mobile CSS is 390×733. Initial screens do not share one CSS size.
- The manager reviewed 4 captures from final run 42327832410: 2 new confirm desktop and mobile captures, and 2 updated sell captures. Preview and confirm CSS viewports are 1280×800 and 390×844.
- Readable, with no overflow: form, ready preview, reserve versus fill, real zero, error hiding old figures, server canceled, blocked sell with no confirm, and confirm on desktop and mobile.
- Local ephemeral copies, not committed: `.local-tools/ci-browser-42327395572/p3b-ticket` and `.local-tools/ci-browser-42327832410/p3b-ticket`.
- Windows Selenium Manager remains blocked (4551) and was never bypassed. The browser journey ran on Linux CI only.

## Limits

Retry intent is mounted memory and is lost on reload or unmount. Durable unknown-outcome recovery and reconciliation remain core release hardening before any deploy, and are not done.

The next task is the owned order-detail read. The owned order-detail contract will accompany that next unit and is absent from this commit. Lifecycle UI, cancel-versus-fill proofs, chart integration, and watchlists follow. Backend preview `0aa62afd64a24bba2d659dc3044cebe6265e6929` is unchanged ([P3B_PREVIEW_VERIFICATION.md](P3B_PREVIEW_VERIFICATION.md)).
