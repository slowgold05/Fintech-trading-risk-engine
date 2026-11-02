from collections.abc import Callable
import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

os.environ.setdefault("JWT_SECRET", "test-secret-value-with-at-least-32-chars")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("RATE_LIMIT_ENABLED", "false")

from app.core.database import Base, get_db
from app.main import app
from app.models import *  # noqa: F403 - registers all SQLAlchemy models with Base


@pytest.fixture()
def db_session(monkeypatch: pytest.MonkeyPatch) -> Session:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
        future=True,
    )
    TestingSessionLocal = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=engine,
        future=True,
    )
    Base.metadata.create_all(bind=engine)

    session = TestingSessionLocal()
    from app.models.trading_halt import TradingHaltState
    session.add(TradingHaltState(id=1, halted=False, reason="Initial trading state"))
    session.commit()

    def override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    prices = {
        "AAPL": 100.0,
        "MSFT": 200.0,
        "TSLA": 1000.0,
        "NVDA": 250.0,
    }

    def fake_live_price(symbol: str, asset_type: str = "stock") -> float:
        return prices.get(symbol.upper(), 100.0)

    monkeypatch.setattr("app.routers.trades.get_live_price", fake_live_price)
    monkeypatch.setattr("app.routers.portfolio.get_live_price", fake_live_price)

    try:
        yield session
    finally:
        session.close()
        app.dependency_overrides.clear()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture()
def client(db_session: Session) -> TestClient:
    return TestClient(app)


@pytest.fixture()
def make_user(client: TestClient) -> Callable[[str, str], dict]:
    def _make_user(email: str = "user@example.com", password: str = "password123") -> dict:
        response = client.post(
            "/auth/register",
            json={"email": email, "password": password},
        )
        assert response.status_code == 200, response.text
        return response.json()

    return _make_user


@pytest.fixture()
def auth_headers(client: TestClient, make_user: Callable[[str, str], dict]) -> Callable[[str, str], dict]:
    def _auth_headers(email: str = "user@example.com", password: str = "password123") -> dict:
        make_user(email, password)
        response = client.post(
            "/auth/login",
            data={"username": email, "password": password},
        )
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        return {"Authorization": f"Bearer {token}"}

    return _auth_headers
