import pytest
from uuid import uuid4
from pydantic import ValidationError
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.dialects import postgresql

from app.core.config import Settings


@pytest.mark.parametrize("secret", ["change_me", "too-short"])
def test_weak_jwt_secret_is_rejected(secret):
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="sqlite://", jwt_secret=secret)


def test_missing_jwt_secret_is_rejected(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(ValidationError):
        Settings(_env_file=None, database_url="sqlite://")


def test_trade_locks_account_before_changing_balances(db_session, client, auth_headers, monkeypatch):
    headers = auth_headers()
    original_execute = db_session.execute
    locks = []

    def capture_execute(statement, *args, **kwargs):
        if getattr(statement, "_for_update_arg", None) is not None:
            locks.append(str(statement.compile(dialect=postgresql.dialect())))
        return original_execute(statement, *args, **kwargs)

    monkeypatch.setattr(db_session, "execute", capture_execute)
    response = client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1},
    )
    assert response.status_code == 200, response.text
    assert any("FROM users" in sql and "FOR UPDATE" in sql for sql in locks)


@pytest.mark.parametrize(
    "table,column",
    [
        ("users", "cash_balance"),
        ("holdings", "quantity"),
        ("lots", "qty_remaining"),
    ],
)
def test_database_rejects_negative_balances(db_session, client, auth_headers, table, column):
    headers = auth_headers()
    response = client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": 1},
    )
    assert response.status_code == 200, response.text

    with pytest.raises(IntegrityError):
        db_session.execute(text(f"UPDATE {table} SET {column} = -1"))
        db_session.commit()
    db_session.rollback()
