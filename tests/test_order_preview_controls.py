from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.read_snapshot import SnapshotClockError
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.lot import Lot
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.mfa import LoginChallenge, MfaFactor
from app.models.order import Order
from app.models.trade import Trade
from app.models.trading_halt import TradingHaltState
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.order_preview import preview_order
from app.services.pretrade_controls import _price_band_problem

PREVIEW_PATH = "/orders/preview"
HALT = "Trading is halted (SM-PT-01)"
UNKNOWN = "Unknown or inactive stock symbol"
NONSTOCK = "Symbol is registered as another asset type"
UNUSABLE = "Usable reference quote unavailable (SM-PT-02)"
CONCENTRATION = "Stock concentration limit exceeded (SM-PT-03)"
ESTIMATES = (
    "initial_reservation",
    "estimated_fill_quantity",
    "estimated_fill_notional",
    "unfilled_quantity",
)
DENIED_ROLES = ("analyst", "compliance_officer", "admin", "auditor")


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def _iso_z(value: datetime) -> str:
    return value.isoformat() + "Z"


def _limit_body(symbol: str = "AAPL") -> dict:
    return {
        "symbol": symbol,
        "side": "buy",
        "quantity": "1",
        "order_type": "limit",
        "limit_price": "100",
    }


def _user_id(db: Session, email: str) -> int:
    found = db.execute(select(User.id).where(User.email == email)).scalar_one()
    return int(found)


def _clock_at(fixed: datetime):
    def _clock(_db: Session) -> datetime:
        return fixed

    return _clock


def _count(db: Session, model) -> int:
    return int(db.execute(select(func.count()).select_from(model)).scalar_one())


def _domain_counts(db: Session) -> dict[str, int]:
    db.expire_all()
    return {
        "orders": _count(db, Order),
        "trades": _count(db, Trade),
        "lots": _count(db, Lot),
        "holdings": _count(db, Holding),
        "mfa_factors": _count(db, MfaFactor),
        "login_challenges": _count(db, LoginChallenge),
        "assets": _count(db, Asset),
        "quotes": _count(db, MarketQuoteCache),
        "users": _count(db, User),
    }


def _cash(db: Session, user_id: int) -> Decimal:
    value = db.execute(select(User.cash_balance).where(User.id == user_id)).scalar_one()
    return Decimal(value)


def _assert_estimates_null(body: dict) -> None:
    for field in ESTIMATES:
        assert body[field] is None


def _seed_symbol(db: Session, symbol: str, company_name: str, *, active: bool = True) -> None:
    db.add(MarketSymbol(
        symbol=symbol,
        company_name=company_name,
        exchange="NASDAQ",
        is_active=active,
    ))


def _seed_quote(db: Session, symbol: str, price: Decimal, quote_at: datetime) -> None:
    db.add(MarketQuoteCache(
        symbol=symbol,
        price=price,
        source="yahoo",
        quote_at=quote_at,
        fetched_at=quote_at,
    ))


def _seed_tradable(db: Session, quote_at: datetime) -> None:
    _seed_symbol(db, "AAPL", "Apple")
    db.add(Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True))
    _seed_quote(db, "AAPL", Decimal("100"), quote_at)
    db.commit()


def _seed_control(db: Session, setup: str, wall: datetime) -> datetime | None:
    if setup == "halt":
        state = db.get(TradingHaltState, 1)
        state.halted = True
    if setup == "unknown":
        db.commit()
        return None

    _seed_symbol(db, "AAPL", "Apple", active=setup != "inactive")
    observed = None
    if setup == "nonstock":
        db.add(Asset(symbol="AAPL", asset_type="crypto", name="Apple", is_active=True))
    elif setup != "inactive":
        db.add(Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True))
    if setup not in {"inactive", "missing"}:
        if setup == "future":
            observed = wall + timedelta(days=1)
        elif setup == "stale":
            observed = wall - timedelta(days=9)
        else:
            observed = wall - timedelta(hours=1)
        price = Decimal("100")
        if setup == "zero":
            price = Decimal("0")
        elif setup == "negative":
            price = Decimal("-1")
        _seed_quote(db, "AAPL", price, observed)
    db.commit()
    return observed


