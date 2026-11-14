# SM-PT-04 — Trade-entry retry deduplication

**Date:** 2026-10-29
**Control owner:** Trading Operations (first line)
**Status:** Design tested. One hosted retry left a single open order on 2026-11-03. The control runner has not recorded that population.

## Risk and control

A client may retry after a timeout even when its first order or direct trade succeeded. Both write endpoints require an `Idempotency-Key` scoped to the authenticated user. The key is reserved in `order_requests` before execution, and the response commits in the same transaction. A retry with the same payload returns that response; a different payload with the same key returns `409`.

## Test of design

Reviewed the unique constraint on `(user_id, idempotency_key)`, `app/services/idempotency.py`, and the two write routes. Automated endpoint tests verify that a repeated order or direct trade does not create a second record, that changed payloads are rejected, and that a missing key is rejected. The database check detects missing committed responses or a missing unique constraint.

## Test of operating effectiveness

The latest local control run checked zero committed request records and found the unique constraint present. It correctly reported `no_sample`: `grc/evidence/SM-PT-04/02874363272f4e479585faf2a00fc689.json`, SHA-256 `e4fa34f9af602efaed86cfe9e86d0249aa5d0402750793594163da2007a6c036`. This is not evidence that a live retry occurred. On 2026-11-03 hosted NVDA order 1, a one-share buy at $184.18, was submitted twice with the same idempotency key. The account's order list contained that one open order after the retry. Both HTTP responses were 500 because the running image raises after a successful rate-limited write. The list is the evidence that the retry did not create a second order. The control runner still has to see a committed response before SM-PT-04 can pass.

## Limits and follow-up

Capture a real or staged order and retry in the deployed environment, then rerun the control with a nonzero population. Monitor direct database writes and keep the app login's order-request grants scoped. The control cannot prove that every external client keeps the same key across a network timeout.
