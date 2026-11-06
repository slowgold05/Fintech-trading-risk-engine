# Frontend audit

Audit of the React client at commit `be8ffdc19f78d2942b5e9922ce605d6a5de7d472` on 2026-11-05. Routes below include the public-dashboard entry from pull request #15.

This is not browser acceptance. No browser automation tool was connected. Checks are source inspection, Vitest with jsdom, a local production build, and a static comparison with the hosted JavaScript bundle. Viewports were not exercised.

## Stack

`frontend/package.json` has React 19.1, TypeScript, Vite 7, Tailwind 3.4, TanStack Query 5, React Router 7, and Axios. It does not depend on a chart library. The API base is `VITE_API_BASE_URL`, or `http://127.0.0.1:8000` when that variable is unset (`frontend/src/api/client.ts`). The hosted image is built with `VITE_API_BASE_URL=/api` (`frontend/nginx.aws.conf` proxies `/api/` to FastAPI and strips the prefix).

## Route inventory

Defined in `frontend/src/App.tsx`.

| Path | Signed out | Signed in | Page component |
| --- | --- | --- | --- |
| `/` | `Home` public market dashboard. A `Navigate` to `/dashboard` is declared, and it runs only when the parent renders an outlet | `AppShell` outlet. The index route redirects to `/dashboard` | `Home` or `Dashboard` |
| `/dashboard` | `Home`. The private `Dashboard` is not mounted | `AppShell` plus `Dashboard` | `pages/Home.tsx` or `pages/Dashboard.tsx` |
| `/market` | `Home` | `Home` | `pages/Home.tsx` |
| `/login` | `Login` | Redirects away once a token exists | `pages/Login.tsx` |
| `/trades` | `ProtectedRoute` sends the user to `/login` | `AppShell` plus `Trades` | `pages/Trades.tsx` |
| `/portfolio` | Login redirect | `AppShell` plus `Portfolio` | `pages/Portfolio.tsx` |
| `/risk` | Login redirect | `AppShell` plus `Risk` | `pages/Risk.tsx` |
| `/compliance` | Login redirect | `AppShell` plus `Compliance` | `pages/Compliance.tsx` |

`DashboardEntry` chooses `AppShell` when `isAuthenticated` is true and `Home` otherwise. While session restore is pending, `/` and `/dashboard` still render `Home`. `ProtectedRoute` shows "Restoring session..." until initialization finishes, then redirects anonymous users to `/login` and keeps `state.from`.

There is no account-settings route, no watchlist route, and no separate administration shell. Compliance is one protected page.

### Hosted bundle versus this commit

On 2026-11-05 the hosted document at `/` loaded `/assets/index-BM-PutKc.js`. That file contains `Market Research Console` and `Public research view`, and the sign-in label `Sign in`. It does not contain `Market dashboard`, `Public dashboard`, or `Log in`.

The local production build from this commit, `frontend/dist/assets/index-CihlNHv5.js`, contains `Market dashboard`, `Public dashboard`, and `Log in`, and does not contain `Market Research Console`.

The public-dashboard entry is therefore implemented in this commit and is not what the hosted bundle serves. The hosted shell still has a public research page. This task did not execute that hosted page in a browser, so the hosted click path is unverified.

## Authentication and roles

`AuthProvider` (`frontend/src/context/AuthContext.tsx`) calls `POST /auth/refresh` on load. Success stores the access token in memory and on the Axios client. Failure leaves the token empty. The access token is not written to `localStorage` by this provider.

A 401 on a request other than login or refresh tries `POST /auth/refresh` once. If that fails, the client clears the token and calls the unauthorized handler. The handler sets React token state to null. It does not assign `window.location`. `frontend/src/api/client.test.ts` covers a 401 from `/auth/refresh` on path `/` and asserts that `location.assign` is not called. That is a unit test of the client, not an expired-session walk through protected pages.

After the token is cleared, `ProtectedRoute` redirects `/trades`, `/portfolio`, `/risk`, and `/compliance` to `/login`. `/`, `/dashboard`, and `/market` stay on `Home`.