@pytest.mark.parametrize(
    ("kind", "expected"),
    [
        ("anonymous", 401),
        ("analyst", 403),
        ("compliance_officer", 403),
        ("admin", 403),
        ("auditor", 403),
        ("qty_zero", 422),
        ("market_with_price", 422),
        ("limit_without_price", 422),
    ],
)
def test_preview_access_and_malformed_payload(
    client: TestClient,
    auth_headers,
    db_session: Session,
    kind: str,
    expected: int,
) -> None:
    body = _limit_body()
    headers = None
    if kind != "anonymous":
        headers = auth_headers("access@example.com")
        if kind in DENIED_ROLES:
            user = db_session.execute(select(User).where(User.email == "access@example.com")).scalar_one()
            user.role = kind
            db_session.commit()
        elif kind == "qty_zero":
            body["quantity"] = "0"
        elif kind == "market_with_price":
            body["order_type"] = "market"
        elif kind == "limit_without_price":
            body.pop("limit_price")

    response = client.post(PREVIEW_PATH, headers=headers, json=body)
    assert response.status_code == expected
    if expected == 403:
        assert response.json()["detail"] == "Trader role required"


def test_preview_normalizes_symbol(client: TestClient, auth_headers, db_session: Session) -> None:
    observed = _naive_utc_now() - timedelta(hours=1)
    _seed_tradable(db_session, observed)
    response = client.post(PREVIEW_PATH, headers=auth_headers("symbol@example.com"), json=_limit_body(" aapl "))
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["side"] == "buy"
    assert body["order_type"] == "limit"
    assert body["quantity"] == "1.000000"
    assert body["limit_price"] == "100.000000"
    assert body["status"] == "eligible"
    assert body["reason"] is None
    assert body["step_up_required"] is False
    assert body["buying_power"] == "100000.00"
    assert body["sell_available"] == "0.000000"
    assert body["quote_observed_at"] == _iso_z(observed)
    assert body["read_at"].endswith("Z")
    assert body["initial_reservation"] == "100.00"
    assert body["estimated_fill_quantity"] == "0.000000"
    assert body["estimated_fill_notional"] == "0.00"
    assert body["unfilled_quantity"] == "1.000000"


@pytest.mark.parametrize(
    ("setup", "status", "reason", "clock"),
    [
        ("halt", "blocked", HALT, "real"),
        ("unknown", "blocked", UNKNOWN, "real"),
        ("inactive", "blocked", UNKNOWN, "real"),
        ("nonstock", "blocked", NONSTOCK, "real"),
        ("missing", "unavailable", UNUSABLE, "real"),
        ("zero", "unavailable", UNUSABLE, "real"),
        ("negative", "unavailable", UNUSABLE, "real"),
        ("future", "unavailable", UNUSABLE, "real"),
        ("stale", "unavailable", UNUSABLE, "real"),
        ("fresh", "unavailable", UNUSABLE, "past"),
        ("fresh", "unavailable", UNUSABLE, "ahead"),
    ],
)
def test_preview_blocks_or_withholds_unusable_markets(
    client: TestClient,
    auth_headers,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    setup: str,
    status: str,
    reason: str,
    clock: str,
) -> None:
    headers = auth_headers("buyer@example.com")
    wall = _naive_utc_now()
    fixed = None
    if clock == "past":
        fixed = wall - timedelta(days=2)
    elif clock == "ahead":
        fixed = wall + timedelta(days=9)
    observed = _seed_control(db_session, setup, wall)
    if fixed is not None:
        monkeypatch.setattr("app.services.order_preview.snapshot_clock", _clock_at(fixed))

    response = client.post(PREVIEW_PATH, headers=headers, json=_limit_body())
    assert response.status_code == 200
    body = response.json()
    assert body["symbol"] == "AAPL"
    assert body["side"] == "buy"
    assert body["order_type"] == "limit"
    assert body["quantity"] == "1.000000"
    assert body["limit_price"] == "100.000000"
    assert body["status"] == status
    assert body["reason"] == reason
    assert body["step_up_required"] is False
    assert body["buying_power"] == "100000.00"
    if setup in {"unknown", "inactive", "nonstock"}:
        assert body["sell_available"] is None
    else:
        assert body["sell_available"] == "0.000000"
    _assert_estimates_null(body)
    if observed is None:
        assert body["quote_observed_at"] is None
    else:
        assert body["quote_observed_at"] == _iso_z(observed)
    if fixed is not None:
        assert body["read_at"] == _iso_z(fixed)


