from fastapi import Response
import pytest

from app.routers.night_transfer import import_watchlist
from app.routers.watchlists import add_symbol
from app.schemas.night_transfer import WatchlistImport
from app.schemas.watchlist import WatchlistSymbolCreate
from tests.test_watchlists_postgres import (
    _assert_money,
    _engine_and_sessions,
    _LISTS,
    _membership,
    _race,
    _seed,
    _status,
    _symbols,
    _watchlist_schema,
    pytestmark,
)


@pytest.mark.parametrize("same_symbol", [True, False], ids=["repeat-import", "ordinary-add-at-cap"])
def test_import_serializes_against_watchlist_mutations(_watchlist_schema, same_symbol):
    engine, sessions = _engine_and_sessions()
    try:
        symbols = _symbols(51)
        existing, added, extra = symbols[:49], *symbols[49:]
        seed = _seed(sessions, 1, existing, [added, extra])
        target_id = seed["list_ids"][0]
        owner = seed["owner"]
        payload = WatchlistImport(watchlist_id=target_id, symbols=[added], dry_run=False)

        def hold(db):
            return import_watchlist(payload, db, owner)

        def wait(db):
            if same_symbol:
                return import_watchlist(payload, db, owner)
            return add_symbol(WatchlistSymbolCreate(symbol=extra), Response(), target_id, db, owner)

        result = _race(engine, sessions, "import-holder", "import-waiter", _LISTS, hold, wait)
        with sessions() as db:
            cash, ledger, _names, present, items = _membership(db, seed["user_id"], target_id)
    finally:
        engine.dispose()

    assert result["blocked"] is True and result["relation"] == _LISTS
    held = result["outcomes"]["import-holder"]
    waited = result["outcomes"]["import-waiter"]
    assert held["error"] is None
    assert held["value"].added == 1
    if same_symbol:
        assert waited["error"] is None
        assert waited["value"].added == 0
        assert waited["value"].rows[0].status == "existing"
    else:
        assert _status(waited["error"]) == 409
    assert present
    assert items == list(zip([*existing, added], range(1, 51), strict=True))
    _assert_money(seed, cash, ledger)
