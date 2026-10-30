# SM-LD-01 — Paper-account ledger integrity

**Date:** 2026-10-28
**Control owner:** Operations (first line)
**Status:** Provisional; independent review pending

## Risk and control

Paper-account cash or positions could be altered without a corresponding trade. New trades write balanced USD and asset-unit postings in the same database transaction as the fill. Each posting hashes its content and the prior account posting. MySQL and PostgreSQL migrations create triggers that reject ledger updates and deletes. The nightly test recomputes hashes, checks each event balances by unit, and reconciles ledger cash and positions to the current account tables.

## Test of design

Reviewed `app/services/ledger_service.py`, `app/routers/trades.py`, `app/routers/portfolio.py`, and migration `d4e82b5f9013`. A fresh MySQL schema was migrated through every revision with existing-style fractional lot data. Direct `UPDATE` and `DELETE` attempts against a ledger row were rejected by the triggers. Unit tests also altered a ledger amount and confirmed reconciliation failed. A property-based test now exercises buy, sell, and rejected-oversell sequences, checking cash, positions, and ledger reconciliation after each action.

## Test of operating effectiveness

Population: all 6 accounts in the local development database on 2026-10-28. Each account was given a labeled opening snapshot, then `python -m app.scripts.reconcile_ledger` checked all 6. Result: 6 checked, 0 failures. Evidence: `grc/evidence/SM-LD-01/cd954fa9b7e04acf8d1bb7ed85cec61c.json`, SHA-256 `d5893d56c2f6c33ec3657f37359af9e904fbe5d893ce75b56ea6e8489ec790a6`. A retest under the new app database role also checked 6 accounts with 0 failures: `grc/evidence/SM-LD-01/ac7282b330634e39a428af30eeecf2a0.json`, SHA-256 `d2b33ea40b7a8b3d530a188b8ff01cc4567bbabc1731f355628cf3b02fea5bda`. After the PostgreSQL copy on 2026-10-30, a new run checked all 8 accounts with 0 failures: `grc/evidence/SM-LD-01/31cf0dd0db794f4f80dc9dd3088e79ae.json`, SHA-256 `c07f450ae1be60a19a4c0528568b02c7b33f1a706978bff2ba3a424b485069e7`.

## Limits and follow-up

The 12 trades already in the database predate the opening snapshots and are outside hash-chain coverage. The local application now uses a separate role that cannot update ledger entries; deployment role setup remains. Schedule the nightly test and retain evidence in storage that the application cannot alter. This workpaper does not claim a production control is operating yet.