`App.test.tsx` covers, with mocked market calls and a mocked account dashboard:

- Signed-out `/` and `/dashboard` show the heading "Market dashboard" and a "Log in" link to `/login`, and they do not mount the account dashboard.
- The same public heading stays up while `isInitializing` is true.
- Signed-in `/` and `/dashboard` show the account dashboard.
- Signed-out `/portfolio`, `/trades`, `/risk`, and `/compliance` show the sign-in form.
- Clicking "Log in" from the public page shows the sign-in form.

Roles come from `GET /auth/me`. The database allows `trader`, `analyst`, `compliance_officer`, `admin`, and `auditor`.

`AppShell` navigation:

| Item | Who sees the link |
| --- | --- |
| Market `/market`, Dashboard `/dashboard`, Portfolio `/portfolio`, Risk `/risk` | Every signed-in user |
| Trades `/trades` | `role === "trader"` |
| Compliance `/compliance` | `compliance_officer`, `admin`, or `auditor` |

The route table is wider than the nav. Any signed-in role can open `/trades` by URL. Order and immediate-trade mutations return 403 unless the role is trader. Any signed-in role can open `/compliance` by URL. The API then returns 403 for roles outside the compliance set, and the page shows that error. Analysts have no trades link and no compliance link.

The shell also shows the static label "System live". That label is not a health check.

Login collects register, password login, authenticator challenge, and enrollment (`pages/Login.tsx`). `Login.test.tsx` covers two mocked login results. A hosted login was not performed.

## Page data and states

### Public `Home`

Calls, all with `retry: false` and a five-minute refetch on the first three:

| Client function | Method and path |
| --- | --- |
| `fetchMarketOverview` | `GET /market/overview` |
| `fetchMarketTrending` | `GET /market/trending` |
| `fetchMarketHeatmap` | `GET /market/heatmap?limit=1000` |
| `fetchMarketResearch` | `GET /market/research/{symbol}` |

The header link reads "Log in" and points to `/login` when signed out, and "Open dashboard" to `/dashboard` when signed in. A second "Get started" link also points to `/login`.

Loading: the pulse chip says "Loading" while the overview query is loading. The heatmap and trending areas have their own loading branches.

Empty and error: if overview, trending, or research is in error, or any of those three payloads is still absent, `isFallbackMarket` is true. The page then shows an amber notice: "Some live market data is unavailable or rate-limited. Showing fallback rows where needed." Missing overview trends are replaced by `marketTrends` in `frontend/src/features/publicMarket/marketSnapshot.ts`. Missing movers use `fallbackTrending`. Missing research uses `fallbackResearch`. Sectors always start from `sectorHeatmap` and overlay API rows by symbol. The stock heatmap always starts from `stockHeatmapUniverse` and overlays cached items.

Those fallback arrays are authored numbers. Examples include SPX `5487.03`, NVDA `143.85`, and a research market cap of `3500000000000`. The research description says "Research snapshot placeholder." They are not observed market history. `dashboardMockData` in `frontend/src/features/dashboard/mockData.ts` holds another authored book, including portfolio value `2483920`. Nothing imports that object, so the current pages do not render it.

The pulse chip says "Live" when none of the three queries is in the fallback condition. The heatmap can still contain authored tiles for symbols the cache did not return. The chip does not mean every number on the page came from the API.

Timeframe buttons `1D`, `1W`, `1M`, `3M`, and `6M` multiply `change_percent` by `1`, `2.4`, `5.2`, `9.5`, and `14`. The sparkline is a sine and cosine drawn from the symbol text. Those pictures are generated decoration. They are not daily bars.

### Signed-in `Dashboard`

| Query | Client path | Empty / error |
| --- | --- | --- |
| Portfolio | `GET /portfolio/` | Error contributes to the "Degraded" chip and the rose banner |
| Portfolio P&L | `GET /portfolio/pnl` | `retry: false`. The server has no such route. The chart falls back to interpolation |
| Trades | `GET /trades/` | Skeleton, then an empty state |
| Risk | `GET /risk/` | The score falls back to 0 and the label "No activity" when the list is empty |

