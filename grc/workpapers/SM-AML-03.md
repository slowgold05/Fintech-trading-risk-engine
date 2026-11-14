# SM-AML-03 — AML cases stay inside their SLA

**Date:** 2026-11-04
**Control owner:** Compliance (second line)
**Status:** Design tested. No hosted AML case population exists yet.

## Risk and control

Repeated paper cash movements can hide structuring or rapid movement. SM-AML-03 reads every AML case. It fails when an open case is past `due_at`, or when a closed case was closed after `due_at`. Zero cases is `no_sample`. R-20 points at this control. SM-AML-01 and SM-AML-02 are models. They are not substitutes for this check.

## Test of design

`tests/test_phase6_pack.py` starts from an empty book, which scores `no_sample`, then inserts one open case due an hour earlier. The check reports `violation_count` 1 and status `fail`. `tests/test_phase5_aml.py` shows that three $4,000 deposits open no case until a second reviewer activates SM-AML-01. The requester cannot approve that request. The labeled backtest does not write cases.

## Test of operating effectiveness

There is no hosted AML case. The control has not been run against the Lightsail database. A pass requires a population of cases that were all closed on time. An empty book must stay `no_sample`.

## Sample

The design sample is one inserted case in sqlite. It was not selected from production. There is no production population.

## Limits and follow-up

The check does not judge whether a disposition was correct. Deploy migrations `c4d8e1a7b936` and `d5e9f2b8c047` before this control can see hosted rows. Re-run `python -m app.scripts.configure_postgres_role` after those migrations. Do not run that grant script against the hosted database until a deploy is requested.
