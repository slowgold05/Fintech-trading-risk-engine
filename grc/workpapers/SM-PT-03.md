# SM-PT-03 — Stock concentration limit

**Date:** 2026-10-30

**Owner:** Trading Operations (first line)

**Status:** Design tested; operating sample pending

The shared pre-trade check calculates single-symbol exposure from holdings, open buy orders, and the proposed stock buy. It compares that exposure with account equity under the configured 50% cap. Both order entry paths call the check while the account row is locked.

The endpoint test `test_concentration_counts_open_buys_and_existing_holdings` passed locally and in the [backend CI job](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41132398593). The test covers an open order, cancellation, a direct fill, and a subsequent blocked buy. This verifies the design, not operating effectiveness in a deployed transaction population.

Capture and review a real or staged rejected buy in the eventual hosted environment. Other holdings use book cost when a usable quote is unavailable; a stricter valuation policy remains open.
