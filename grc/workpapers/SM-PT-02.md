# SM-PT-02 — Paper-order reference price band

**Date:** 2026-10-28
**Control owner:** Trading Operations (first line)
**Status:** Design tested; operating effectiveness and independent review pending

## Risk and control

An extreme or stale paper-order price could cause a bad simulated fill. Order entry requires a usable cached stock quote and rejects limit prices outside 80–120% of that quote. Matching checks the execution price again. The control runner inspects all currently open orders and reports any unusable reference or out-of-band price.

## Test of design

`tests/test_orders.py` covers both band edges, an out-of-band order, an eight-day-old quote, and an open order whose reference later becomes stale. It also verifies that the operational kill switch blocks new orders while cancellation remains available. The full backend suite passed on 2026-10-28.

## Test of operating effectiveness

The first local run found zero open orders and zero violations. Evidence: `grc/evidence/SM-PT-02/aae60ba115294c16aec07a4559f77d07.json`, SHA-256 `c0b6e16de8b00fa1cd8b36125b0cf8af12bbafc51737dd42d4bb9a343e049e4e`. The runner now labels this result `no_sample`; its latest run is `grc/evidence/SM-PT-02/53c9f2a338044b678b3bbb342f08aa1a.json`, SHA-256 `c6fc0bbd45939c1f51b8a7186a50104c737cfb440d317427ceffe810b4c91609`. With no open-order population, these runs do not establish operating effectiveness.

## Limits and follow-up

The seven-day quote threshold approximates market closures. The cached quote is delayed market data, and the 20% band is a project control setting that needs calibration. Retest with a representative order population, schedule the runner, archive evidence outside this writable workspace, and obtain second-line review.