def test_other_holding_book_cost_blocks_concentration(
    client: TestClient,
    auth_headers,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    headers = auth_headers("book@example.com")
    owner = db_session.execute(select(User).where(User.email == "book@example.com")).scalar_one()
    owner_id = int(owner.id)
    owner.cash_balance = Decimal("100")
    wall = _naive_utc_now()
    fixed = wall - timedelta(days=2)
    # The other quote is fresh on the wall clock and future at the snapshot clock, so equity uses book cost.
    target_quote_at = fixed - timedelta(hours=1)
    other_quote_at = wall - timedelta(hours=1)
    _seed_symbol(db_session, "AAPL", "Apple")
    _seed_symbol(db_session, "MSFT", "Microsoft")
    db_session.flush()
    aapl = Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True)
    msft = Asset(symbol="MSFT", asset_type="stock", name="Microsoft", is_active=True)
    db_session.add(aapl)
    db_session.add(msft)
    db_session.flush()
    db_session.add(Holding(
        user_id=owner_id,
        asset_id=msft.id,
        quantity=Decimal("100"),
        avg_cost=Decimal("1"),
    ))
    _seed_quote(db_session, "AAPL", Decimal("100"), target_quote_at)
    _seed_quote(db_session, "MSFT", Decimal("100"), other_quote_at)
    db_session.commit()
    monkeypatch.setattr(settings, "max_stock_concentration_pct", Decimal("25"))
    monkeypatch.setattr(settings, "max_stock_position_notional", Decimal("1000000"))
    monkeypatch.setattr("app.services.order_preview.snapshot_clock", _clock_at(fixed))

    response = client.post(PREVIEW_PATH, headers=headers, json=_limit_body())
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "blocked"
    assert body["reason"] == CONCENTRATION
    assert body["step_up_required"] is False
    assert body["buying_power"] == "100.00"
    assert body["sell_available"] == "0.000000"
    assert body["read_at"] == _iso_z(fixed)
    assert body["quote_observed_at"] == _iso_z(target_quote_at)
    assert body["quantity"] == "1.000000"
    assert body["limit_price"] == "100.000000"
    _assert_estimates_null(body)


