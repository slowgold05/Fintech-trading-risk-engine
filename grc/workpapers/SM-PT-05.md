# SM-PT-05 — Stock position-size limit

**Date:** 2026-10-30

**Owner:** Trading Operations (first line)

**Status:** Design tested; operating sample pending

The same pre-trade exposure calculation rejects a proposed stock buy above the configured fixed dollar cap, currently $50,000. It counts both existing holdings and open buy orders. The cap is independent of the percentage concentration setting.

The endpoint test `test_position_size_counts_open_orders_and_holdings` passed locally and in the [backend CI job](https://github.com/slowgold05/Fintech-trading-risk-engine/actions/runs/41132398593). It accepts a buy at the cap and rejects the next buy through both order and direct-trade endpoints. This verifies the design, not operating effectiveness in a deployed transaction population.

Capture and review a real or staged rejected buy after deployment. The fixed cap is a provisional product setting and needs owner approval before production use.