Quick trade submits `POST /trades/` with an idempotency key. That is the immediate-fill route, not `POST /orders/`. The success toast reports `risk_score`.

`getPortfolioChartPoints` uses `pnl.points` when present. Otherwise it draws five labels, `Cost`, `25%`, `50%`, `75%`, and `Gain` or `Loss`, by splitting the distance from cost basis to account value into four equal steps (`frontend/src/features/dashboard/adapters.ts`). That line is not a valuation history. The portfolio card still shows the chip "Real 1D".

The same fallback mislabels total return as a daily figure. `getDayPnl` returns `summary.total_pnl`, realized plus unrealized. `getDayPnlPercent` divides that total by `total_cost_basis`. `Dashboard.tsx` uses those values whenever `/portfolio/pnl` has no `daily_pnl`. The tiles are labeled "Day P&L" and "Day change", and the subtitle says "daily change".

Bulk portfolio pricing does not fix either display. The five-point curve and the daily labels stay wrong until a separate UI change stops treating total P&L as a one-day move and stops drawing the interpolated series.

When portfolio, trades, and risk queries succeed, the page chip says "Live" even if the chart is interpolated and `/portfolio/pnl` failed. The P&L query is not part of `hasDashboardError`.

### `Trades`

Loads `GET /trades/` and `GET /orders/`. Submit uses `POST /orders/` with an idempotency key. Cancel uses `POST /orders/{id}/cancel`. Loading uses skeletons. Errors use toasts and an error panel. An empty trade list uses `EmptyState`. The page does not read the order book route.

### `Portfolio`

Loads `GET /auth/me`, `GET /portfolio/`, and `GET /portfolio/pnl`. Cash deposit and withdrawal use `POST /cash/movements` with an idempotency key and an optional `X-Step-Up-Code`. Legal name uses `PUT /auth/name`. Loading uses skeletons. Portfolio error is an error panel. No holdings uses `EmptyState`. When `/portfolio/pnl` fails, the copy says detailed P&L is unavailable and the summary from `/portfolio` is shown. Nothing in the client calls `POST /portfolio/reset`.

### `Risk`

Loads `GET /risk/`. Loading, error, and empty assessments each have a branch. The page does not call `GET /risk/trade/{trade_id}`.

### `Compliance`

Loads the compliance reads listed in `frontend/src/api/compliance.ts`: trading halt and events, controls, risks, role changes and requests, access review, surveillance rules and cases, AML rules and cases, incidents, KRIs, findings, risk brief, and intents. Mutations wired in the page are halt update, role request and approval, access review, surveillance and AML activation request and approval, incident open, and intent approval. A 403 on the controls query is shown as an access error. Other section errors replace that section with an error state. `Compliance.test.tsx` and `ComplianceActions.test.tsx` mock the API for an auditor and an admin. They do not open the hosted console.

The client does not call surveillance or AML reject, case close, manual scan, SAR draft, or intent creation.

## Automated tests and the build

From `frontend/` on this commit:

| Command | Result |
| --- | --- |
| `npm ci` | Exit 0. 352 packages added. Reported 7 moderate vulnerabilities. No audit fix was applied |
| `npm run lint` | Exit 0 |
| `npm test` | Vitest 4.1.12. 7 files, 19 tests passed |
| `npm run build` | Exit 0. Chunk-size warning. Asset `dist/assets/index-CihlNHv5.js` |

Test files: `format.test.ts` (2), `client.test.ts` (1), `RiskBadge.test.tsx` (2), `Login.test.tsx` (2), `ComplianceActions.test.tsx` (1), `Compliance.test.tsx` (2), `App.test.tsx` (9).

## What a later browser pass still has to do

Signed-out `/` and `/dashboard` on the deployed host, the top-right control, `/market`, a signed-in dashboard, an expired session on a protected page, and a trader opening `/compliance`. Desktop and a narrow viewport. Confirm fallback copy when the API fails, and confirm the interpolated chart is not presented as history. Record the URL, the bundle name, and the viewport.
