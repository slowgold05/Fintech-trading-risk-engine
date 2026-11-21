from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import NullPool

from app.models.asset import Asset
from app.models.night_inbox import NightInboxRead
from app.services.night_inbox import list_inbox, mark_read
from tests.test_night_inbox import _fill, _owner, _receipt
from tests.test_order_preview_postgres import _disposable_url, _upgrade


@pytest.fixture
def postgres_inbox():
    url = _disposable_url()
    _upgrade(url)
    engine = create_engine(url, poolclass=NullPool)
    sessions = sessionmaker(engine, autoflush=False)
    try:
        with sessions.begin() as db:
            unique = uuid4().hex[:12]
            owner = _owner(db, f"pg-inbox-{unique}@example.com")
            owner_id = owner.id
            asset = Asset(symbol=f"I{unique}", asset_type="stock")
            db.add(asset)
            receipt = _receipt(db, owner, asset)
            stamp = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=1)
            event_key = _fill(db, owner, asset, receipt.id, stamp)
        yield engine, sessions, owner_id, event_key
    finally:
        engine.dispose()


def test_concurrent_first_reads_preserve_one_timestamp(postgres_inbox):
    _, sessions, owner_id, event_key = postgres_inbox
    start = Barrier(2, timeout=5)

    def mark():
        with sessions() as db:
            start.wait()
            return mark_read(db, owner_id, False, event_key)

    with ThreadPoolExecutor(max_workers=2) as pool:
        first, second = [pool.submit(mark) for _ in range(2)]
        assert first.result(timeout=10) == second.result(timeout=10)
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(NightInboxRead).where(NightInboxRead.user_id == owner_id)) == 1
        page = list_inbox(db, owner_id, False, "all", None, 1)
        assert page.unread_count == 0
        assert page.items[0].read_at == first.result().read_at


def test_unread_count_and_items_use_the_same_snapshot(postgres_inbox):
    engine, sessions, owner_id, event_key = postgres_inbox
    written = False

    def mark_after_count(_conn, _cursor, sql, _params, _context, _many):
        nonlocal written
        if not written and sql.lstrip().upper().startswith("SELECT COUNT("):
            written = True
            with sessions() as writer:
                mark_read(writer, owner_id, False, event_key)

    event.listen(engine, "after_cursor_execute", mark_after_count)
    try:
        with sessions() as reader:
            snapshot = list_inbox(reader, owner_id, False, "unread", None, 1)
            assert written
            assert snapshot.unread_count == 1
            assert [item.id for item in snapshot.items] == [event_key]
            assert snapshot.items[0].read_at is None
            current = list_inbox(reader, owner_id, False, "unread", None, 1)
            assert current.unread_count == 0 and current.items == []
    finally:
        event.remove(engine, "after_cursor_execute", mark_after_count)
