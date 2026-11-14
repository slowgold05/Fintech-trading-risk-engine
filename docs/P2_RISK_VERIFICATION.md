# P2 risk verification

Recorded 2026-11-06. Cached risk read on review branch `codex/v2-cached-data-dashboard-20261106`, commit `7dbddce5646b7bafb358ee4c7078196e10bba720` (pushed). Source by Grok. Codex reviewed and wrote the Risk unit tests.

GitHub Actions run 42184498741: all 7 jobs succeeded. Frontend 59 tests, lint, and build passed. Backend 190 passed, 1 skipped. Browser 4 passed, 1 deselected, 54.31 seconds. Production bundle for this source: `index-BKu_7738.js`, 495.76 kB. Run 42183715804 on `1a68e74792840be34c0cd8e4683e56f36950c3b7` failed only an over-strict mobile-table assertion, before the Risk checks. The corrected helper passed in this run.

## Behavior

A failed risk read hides cached assessment-derived figures and shows Retry.

Loading, empty, error, non-finite scores, and an actual 0 shown as Low are distinct.

The latest score is a trade assessment, not portfolio risk. Gross figures are historical buy and sell notionals, not current exposure. A null trade renders as Notional unavailable. Alert labels are historical.

The shared gauge no longer shows a false Buffer or Limit. The gauge SVG has an accessible label.

## Checks

Browser passed: empty Risk, a CDP-blocked GET error, then unblock and Retry back to empty. Codex viewed the empty and error PNGs. The error image shows no empty-success content.

Mobile orders passed. Remaining, Status, and Limit each meet full cell bounds at a scroll position, one field at a time, with exact `1`, `open`, and `$100.00`. The check does not require all three on screen together. Codex viewed `orders-mobile-details.png`: a real open order, remaining 1, limit 100.

The pass is that CI job. No local visible browser and no security bypass. Codex accepts this Risk correction.

