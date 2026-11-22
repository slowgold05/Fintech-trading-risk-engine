from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.core.database import get_db
from app.core.security import create_access_token
from app.models.user import User
from tests.test_order_preview_postgres import _disposable_url, _upgrade


@pytest.fixture(scope="session")
def notebook_sessions():
    url = _disposable_url()
    _upgrade(url)
    engine = create_engine(url, poolclass=NullPool)
    try:
        yield sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    finally:
        engine.dispose()


def trial_client(router, sessions):
    app = FastAPI()
    app.include_router(router)

    def trial_db():
        with sessions() as db:
            yield db

    app.dependency_overrides[get_db] = trial_db
    return TestClient(app)


def fixture_user(db, **attributes):
    user = User(email=f"notebook-{uuid4().hex}@example.com", password_hash="fixture", **attributes)
    db.add(user)
    db.flush()
    return user


def bearer(user_id):
    return {"Authorization": f"Bearer {create_access_token(user_id)}"}
