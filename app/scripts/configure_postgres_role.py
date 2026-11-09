"""Apply the app's least-privilege PostgreSQL grants after Alembic migrations."""

import os

import psycopg
from sqlalchemy.engine import make_url


def configure(database_url: str, app_password: str) -> None:
    url = make_url(database_url)
    if url.get_backend_name() != "postgresql" or not app_password:
        raise ValueError("A PostgreSQL migration URL and app password are required")
    with psycopg.connect(host=url.host, port=url.port, dbname=url.database,
                         user=url.username, password=url.password,
                         sslmode=url.query.get("sslmode", "prefer")) as connection:
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
                           "price_history, price_history_daily, market_bars_daily, refresh_tokens, risk_alerts, "
                           "risk_assessments, trades TO fintech_app")
            cursor.execute("GRANT INSERT ON ledger_entries TO fintech_app")
            cursor.execute("GRANT INSERT (email, password_hash, cash_balance, full_name) ON users TO fintech_app")
            cursor.execute("GRANT UPDATE (cash_balance, full_name) ON users TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE ON order_requests TO fintech_app")
            cursor.execute("GRANT INSERT (target_user_id, old_role, old_change_id, new_role, reason, requested_by_user_id) "
                           "ON role_change_requests TO fintech_app")
            cursor.execute("GRANT UPDATE (status, approved_by_user_id, approved_at) "
                           "ON role_change_requests TO fintech_app")
            cursor.execute("GRANT INSERT ON access_reviews TO fintech_app")
            cursor.execute("GRANT UPDATE (halted, actor_user_id, reason, changed_at) ON trading_halt_state TO fintech_app")
            cursor.execute("GRANT INSERT ON trading_halt_events TO fintech_app")
            cursor.execute("GRANT INSERT ON control_evidence TO fintech_app")
            cursor.execute("GRANT INSERT (rule_id, version, reason, requested_by_user_id) "
                           "ON surveillance_activations TO fintech_app")
            cursor.execute("GRANT UPDATE (status, approved_by_user_id, approved_at) "
                           "ON surveillance_activations TO fintech_app")
            cursor.execute("GRANT INSERT (rule_id, rule_version, subject_user_id, symbol, event_ids, summary, due_at, opened_at) "
                           "ON surveillance_cases TO fintech_app")
            cursor.execute("GRANT UPDATE (status, disposition, close_reason, closed_at, closed_by_user_id) "
                           "ON surveillance_cases TO fintech_app")
            cursor.execute("GRANT INSERT (user_id, method, secret_ciphertext) ON mfa_factors TO fintech_app")
            cursor.execute("GRANT UPDATE (secret_ciphertext, confirmed_at, last_counter) ON mfa_factors TO fintech_app")
            cursor.execute("GRANT INSERT (user_id, email, ip, user_agent_hash, outcome, risk_score, step_up_satisfied, reasons, created_at) "
                           "ON login_events TO fintech_app")
            cursor.execute("GRANT INSERT (user_id, expires_at, risk_score, reasons) ON login_challenges TO fintech_app")
            cursor.execute("GRANT UPDATE (consumed_at) ON login_challenges TO fintech_app")
            cursor.execute("GRANT INSERT ON sanctions_screens TO fintech_app")
            cursor.execute("GRANT INSERT (user_id, kind, amount, screening_id) ON cash_movements TO fintech_app")
            cursor.execute("GRANT INSERT (rule_id, version, reason, requested_by_user_id) ON aml_activations TO fintech_app")
            cursor.execute("GRANT UPDATE (status, approved_by_user_id, approved_at) ON aml_activations TO fintech_app")
            cursor.execute("GRANT INSERT (rule_id, rule_version, subject_user_id, event_ids, summary, due_at, opened_at) "
                           "ON aml_cases TO fintech_app")
            cursor.execute("GRANT UPDATE (status, disposition, close_reason, closed_at, closed_by_user_id) ON aml_cases TO fintech_app")
            cursor.execute("GRANT INSERT (title, severity, summary, discovered_at, customer_notice_due_at, opened_by_user_id) "
                           "ON incidents TO fintech_app")
            cursor.execute("GRANT UPDATE (status, customer_notified_at, notified_by_user_id, closed_by_user_id, closed_at) "
                           "ON incidents TO fintech_app")
            cursor.execute("GRANT INSERT (case_kind, case_id, event_ids, narrative, created_by_user_id) ON sar_drafts TO fintech_app")
            cursor.execute("GRANT INSERT (symbol, side, quantity, reference_price, rationale, confidence, data_used, "
                           "status, rejection_reason, proposed_by, created_at) ON trade_intents TO fintech_app")
            cursor.execute("GRANT UPDATE (status, decided_by_user_id, decided_at) ON trade_intents TO fintech_app")
            cursor.execute("GRANT INSERT (control_id, severity, owner, summary, status, due_at, opened_at) ON findings TO fintech_app")
            cursor.execute("GRANT UPDATE (status) ON findings TO fintech_app")
            cursor.execute("GRANT INSERT (brief_date, body, figures, created_at) ON risk_briefs TO fintech_app")
            cursor.execute("GRANT INSERT (kind, summary, evidence_ref, created_at) ON expansion_alerts TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE ON detection_cursors TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE ON scheduler_locks TO fintech_app")
            cursor.execute("GRANT INSERT, UPDATE, DELETE ON watchlists, watchlist_items TO fintech_app")
            # Filings helper inserts a row (Python source default sec_edgar is
            # emitted) and later refreshes cik, payload, and fetched_at only.
            cursor.execute(
                "GRANT INSERT (symbol, cik, payload, source, fetched_at) "
                "ON market_filings_cache TO fintech_app"
            )
            cursor.execute(
                "GRANT UPDATE (cik, payload, fetched_at) ON market_filings_cache TO fintech_app"
            )
            # Research and forecast writers. SQLAlchemy INSERT lists every mapped
            # column without a server default, including nullable columns left as
            # None (research error/token/duration fields and forecast error_message).
            # Routes insert queued jobs and cancel only status/updated_at. Workers
            # update those plus error_message and research token/duration columns,
            # then insert one report or result. Briefs and evaluations are insert-only.
            # Identity and timestamp server defaults stay omitted.
            cursor.execute(
                "GRANT INSERT (user_id, symbol, status, error_message, prompt_tokens, "
                "completion_tokens, duration_ms) ON research_jobs TO fintech_app"
            )
            cursor.execute(
                "GRANT UPDATE (status, updated_at, error_message, prompt_tokens, "
                "completion_tokens, duration_ms) ON research_jobs TO fintech_app"
            )
            cursor.execute(
                "GRANT INSERT (job_id, user_id, symbol, sources, bull_case, bear_case, "
                "synthesis, risks, model_version, prompt_version, backend_detail) "
                "ON research_reports TO fintech_app"
            )
            cursor.execute(
                "GRANT INSERT (user_id, brief_date, entries) ON research_briefs TO fintech_app"
            )
            cursor.execute(
                "GRANT INSERT (user_id, symbol, provider, adjustment_type, lookback, "
                "horizon, sample_count, status, error_message) ON forecast_jobs TO fintech_app"
            )
            cursor.execute(
                "GRANT UPDATE (status, updated_at, error_message) ON forecast_jobs TO fintech_app"
            )
            cursor.execute(
                "GRANT INSERT (job_id, user_id, symbol, provider, adjustment_type, "
                "model_name, tokenizer_name, lookback, horizon, sample_count, "
                "input_cutoff, generated_at, bars) ON forecast_results TO fintech_app"
            )
            cursor.execute(
                "GRANT INSERT (symbol, provider, adjustment_type, horizon, window_count, "
                "model_mae, model_directional_accuracy, baseline_type, baseline_mae, "
                "baseline_directional_accuracy, weights_exercised, notes) "
                "ON forecast_evaluations TO fintech_app"
            )


def main() -> None:
    password = os.environ.get("POSTGRES_APP_PASSWORD")
    if not password:
        password = make_url(os.environ["DATABASE_URL"]).password
    configure(os.environ["MIGRATION_DATABASE_URL"], password)
    print("PostgreSQL app role configured")


if __name__ == "__main__":
    main()