def test_preview_is_read_only_when_step_up_is_required(
    client: TestClient,
    auth_headers,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    email = "mfa@example.com"
    headers = auth_headers(email)
    owner_id = _user_id(db_session, email)
    observed = _naive_utc_now() - timedelta(hours=1)
    _seed_tradable(db_session, observed)
    now = _naive_utc_now()
    db_session.add(MfaFactor(
        user_id=owner_id,
        method="totp",
        secret_ciphertext="must-not-decrypt",
        confirmed_at=now,
        last_counter=7,
    ))
    db_session.add(LoginChallenge(
        user_id=owner_id,
        expires_at=now + timedelta(minutes=5),
        consumed_at=None,
    ))
    db_session.commit()
    monkeypatch.setattr(settings, "large_order_step_up_notional", Decimal("1"))
    monkeypatch.setattr(settings, "mfa_required", False)

    def _called(*_args, **_kwargs):
        raise AssertionError("order preview called a write or provider path")

    monkeypatch.setattr("app.services.order_book.place_order", _called)
    monkeypatch.setattr("app.services.trade_execution.execute_fill", _called)
    monkeypatch.setattr("app.services.mfa.consume_totp", _called)
    monkeypatch.setattr("app.services.price_service.get_stock_quote", _called)

    before_counts = _domain_counts(db_session)
    before_cash = _cash(db_session, owner_id)

    def _forbid_write(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        text = statement.decode() if isinstance(statement, bytes) else str(statement)
        verb = text.lstrip().split(None, 1)[0].upper()
        if verb in {"INSERT", "UPDATE", "DELETE"}:
            raise AssertionError("order preview issued a write")

    engine = db_session.get_bind()
    event.listen(engine, "before_cursor_execute", _forbid_write)
    try:
        first = client.post(
            PREVIEW_PATH,
            headers={**headers, "X-Step-Up-Code": "123456"},
            json=_limit_body(),
        )
        second = client.post(
            PREVIEW_PATH,
            headers={**headers, "X-Step-Up-Code": "123456"},
            json=_limit_body(),
        )
    finally:
        event.remove(engine, "before_cursor_execute", _forbid_write)

    assert first.status_code == 200
    assert second.status_code == 200
    first_body = first.json()
    second_body = second.json()
    assert first_body["step_up_required"] is True
    assert second_body["step_up_required"] is True
    assert first_body["status"] == "eligible"
    assert first_body["initial_reservation"] == "100.00"
    assert first_body["estimated_fill_quantity"] == "0.000000"
    assert first_body["estimated_fill_notional"] == "0.00"
    assert first_body["unfilled_quantity"] == "1.000000"
    assert first_body["buying_power"] == "100000.00"
    assert {key: value for key, value in first_body.items() if key != "read_at"} == {
        key: value for key, value in second_body.items() if key != "read_at"
    }
    assert _domain_counts(db_session) == before_counts
    assert _cash(db_session, owner_id) == before_cash == Decimal("100000")
    factor = db_session.execute(select(MfaFactor).where(MfaFactor.user_id == owner_id)).scalar_one()
    challenge = db_session.execute(select(LoginChallenge).where(LoginChallenge.user_id == owner_id)).scalar_one()
    assert factor.last_counter == 7
    assert factor.secret_ciphertext == "must-not-decrypt"
    assert factor.confirmed_at is not None
    assert challenge.consumed_at is None


@pytest.mark.parametrize(
    ("order_type", "limit_price", "step_up"),
    [
        ("limit", "100.000000", True),
        ("market", None, None),
    ],
)
def test_step_up_flag_when_quote_is_unusable(
    client: TestClient,
    auth_headers,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
    order_type: str,
    limit_price: str | None,
    step_up: bool | None,
) -> None:
    headers = auth_headers("threshold@example.com")
    _seed_symbol(db_session, "AAPL", "Apple")
    db_session.add(Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True))
    db_session.commit()
    monkeypatch.setattr(settings, "mfa_required", True)
    monkeypatch.setattr(settings, "large_order_step_up_notional", Decimal("1"))
    body = {"symbol": "AAPL", "side": "buy", "quantity": "1", "order_type": order_type}
    if order_type == "limit":
        body["limit_price"] = "100"

    response = client.post(PREVIEW_PATH, headers=headers, json=body)
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "unavailable"
    assert payload["reason"] == UNUSABLE
    assert payload["step_up_required"] is step_up
    assert payload["order_type"] == order_type
    assert payload["limit_price"] == limit_price
    assert payload["quantity"] == "1.000000"
    assert payload["buying_power"] == "100000.00"
    assert payload["sell_available"] == "0.000000"
    _assert_estimates_null(payload)


@pytest.mark.parametrize("price", [Decimal("NaN"), Decimal("Infinity"), Decimal("-Infinity")])
def test_nonfinite_quote_is_unusable(price: Decimal) -> None:
    clock = datetime(2026, 11, 6, 15, 0, 0)
    quote = SimpleNamespace(price=price, quote_at=clock - timedelta(hours=1), source="yahoo")
    assert _price_band_problem(quote, Decimal("100"), now=clock) == UNUSABLE


def test_snapshot_clock_error_propagates(
    auth_headers,
    db_session: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    auth_headers("clock@example.com")
    owner_id = _user_id(db_session, "clock@example.com")
    _seed_tradable(db_session, _naive_utc_now() - timedelta(hours=1))

    def _broken_clock(_db: Session) -> datetime:
        raise SnapshotClockError("snapshot clock is missing")

    monkeypatch.setattr("app.services.order_preview.snapshot_clock", _broken_clock)
    payload = OrderCreate(
        symbol="AAPL",
        side="buy",
        order_type="limit",
        quantity=Decimal("1"),
        limit_price=Decimal("100"),
    )
    with pytest.raises(SnapshotClockError):
        preview_order(db_session, owner_id, payload)
