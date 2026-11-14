# Signed-in dashboard data correction

Local follow-up after P1-A/P1-B, 2026-11-05. This fixes the separately recorded daily-P&L and invented-curve defects. It is not a full Phase 2 redesign or a performance-series implementation.

## Behavior

- The dashboard shows backend `total_pnl` as **Total P&L**. It shows backend `total_unrealized_pnl_pct` as **Unrealized P&L %**. Neither is called a daily return. The position table calls its corresponding column **Unrealized %**.
- The cost-basis-to-account-value interpolation, its old chart renderer, and **Real 1D** claim were removed. Current account value and buying power remain visible; performance history has an explicit unavailable state until genuine account-value observations exist.
- Dashboard and portfolio no longer call the unregistered `/portfolio/pnl` endpoint. Portfolio totals come from the current valuation response, so an old separate response cannot mask incomplete valuation.
- Missing account data shows unavailable cash and account-dependent order entry. It does not appear as zero cash. An incomplete valuation still retains independently known cash/buying power and available marks.
- The dashboard identifies cached prices. The top risk label identifies the last trade assessment. This is not a new portfolio-wide quantitative risk model.
- Narrow-screen grid tracks can shrink, while wide position/trade tables retain their own horizontal scrolling. The main dashboard no longer clips whole cards horizontally on a 390px viewport.

## Verification

The existing visual design was inspected in real Chrome before rebuilding and preserved. Impeccable context and clarification guidance were used for the scoped correction. No product/design-system regeneration or broad restyling was performed.

- Frontend: 9 files, 26 Vitest tests passed; lint and production build passed. Regression coverage distinguishes total P&L from unrealized percentage, retains actual zero, suppresses missing totals, and rejects zero-cash presentation when the account read fails.
- Production bundle: `index-Bw5Sakvb.js`, 499.34 kB. The removed chart code brings the main bundle below the previous 500 kB warning threshold.
- Real Chrome/Selenium: cached incomplete valuation and recovery passed against the disposable loopback stack after its isolated database upgrade to `a21c9e7d4b60`. No `/portfolio/pnl` request appeared in the API log. The browser API blocks provider HTTP.
- Rendered result inspected at desktop 1264×649 CSS pixels and emulated mobile 390×844. The 200%-equivalent desktop reflow check uses a 632×324 CSS viewport with device scale 2; it is not a claim that native browser zoom was driven. Main-content horizontal overflow assertions passed. Screenshots are kept in ignored `.local-tools/p1a-browser/`.
- Impeccable's mechanical detector returned no findings for the touched dashboard, portfolio and position-table surfaces.

## Remaining scope

No execution, matching, reservations, cash posting, ledger, authentication, roles, provider ingestion or hosted deployment changed in this follow-up. The later public-data unit removed authored fallback rows and generated sparklines; see [PUBLIC_DATA_VERIFICATION.md](PUBLIC_DATA_VERIFICATION.md). That note does not replace the signed-in evidence in this file. Genuine performance history and portfolio-wide quantitative risk remain later roadmap units. Backend/client changes remain uncommitted and must be released together through the deployment review.
