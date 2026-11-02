# SM-PT-01 — Audited trading halt

**Date:** 2026-10-30

**Owner:** Trading Operations (first line)

**Status:** Design tested; operating sample pending

Admins can activate or release the halt with a reason through `/compliance/trading-halt`. Both order and direct-trade entry lock the same singleton state row before execution, so an admin transition waits for an in-flight entry transaction. Cancellations remain available. PostgreSQL and MySQL triggers append each state transition to `trading_halt_events`; update and delete are rejected on that history table. The configured `TRADING_HALTED=true` remains an emergency override that requires a process restart to clear.

Endpoint tests cover admin-only writes, reason validation, repeat requests, blocked new trades and orders, cancellation, and resumption. A rollback-only PostgreSQL app-role update generated one transition event and left no committed change. The daily control compares the ordered event chain with the current state and checks for an actor and reason. With no committed transitions, it reports `no_sample` rather than claiming operating effectiveness.

Capture a real or staged admin halt and resumption in the deployment environment, verify the event chain and blocked entries, and archive evidence outside the host. The application database login can update the state directly but cannot edit committed events; privileged database operators can alter triggers and need independent monitoring.
