"""Apply the app's least-privilege PostgreSQL grants after Alembic migrations."""

import os

import psycopg
from sqlalchemy.engine import make_url


def configure(database_url: str, app_password: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql" or not app_password:
        raise ValueError("A PostgreSQL migration URL and app password are required")
    with psycopg.connect(host=url.host, port=url.port, dbname=url.database,
                         user=url.username, password=url.password) as connection:
        with psycopg.ClientCursor(connection) as cursor:
            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = 'fintech_app'")
            if cursor.fetchone():
                cursor.execute("ALTER ROLE fintech_app LOGIN PASSWORD %s", (app_password,))
            else:
                cursor.execute("CREATE ROLE fintech_app LOGIN PASSWORD %s", (app_password,))
            cursor.execute("REVOKE ALL ON SCHEMA public FROM PUBLIC")
            cursor.execute("GRANT USAGE ON SCHEMA public TO fintech_app")
            cursor.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM fintech_app")
            cursor.execute("REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM fintech_app")
            cursor.execute("GRANT SELECT ON ALL TABLES IN SCHEMA public TO fintech_app")
            cursor.execute("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE, DELETE ON assets, holdings, lots, "
                           "market_fundamentals_cache, market_quote_cache, market_symbols, orders, "
                           "price_history, price_history_daily, refresh_tokens, risk_alerts, "
                           "risk_assessments, trades TO fintech_app")
            cursor.execute("GRANT INSERT ON ledger_entries TO fintech_app")
            cursor.execute("GRANT INSERT (email, password_hash, cash_balance) ON users TO fintech_app")
            cursor.execute("GRANT UPDATE (cash_balance) ON users TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE ON order_requests TO fintech_app")
            cursor.execute("GRANT INSERT (target_user_id, old_role, old_change_id, new_role, reason, requested_by_user_id) "
                           "ON role_change_requests TO fintech_app")
            cursor.execute("GRANT UPDATE (status, approved_by_user_id, approved_at) "
                           "ON role_change_requests TO fintech_app")
            cursor.execute("GRANT INSERT ON access_reviews TO fintech_app")


def main() -> None:
    configure(os.environ["MIGRATION_DATABASE_URL"], os.environ["POSTGRES_APP_PASSWORD"])
    print("PostgreSQL app role configured")


if __name__ == "__main__":
    main()
