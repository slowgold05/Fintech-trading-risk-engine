# Free market data sources

## Daily bars and quotes

With no Massive key and scheduled jobs enabled, the daily market step loads Yahoo Finance chart data for the S&P 500, the index and sector ETF proxies, and held or watched stock symbols. The loader starts with two calendar years and stops at the last NYSE session before the current New York date. Yahoo chart OHLC is split-adjusted and excludes dividends. Volume is the value returned by Yahoo. The job stores bars in `market_bars_daily` as `yahoo / split_adjusted`. When scheduled quotes also use Yahoo, the job can populate the quote cache from the same completed-session data.

```sh
python -m app.scripts.backfill_yahoo_history --refresh-quotes --symbols SPY QQQ DIA IWM AAPL
```

Omit `--symbols` for the full universe. A full refresh makes one paced request per due symbol and can take several minutes. Each symbol commits independently. Reruns skip symbols already at the target session and prioritize the oldest or missing histories. `--force` rechecks already-current symbols. Each refresh re-reads the stored window for split revisions and upserts changed observations. The loader retries transient failures and stops the run if Yahoo continues to throttle or requests a longer wait than the retry budget. Missing or flagged observations can leave gaps. `range=all` returns the series in the database.

The chart endpoint is unofficial, with no published quota or service guarantee for this use. Yahoo’s US terms require express prior permission for automated collection and restrict some redistribution and competing uses. Review the applicable terms and obtain the rights for your deployment. RSS display requires attribution, a link to the original article, and preservation of the feed content you display. [Yahoo Terms of Service](https://legal.yahoo.com/us/en/yahoo/terms/otos/index.html) · [Yahoo Finance data and delays](https://help.yahoo.com/kb/finance/article-exchanges-data-delays-sln2310.html) · [Yahoo’s adjusted close explanation](https://help.yahoo.com/kb/adjusted-close-sln28256.html)

## Choosing a stored series

History and indicators default to `provider=auto`. Keep sending `interval=1d`, a supported `range`, and the preferred `adjustment_type`. The response returns the provider and adjustment actually used, or null for both if no series has a usable bar. Explicit providers still request the exact adjustment and return their usual coverage. Automatic choice requires at least one valid observation fetched by the read time in the requested window. It uses this order:

1. Massive with the requested adjustment, then Massive with the other adjustment.
2. Yahoo split-adjusted, then Yahoo raw if present.
3. Other stored providers with the requested adjustment first. Ties use the latest usable date and then provider name.

The selected series supplies the entire window and can contain gaps. Data status reports observed counts, dates, and quality per stored provider and adjustment. The per-series calendar comparison checks the aggregate dates across all symbols. `scheduled_history_provider` describes scheduler configuration. `collection: disabled` describes collection during the read.

Portfolio performance and risk preserve Massive raw and the previous ambiguity handling for other raw history. When raw history is absent, they use the supported split-adjusted series in the same provider order. Performance and performance-derived risk report `split_adjusted_history_sources` when used. Historical values and P&L around splits can be approximate because the ledger retains the recorded share quantities. Market overview, heatmap, and research can use recent stored closes when their existing quote paths have no data. The fallback reports the source and adjustment, and its change measures the session open to close.

## Movers and news

Without an Alpha Vantage key, trending reports `featured_universe_cached_quotes` for the latest session date represented in the featured quote cache. It ranks available positive and negative quote changes and positive stored volume, up to eight entries per group, from that date only. Coverage depends on cached symbols. Yahoo quote changes measure open to close. With an Alpha Vantage key, trending keeps its existing provider feed.

Without a Finnhub key, market news uses Yahoo Finance RSS for SPY, QQQ, DIA, and IWM. Signed-in research news uses the requested symbol’s feed. Responses contain attributed headlines, original URLs, and publication times. The cache refreshes on request after two hours and can serve older headlines when the feed is unavailable. Public `as_of` is the newest cache fetch time.
