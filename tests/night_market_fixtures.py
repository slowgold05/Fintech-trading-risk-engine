"""Isolated cache fixtures for the owned router, optionally on PostgreSQL."""

import os
from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.routers.night_market import router

TABLES = ("market_symbols", "market_bars_daily", "market_news_cache", "market_filings_cache")
OBSERVED = datetime(2025, 2, 1, tzinfo=timezone.utc)


@pytest.fixture
def market():
    target = os.environ.get("AUDIT_DATABASE_URL")
    if target:
        from tests.test_order_preview_postgres import _disposable_url

        owner = create_engine(_disposable_url())
        namespace = f"night_market_{uuid4().hex}"
        with owner.begin() as connection:
            connection.execute(text(f"CREATE SCHEMA {namespace}"))
        engine = create_engine(target, connect_args={"options": f"-csearch_path={namespace}"})
    else:
        engine = create_engine(
            "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False},
        )

    try:
        Base.metadata.create_all(engine, tables=[Base.metadata.tables[name] for name in TABLES])
        app = FastAPI()
        app.include_router(router)

        def test_db():
            with Session(engine) as session:
                yield session

        app.dependency_overrides[get_db] = test_db
        with Session(engine) as session, TestClient(app) as client:
            yield session, client
    finally:
        engine.dispose()
        if target:
            with owner.begin() as connection:
                connection.execute(text(f"DROP SCHEMA {namespace} CASCADE"))
            owner.dispose()


def listing(symbol: str, sector: str | None = "Technology", **flags) -> MarketSymbol:
    return MarketSymbol(symbol=symbol, company_name=f"{symbol} Test", exchange="NASDAQ", sector=sector, **flags)


def bar(
    symbol: str, day: date, close: str | int, *, provider: str = "yahoo",
    basis: str = "split_adjusted", quality: str = "valid", fetched_at: datetime = OBSERVED,
) -> MarketBarDaily:
    price = Decimal(close)
    return MarketBarDaily(
        symbol=symbol, session_date=day, provider=provider, adjustment_type=basis,
        open=price, high=price, low=price, close=price, volume=1,
        fetched_at=fetched_at, quality_status=quality,
    )
