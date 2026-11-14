# TradingAgents' own data vendors (yfinance, SEC EDGAR, FRED) — draft assessment

**Status:** Pending vendor-owner review. No SOC report is attached.

**Used by:** `app/services/research_tradingagents.py` constructs and runs the
third-party `TradingAgentsGraph` (pinned per
[P5F_TRADINGAGENTS_CONTRACT.md](../../docs/P5F_TRADINGAGENTS_CONTRACT.md))
when `research_tradingagents_enabled` is set. This app's own code does not
call any external data vendor for this feature — the library it runs does,
through its own internal `data_vendors`/`tool_vendors` configuration
(`tradingagents/default_config.py`), which defaults to **yfinance** (Yahoo
Finance via the `yfinance` package, not this app's existing
`price_service.py`/`market.py` Yahoo path), **SEC EDGAR directly** (not this
app's own `sec_service.py`), and **FRED** (not previously called by any
other part of this app). These are the library's own default, free, keyless
vendors — not something this task's own code configured or requested.

**Data shared:** Whatever the library's own HTTP clients send by default
(typically the ticker/date range being researched, plus library-default
User-Agent/headers). This was not independently inspected line by line
inside the pinned third-party package; this entry discloses that the calls
exist and go through code this app does not control, not that their exact
request shape was audited.

**Criticality:** Low to the trading/accounting core — TradingAgents never
reaches order placement, cash movement, or the ledger
([P5F_TRADINGAGENTS_CONTRACT.md](../../docs/P5F_TRADINGAGENTS_CONTRACT.md)).
Relevant only to the optional AI research-synthesis path, and only when
`research_tradingagents_enabled` is on — same disclosed, off-by-default
boundary as the rest of Phase 5/6's optional AI backends.

**Concentration:** Depends on the pinned `tradingagents` package version's
own choice of default vendors. A future version bump could silently change
which vendors are called without this app's own code changing — the pin
itself is the only current control over this.

**Exit:** Set `tool_vendors`/`data_vendors` in the library's own config to
point at this app's existing cached data (Nasdaq/Yahoo-backed symbol and
history, Sentinel's own `sec_service.py`) instead of its defaults, or disable
`research_tradingagents_enabled`. Overriding the library's data-vendor layer
is explicitly out of scope for the Phase 5 unit that shipped this feature —
see the "Does not override" line in
[P5F_TRADINGAGENTS_VERIFICATION.md](../../docs/P5F_TRADINGAGENTS_VERIFICATION.md)
— and remains a real, scoped follow-up, not done here either.

**Access review:** Not performed. Unlike this app's own direct Yahoo, SEC,
and Alpha Vantage calls (each separately reviewed in
[PROVIDER_ACCESS_REVIEW.md](../../docs/PROVIDER_ACCESS_REVIEW.md)), these
calls happen inside a pinned third-party package this task did not audit for
rate-limit compliance, terms of use, or request volume. Flagged here as a
gap discovered while writing Phase 6's own Hugging Face vendor entry; fixing
it means either the data-vendor override above, or a dedicated read of the
pinned `tradingagents` version's actual HTTP call sites — neither is done in
this entry.

**Approval:** Pending vendor-owner review.
