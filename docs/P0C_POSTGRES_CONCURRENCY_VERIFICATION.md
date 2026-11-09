# Phase 0 gate — PostgreSQL concurrency and grants, closed

The "Gates that stay explicit" table in `docs/V2_BACKLOG.md` has carried
this row unresolved since the P0-A baseline: "Six tests skipped because
`AUDIT_DATABASE_URL` was unset and no disposable server was available." No
unit in this session had Docker access until the user started Docker
Desktop and a local Ollama instance on 2026-11-09 and said to proceed. This
closes the gate.

## What was run

A fresh, disposable `postgres:17` container, started and torn down
specifically for this check — **not** the user's own long-running
`fintechapp-postgres` container (port 5433), which holds real local
application data migrated from MySQL on 2026-10-30
([postgresql_migration.md](postgresql_migration.md)) and was never read
from, written to, or connected to by any command in this session:

```
docker run -d --name fintechapp-ci-disposable \
  -e POSTGRES_USER=ci_audit -e POSTGRES_PASSWORD=ci-only-test -e POSTGRES_DB=ci_audit \
  -p 127.0.0.1:5555:5432 postgres:17
```

These are the same plaintext credentials `.github/workflows/ci.yml` itself
uses for its own `postgres` service container (named `ci_audit`/
`ci-only-test` there too) — not a secret, already public in the repo's own
CI config, just run locally against a different port (5555, to avoid any
collision with the real dev container's 5433 or CI's own 5432/54331).

`AUDIT_DATABASE_URL=postgresql+psycopg://ci_audit:ci-only-test@127.0.0.1:5555/ci_audit`,
then `tests/test_audit_postgres.py` alone: **7 passed** — role-separation
grants (`SM-AC-01`), the role-change audit trigger (`SM-AC-02`), and two
real-thread concurrency tests asserting the detection-cursor lock correctly
serializes concurrent AML and surveillance scans so exactly one of two
racing scans opens a case, not both.

## A genuine false alarm caught and resolved before reporting this clean

The first attempt reused the same container across several manual pytest
invocations while investigating an unrelated CI failure earlier in this
session. On that **reused** container, the two concurrency tests failed
reproducibly (3/3 runs) with `assert [0, 2] == [0, 1]` — both racing scans
opened a case instead of one. This looked like a real concurrency bug in
the cursor-lock mechanism. Before reporting it as one, destroyed the
container and started a **completely fresh** one: the exact same test file
then passed 7/7, repeatably. Conclusion: this test file assumes a
single-use disposable database (exactly what CI provides — a brand-new
ephemeral container per job) and leaves residual rows (cases, cursor
state) behind after each run; reusing the same container across multiple
manual `pytest` invocations accumulates that state and breaks the test's
own dedup assumptions. **Not a product bug** — a reused-container test
artifact, caught by re-deriving the fresh-container baseline before
drawing a conclusion rather than reporting the first failing run. Anyone
repeating this check should always `docker rm -f` and recreate the
container before each verification run, never reuse one across runs.

## Full suite, same fresh container

Reran the entire backend suite with the same `AUDIT_DATABASE_URL` set, on
a freshly recreated container: **530 passed, 8 skipped** — down from the
usual 29 skipped with no `AUDIT_DATABASE_URL` set, confirming the six
previously-skipped Postgres-only tests this gate named now run and pass
(the remaining 8 skips are unrelated, pre-existing skips for other
reasons, e.g. optional heavy dependencies not installed in this venv).

## What remains open

This closes only the "PostgreSQL concurrency and grants" row. The other
five rows in the same gates table (disposable backup/restore, hosted
account reconciliation, authenticated browser journey, provider rights
review, hosted/local divergence) are unrelated to Postgres/Docker access
and remain exactly as open as before — they need a real browser session,
AWS/hosted credentials, or a provider terms-of-service review, none of
which changed with Docker/Ollama coming online.
