# Market data pipeline

The public market surface uses three sources:

- Nasdaq Trader symbol-directory files provide the US-listed stock universe.
- SEC EDGAR company facts provide fundamentals for company research.
- Yahoo daily bars populate the quote cache; Alpha Vantage remains optional for research.

Quotes are persisted in `market_quote_cache`. The public heatmap endpoint never
refreshes providers during a request; it returns cached rows with an explicit
`live-ish`, `delayed`, `cached`, or `stale` status.
`quote_at` records the provider's trading date separately from `fetched_at`, so
re-fetching an old daily bar does not make it look current. Daily quotes stay
`delayed` for one calendar day, `cached` through day seven, and then `stale`.

## Initial setup

Apply the schema migration:

```powershell
python -m alembic upgrade head
```

Set a real contact address for SEC requests in `.env`:

```text
SEC_USER_AGENT=FintechRiskPlatform your-email@example.com
```

Sync the universe and refresh the first high-priority batch:

```powershell
python -m app.scripts.refresh_market_data --sync-universe --tier hot --source eod --limit 50
```

## Scheduled refreshes

Run these commands from Windows Task Scheduler, cron, or the deployment
platform's scheduler. The EOD worker fetches up to four symbols at a time.

```powershell
# Every 15 minutes, or as allowed by the quote provider
python -m app.scripts.refresh_market_data --tier hot --source eod --limit 50

# Daily rolling refresh for the broader universe
python -m app.scripts.refresh_market_data --tier daily --source eod --limit 1000

# Daily symbol-directory synchronization
python -m app.scripts.refresh_market_data --sync-universe --tier daily --source eod --limit 1000
```

Failed EOD symbols are reported individually and do not stop the rest of the refresh.
The configured 12-second delay applies only to the optional Alpha Vantage worker.
The refresh command exits with status 1 when any symbol fails. Run the
watchlist freshness control after the daily refresh:

```powershell
python -m app.scripts.check_market_data
```

It writes dated evidence under `grc/evidence/SM-MD-01/` and exits with status 1
if a hot-tier quote is missing or stale.

## Public endpoints

- `GET /market/universe?limit=100&offset=0`
- `GET /market/heatmap?limit=1000`
- `GET /market/research/{symbol}`

Heatmap prices are research data, not execution prices. The frontend displays
that delayed/cached state and falls back to its reference dataset until the
cache has been populated.
