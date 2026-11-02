# SM-MD-01 — Watchlist quote freshness

**Date:** 2026-10-28
**Control owner:** Market Operations (first line)
**Status:** Provisional; independent review pending

## Risk and control

A cache refresh could make an old daily close appear current if the system uses fetch time as the quote timestamp. The cache now stores the provider's trading date separately. The daily control checks all active hot-tier symbols and fails when a quote is missing or its source date is more than seven calendar days old.

## Test of design

Reviewed `app/services/market_cache_service.py` and migration `e5f93c6a1024`. The migration recovered source dates for 953 existing Yahoo quotes from stored daily bars. All 953 were older than seven days and were marked stale. A unit test confirms that a quote fetched now remains stale when its source date is ten days old. The refresh worker exits nonzero on provider errors.

## Test of operating effectiveness

Population: all 83 active hot-tier symbols in the local development database on 2026-10-28. Initial run: 79 missing, 0 stale, and a nonzero exit. Evidence: `grc/evidence/SM-MD-01/3b7fe6ca310e4958a31346f3e03395d6.json`, SHA-256 `ac606db3b3ef26ff56b1ca037426bbd698a7e52d6684da62691e4798ae68a74b`.

Remediation: the EOD worker fetched the remaining 79 symbols successfully. Retest: 83 checked, 0 missing, 0 stale. Evidence: `grc/evidence/SM-MD-01/b6b75f4bc7064b4bb587e5dc4a7d0c38.json`, SHA-256 `7ada9f827fe791a5f767cef53a4ff404eb5bbc33fcc7e7206e77f5defcf2af47`.

## Limits and follow-up

The seven-day threshold is a calendar-day approximation for market closures; calibrate it with an exchange calendar. The broader daily-tier universe was not refreshed in this test. Schedule the worker and control, archive evidence outside this writable workspace, and have a second-line reviewer sign off before claiming continuous operation.
