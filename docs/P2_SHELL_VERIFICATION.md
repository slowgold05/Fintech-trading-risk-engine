# P2 shell and dashboard-state verification

Verified locally on 2026-11-05. This note records the initial shell and one truthful dashboard-state slice. P2 remains open. No commit or deployment was part of this unit.

Codex reviewed the shell and dashboard-state changes and ran the checks below.

## Shell

Mobile navigation is a native dialog. Desktop keeps the persistent nav. The close control is an internal 44px button. The opener exposes expanded state and identifies the dialog it controls. Native modality makes the background inert and returns focus on close.

Tab and Shift+Tab wrap at the first and last dialog controls. An earlier headless run showed Chrome moving focus from the page to browser chrome; the explicit wrap is the correction. Escape, the close button, the backdrop, in-app navigation, a resize to the desktop width, and logout each close or clean up the shell.

The unsupported System live ping is replaced by static Paper trading. Dark layout, branding, routes, and role-filtered links are unchanged. Auth controls are unchanged. This was not a redesign.

The global jsdom `matchMedia` fixture and dialog method mocks support component tests only. They are not evidence that native focus works. A guarded Selenium test covers the mobile shell. The cached-valuation assertion now checks closed-nav behavior; it previously checked an offscreen aside position. A stale route-element wait was corrected in the same browser pass. Safety guards are unchanged.

## Dashboard state

A missing or failed risk response yields a null score. A successful empty assessment list is a separate no-assessments state. An actual backend score of 0 stays numeric 0 and uses the existing Low threshold. Missing and failed risk do not draw a gauge. Risk and recent trades each expose retry. A failed risk refresh does not present cached risk data as a fresh success.

A successful empty trade list says "No executed trades". The copy no longer says the list is today. Cash and account figures from an unrelated successful portfolio read stay visible. The separate Risk page still has its own score fallback and is outside this unit. Order behavior and API routes are unchanged.

## Checks

Frontend, on the same local tree:

- `npm.cmd run lint` passed.
- `npm.cmd test` passed: 11 files, 41 tests. The three component shell tests are inside that 41.
- `npm.cmd run build` passed. The bundle is `/assets/index-JLkNjC3v.js`, 491.69 kB.

Browser, headless Chrome 156 and Selenium 4.52, against that same bundle. The isolated `p0b_browser` listener was `127.0.0.1:54331`, Alembic `a21c9e7d4b60`, web port 4173, API port 8000. The existing `isolated_api` guard blocked provider requests. Each journey used a new designated account. This note contains no account details. The API and preview processes were stopped after every run.

| Test | Time | What the final run exercised |
| --- | --- | --- |
| `mobile_shell_keyboard_and_resize` | 10.68s | 390×844 CSS emulation; Tab and Shift+Tab; background focus blocked; Escape, close, and backdrop return focus; route change; desktop 1280×800; logout cleanup |
| `local_designated_trader_journey` | 23.34s | Public entry, login, order replay, reservation cancel, compliance 403, missing session, expired session |
| `cached_portfolio_incomplete_and_complete` | 10.02s | Incomplete then complete valuation; 390px mobile width and a 632×324 reflow at 2× device scale |
| `public_cached_quotes_without_reference_fill` | 9.02s | Public cached quotes with no reference fill |

Codex inspected ignored screenshots under `.local-tools/p2-shell` for mobile open, mobile closed, and desktop. No overflow was reported.

A subsequent desktop screenshot review found that the sidebar scrolled out of view. It now stays at the top of the viewport with viewport height. The rebuilt bundle is `/assets/index-G1TU7UL7.js`, 491.72 kB. The shell browser journey passed again in 9.87 seconds, including a new assertion that desktop navigation remains reachable after scrolling to the bottom. The four runs above retain their original bundle identity.

The full backend result of 190 passed and 1 skipped was recorded before this frontend-only unit. This note does not claim a new backend run. Backend CI wiring is accepted locally. GitHub execution of that workflow remains pending.

## Limits

Coverage is headless Chrome. Physical phones, Safari, Firefox, and screen readers were not run. The 632×324 case is a CSS reflow at 2× device scale, not native browser zoom.

Full P1-C provider ingestion and the exchange calendar remain gated. Performance history, watchlists, new research, and forecast widgets are not implemented. The next unblocked slice is recent orders from the existing bounded, owner-scoped `GET /orders/`, plus showing portfolio snapshot read time separately from quote observation time. That slice adds no order mutation, new API, or provider data.
