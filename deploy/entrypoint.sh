#!/bin/sh
set -eu
if [ "${RUN_DB_SETUP:-false}" = "true" ]; then
  python -m alembic upgrade head
  python -m app.scripts.configure_postgres_role
fi
exec python -m uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
