"""Copy the existing MySQL app data into an Alembic-migrated PostgreSQL database."""

import os
from datetime import date, datetime
from decimal import Decimal
from hashlib import sha256
import json

from sqlalchemy import Boolean, MetaData, Numeric, create_engine, func, select, text

from app.core.config import settings


TABLES = (
    "users", "assets", "market_symbols", "market_fundamentals_cache",
    "market_quote_cache", "price_history", "price_history_daily", "holdings",
    "lots", "orders", "trades", "ledger_entries", "risk_assessments",
    "risk_alerts", "refresh_tokens", "role_changes", "role_change_requests",
    "access_reviews", "order_requests",
)


def _digest(connection, table, target_columns) -> str:
    digest = sha256()
    records = []
    for row in connection.execute(select(table)):
        values = []
        for column, value in zip(target_columns, row):
            if isinstance(column.type, Boolean) and value is not None:
                value = bool(value)
            elif isinstance(column.type, Numeric) and value is not None:
                value = str(Decimal(str(value)))
            elif isinstance(value, (datetime, date)):
                value = value.isoformat()
            elif isinstance(value, bytes):
                value = value.hex()
            values.append(value)
        records.append(json.dumps(values, default=str, separators=(",", ":")))
    for record in sorted(records):
        digest.update(record.encode())
        digest.update(b"\n")
    return digest.hexdigest()


def copy_data(source_engine, target_engine) -> dict[str, int]:
    source = MetaData()
    target = MetaData()
    source.reflect(bind=source_engine)
    target.reflect(bind=target_engine)
    expected = set(TABLES) | {"alembic_version"}
    if set(source.tables) != expected or set(target.tables) != expected:
        raise ValueError("Source and target tables must match the expected migrated schema")
    if source_engine.dialect.name != "mysql" or target_engine.dialect.name != "postgresql":
        raise ValueError("Expected a MySQL source and PostgreSQL target")

    counts = {}
    with source_engine.connect() as source_conn, target_engine.begin() as target_conn:
        for name in TABLES:
            if list(source.tables[name].columns.keys()) != list(target.tables[name].columns.keys()):
                raise ValueError(f"Column mismatch: {name}")
            if target_conn.scalar(select(func.count()).select_from(target.tables[name])):
                raise ValueError(f"Target table is not empty: {name}")

        # shortcut: the current source has no request-linked role changes; add a deferred FK migration if that changes.
        if source_conn.scalar(select(func.count()).select_from(source.tables["role_changes"]).where(
            source.tables["role_changes"].c.request_id.is_not(None)
        )):
            raise ValueError("Request-linked role changes need a deferred PostgreSQL foreign key")

        for name in TABLES:
            source_table = source.tables[name]
            target_table = target.tables[name]
            batch = []
            for row in source_conn.execute(select(source_table).order_by(*source_table.primary_key.columns)):
                batch.append(dict(row._mapping))
                if len(batch) == 500:
                    target_conn.execute(target_table.insert(), batch)
                    batch.clear()
            if batch:
                target_conn.execute(target_table.insert(), batch)
            counts[name] = target_conn.scalar(select(func.count()).select_from(target_table))
            if counts[name] != source_conn.scalar(select(func.count()).select_from(source_table)):
                raise ValueError(f"Row count mismatch: {name}")
            if _digest(source_conn, source_table, target_table.columns) != _digest(
                target_conn, target_table, target_table.columns
            ):
                raise ValueError(f"Data mismatch: {name}")

            for column in target_table.primary_key.columns:
                sequence = target_conn.scalar(text("SELECT pg_get_serial_sequence(:table, :column)"),
                                              {"table": name, "column": column.name})
                if sequence:
                    maximum = target_conn.scalar(select(func.max(column)))
                    target_conn.execute(text("SELECT setval(CAST(:sequence AS regclass), :value, :called)"),
                                        {"sequence": sequence, "value": maximum or 1, "called": maximum is not None})
    return counts


def main() -> None:
    source_url = os.environ.get("SOURCE_DATABASE_URL") or settings.database_url
    target_url = os.environ["TARGET_DATABASE_URL"]
    source_engine = create_engine(source_url)
    target_engine = create_engine(target_url)
    try:
        counts = copy_data(source_engine, target_engine)
    finally:
        source_engine.dispose()
        target_engine.dispose()
    print(json.dumps({"tables": len(counts), "rows": sum(counts.values()), "counts": counts}, sort_keys=True))


if __name__ == "__main__":
    main()
