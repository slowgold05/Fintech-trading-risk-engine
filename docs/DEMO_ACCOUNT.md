# Demo accounts

Open `/login` and choose **Try the demo**. The dashboard identifies the session as a demo and describes the prices used. With market data loaded, each plan starts from $100,000 in paper cash and builds six holdings across sectors with six buys and two partial sells. See dated fills in **Trades**, daily returns and attribution in **Portfolio**, and historical metrics in **Risk**.

## API

- `POST /auth/demo` takes an empty request and creates one fresh trader session. It returns a bearer access token, `is_demo: true`, an invented display name, `demo_seed_mode`, and a message describing the seed. It sets the same HTTP-only refresh cookie as password sign-in. Every successful call creates a new account. Demo passwords are random, discarded after hashing, and unavailable for sign-in.
- `GET /auth/me` returns `is_demo`, `display_name`, and `demo_seed_mode`. Demo trades in `GET /trades/` carry `demo_seed: true` and `seed_price` provenance. Portfolio and risk analytics expose the demo identity, and historical performance and risk include each price series' provider and adjustment.
- `POST /portfolio/reset` restores the original cash, positions, lots, and seed trade history for the same demo account. Cancel open orders before resetting. Send an `Idempotency-Key` to replay the response after an uncertain result. Reset appends a balanced reset and replays the account's saved fills. The portfolio and recent activity use the restored book, and the ledger retains earlier activity for audit.

Signup shares the authentication limit of five requests per minute per client IP. PostgreSQL also admits one seed transaction at a time and defaults to 200 successful demo signups per UTC day across workers. Set `DEMO_DAILY_LIMIT=0` to disable signup. A signup reads the market cache and commits the account, fills, postings and session together.

## Seed prices

The [seed plans](../app/services/demo_plans.json) describe buy weights, partial-sell fractions, and target dates as offsets from the UTC signup date. Plans rotate in order for successful signups on the same day. Targets use the latest stored session on or before the target within the seed window. If available history starts later, a buy can use that first session. A partial sell needs a later stored session than its buy. Sizing uses whole shares and available paper cash.

- **Historical** uses the actual stored close on each fill's effective session date. The seeder requests one canonical series per symbol using the [automatic provider order](FREE_DATA_SOURCES.md#choosing-a-stored-series), with raw as the preferred adjustment. The legacy daily cache is a fallback. Symbols without usable history are skipped. An alternate plan can supply coverage when the first plan yields no fills.
- **Cached quotes** uses up to three stored cached quotes when daily history is absent. The paper fills are dated today. The API preserves provider and quote observation time, which can be from an earlier session. The quote fallback adds no daily bars.
- **Cash only** is available when there are no eligible seed prices. It still provides a paper account and identifies the missing data in the response.

For local setup, run `python -m app.scripts.backfill_yahoo_history --refresh-quotes` to load quotes and daily bars in the app's configured database.

All seed fills use the shared fill service for buying power, available shares, FIFO lots, trade risk, and balanced ledger postings. They are imported paper activity and bypass live order admission and matching. The ledger hashes both the real recording time and the demo effective date. Demo performance reads the effective dates and uses the same price series as the seed for those holdings. A missing mark stays unavailable. The latest portfolio valuation uses the standard quote cache and freshness rules.

## Archive expired demos

Run the archive command periodically with the migration URL configured for the same database:

```sh
.venv/bin/python -m app.scripts.archive_demo_accounts --older-than-days 7
```

The age is measured from signup and defaults to seven days. Archiving invalidates bearer and refresh access and cancels open orders. Ledger postings are append-only and reference their account and trades, so archive keeps those rows in the database and they continue to consume storage. Apply [migration e462fc80a937](../alembic/versions/e462fc80a937_add_demo_accounts.py) and rerun the restricted-role grants before serving the route.

## Public header integration

Use `startDemo()` from `frontend/src/api/auth.ts`, pass the returned `access_token` to `useAuth().signIn`, and navigate to `/dashboard`. Disable the action during session restoration and while signup is in flight. Surface any signup error and show the action to signed-out visitors.
