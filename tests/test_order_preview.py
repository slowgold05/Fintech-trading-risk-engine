from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

import pytest
from sqlalchemy import func, select

from app.core.config import settings
from app.models.asset import Asset
from app.models.holding import Holding
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade
from app.models.user import User
from app.schemas.order import OrderCreate
from app.services.order_preview import preview_order
from app.services.trade_execution import notional_amount, reserved_cash, reserved_shares


RESPONSE_KEYS = {
    "symbol", "side", "order_type", "quantity", "limit_price",
    "read_at", "quote_observed_at",
    "status", "reason", "step_up_required",
    "buying_power", "sell_available",
    "initial_reservation", "estimated_fill_quantity", "estimated_fill_notional", "unfilled_quantity",
}
ESTIMATE_KEYS = ("initial_reservation", "estimated_fill_quantity", "estimated_fill_notional", "unfilled_quantity")


def _qty(value) -> str:
    return f"{Decimal(value).quantize(Decimal('0.000001')):.6f}"


def _money(value) -> str:
    return f"{Decimal(value).quantize(Decimal('0.01')):.2f}"


def _commit(db):
    # consistent_read rolls the session back before it reads.
    db.commit()
    db.expire_all()


def _counts(db) -> tuple:
    db.rollback()
    return (
        db.scalar(select(func.count()).select_from(Asset)),
        db.scalar(select(func.count()).select_from(Order)),
        db.scalar(select(func.count()).select_from(Holding)),
        db.scalar(select(func.count()).select_from(Trade)),
    )


def _owner(db, auth_headers, email="owner@example.com") -> int:
    auth_headers(email)
    return int(db.execute(select(User.id).where(User.email == email)).scalar_one())


def _seed(db, *, with_asset=True):
    quote_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=1)).replace(microsecond=0)
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db.flush()
    db.add(MarketQuoteCache(
        symbol="AAPL", price=Decimal("100"), change_amount=0, change_percent=0, volume=0,
        source="yahoo", quote_at=quote_at,
    ))
    asset_id = None
    if with_asset:
        asset = Asset(symbol="AAPL", asset_type="stock", name="Apple", is_active=True)
        db.add(asset)
        db.flush()
        asset_id = int(asset.id)
    _commit(db)
    return asset_id, quote_at


def _set_cash(db, user_id, cash):
    db.get(User, user_id).cash_balance = Decimal(cash)


def _maker(db, email, cash="100000") -> int:
    user = User(email=email, password_hash="preview-not-a-login", role="trader", cash_balance=Decimal(cash))
    db.add(user)
    db.flush()
    return int(user.id)


def _holding(db, user_id, asset_id, qty, avg="100"):
    db.add(Holding(
        user_id=user_id, asset_id=asset_id, quantity=Decimal(qty), avg_cost=Decimal(avg),
    ))


def _resting(db, user_id, asset_id, side, qty, price) -> int:
    quantity = Decimal(qty)
    order = Order(
        user_id=user_id, asset_id=asset_id, side=side, order_type="limit",
        quantity=quantity, remaining_quantity=quantity, limit_price=Decimal(price), status="open",
    )
    db.add(order)
    db.flush()
    return int(order.id)


def _book(db, asset_id, rows, tag) -> list[int]:
    order_ids = []
    for index, (side, qty, price) in enumerate(rows):
        maker_id = _maker(db, f"{tag}-{index}@example.com")
        if side == "sell":
            _holding(db, maker_id, asset_id, qty)
        order_ids.append(_resting(db, maker_id, asset_id, side, qty, price))
    return order_ids


def _sell_available(db, user_id, asset_id):
    if asset_id is None:
        return "0.000000"
    quantity = db.execute(
        select(Holding.quantity).where(Holding.user_id == user_id, Holding.asset_id == asset_id)
    ).scalar_one_or_none()
    held = Decimal(quantity or 0)
    return _qty(held - reserved_shares(db, user_id, asset_id))


def _buying_power(db, user_id) -> str:
    cash = db.get(User, user_id).cash_balance
    return _money(Decimal(cash) - reserved_cash(db, user_id))


def _preview(db, user_id, *, side, qty, limit, order_type=None):
    if order_type is None:
        order_type = "market" if limit is None else "limit"
    payload = OrderCreate(
        symbol="AAPL",
        side=side,
        order_type=order_type,
        quantity=Decimal(qty),
        limit_price=None if limit is None else Decimal(limit),
    )
    before = _counts(db)
    result = preview_order(db, user_id, payload)
    assert isinstance(result, dict), type(result).__name__
    assert _counts(db) == before
    return result


def _expect(body, *, status, reason, side, order_type, qty, limit, buying_power, sell_available, quote_at,
            reservation=None, fill_qty=None, fill_notional=None, unfilled=None):
    assert set(body) == RESPONSE_KEYS, set(body) ^ RESPONSE_KEYS
    assert body["symbol"] == "AAPL"
    assert body["side"] == side
    assert body["order_type"] == order_type
    assert body["quantity"] == _qty(qty)
    assert body["limit_price"] == (None if limit is None else _qty(limit))
    assert body["step_up_required"] is False
    assert body["buying_power"] == buying_power
    assert body["sell_available"] == sell_available
    assert body["quote_observed_at"] == quote_at.isoformat() + "Z"
    assert body["read_at"] != body["quote_observed_at"]
    assert isinstance(body["read_at"], str) and body["read_at"].endswith("Z")
    assert body["status"] == status
    assert body["reason"] == reason
    if status == "eligible":
        assert reason is None
        assert body["initial_reservation"] == reservation
        assert body["estimated_fill_quantity"] == _qty(fill_qty)
        assert body["estimated_fill_notional"] == _money(fill_notional)
        assert body["unfilled_quantity"] == _qty(unfilled)
        if order_type == "market" and Decimal(fill_qty) < Decimal(qty):
            assert Decimal(body["estimated_fill_notional"]) != notional_amount(Decimal(qty), Decimal("120"))
    else:
        assert reason
        for key in ESTIMATE_KEYS:
            assert body[key] is None


LIQUIDITY = [
    ("limit-buy-empty", "buy", "limit", "2", "100", "0", [], "0", "0.00", "2", "200.00"),
    ("market-buy-empty", "buy", "market", "2", None, "0", [], "0", "0.00", "2", "0.00"),
    ("limit-sell-empty", "sell", "limit", "2", "100", "5", [], "0", "0.00", "2", None),
    ("market-sell-empty", "sell", "market", "2", None, "5", [], "0", "0.00", "2", None),
    ("limit-buy-partial", "buy", "limit", "2", "100", "0", [("sell", "1", "90")], "1", "90.00", "1", "200.00"),
    ("market-buy-partial", "buy", "market", "3", None, "0", [("sell", "1", "105")], "1", "105.00", "2", "105.00"),
    ("limit-sell-partial", "sell", "limit", "2", "100", "5", [("buy", "1", "110")], "1", "110.00", "1", None),
    ("market-sell-partial", "sell", "market", "3", None, "5", [("buy", "1", "90")], "1", "90.00", "2", None),
    ("limit-buy-full", "buy", "limit", "2", "100", "0", [("sell", "5", "90")], "2", "180.00", "0", "200.00"),
    ("market-buy-full", "buy", "market", "2", None, "0", [("sell", "5", "105")], "2", "210.00", "0", "210.00"),
    ("limit-sell-full", "sell", "limit", "2", "100", "5", [("buy", "5", "110")], "2", "220.00", "0", None),
    ("market-sell-full", "sell", "market", "2", None, "5", [("buy", "4", "90")], "2", "180.00", "0", None),
]


@pytest.mark.parametrize("name, side, order_type, qty, limit, shares, book, fill_qty, fill_notional, unfilled, reservation", LIQUIDITY)
def test_limit_and_market_liquidity(db_session, auth_headers, name, side, order_type, qty, limit, shares, book, fill_qty, fill_notional, unfilled, reservation):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    if Decimal(shares) > 0:
        _holding(db_session, owner_id, asset_id, shares)
    _book(db_session, asset_id, book, name)
    _commit(db_session)
    body = _preview(db_session, owner_id, side=side, qty=qty, limit=limit, order_type=order_type)
    _expect(
        body, status="eligible", reason=None, side=side, order_type=order_type, qty=qty, limit=limit,
        buying_power=_buying_power(db_session, owner_id), sell_available=_sell_available(db_session, owner_id, asset_id),
        quote_at=quote_at, reservation=reservation, fill_qty=fill_qty, fill_notional=fill_notional, unfilled=unfilled,
    )
    if side == "buy" and order_type == "limit":
        assert Decimal(body["initial_reservation"]) == notional_amount(Decimal(qty), Decimal(limit))
    elif side == "buy":
        assert Decimal(body["initial_reservation"]) == Decimal(fill_notional)


PRIORITY = [
    ("price-beats-older-ask", "buy", "limit", "1", "100", "0", None, [("sell", "1", "95"), ("sell", "1", "90")], "1", "90.00", "0", "100.00"),
    ("price-beats-older-bid", "sell", "market", "1", None, "1", None, [("buy", "1", "90"), ("buy", "1", "95")], "1", "95.00", "0", None),
    ("buy-stops-at-limit", "buy", "limit", "2", "100", "0", None, [("sell", "1", "100"), ("sell", "1", "110")], "1", "100.00", "1", "200.00"),
    ("sell-stops-at-limit", "sell", "limit", "2", "100", "2", None, [("buy", "1", "100"), ("buy", "1", "90")], "1", "100.00", "1", None),
    ("self-ask-excluded", "buy", "limit", "1", "100", "1", ("sell", "1", "90"), [("sell", "1", "95")], "1", "95.00", "0", "100.00"),
]


@pytest.mark.parametrize("name, side, order_type, qty, limit, shares, own, book, fill_qty, fill_notional, unfilled, reservation", PRIORITY)
def test_price_time_crossing_and_self_exclusion(db_session, auth_headers, name, side, order_type, qty, limit, shares, own, book, fill_qty, fill_notional, unfilled, reservation):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    if Decimal(shares) > 0:
        _holding(db_session, owner_id, asset_id, shares)
    if own is not None:
        _resting(db_session, owner_id, asset_id, *own)
    _book(db_session, asset_id, book, name)
    _commit(db_session)
    body = _preview(db_session, owner_id, side=side, qty=qty, limit=limit, order_type=order_type)
    _expect(
        body, status="eligible", reason=None, side=side, order_type=order_type, qty=qty, limit=limit,
        buying_power=_buying_power(db_session, owner_id), sell_available=_sell_available(db_session, owner_id, asset_id),
        quote_at=quote_at, reservation=reservation, fill_qty=fill_qty, fill_notional=fill_notional, unfilled=unfilled,
    )


@pytest.mark.parametrize("case", ["reserved-buying-power", "insufficient-funds", "reserved-shares", "insufficient-shares"])
def test_owner_balances_funds_and_shares(db_session, auth_headers, case):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    if case == "reserved-buying-power":
        _resting(db_session, owner_id, asset_id, "buy", "2", "100")
        _commit(db_session)
        body = _preview(db_session, owner_id, side="buy", qty="1", limit="100")
        _expect(
            body, status="eligible", reason=None, side="buy", order_type="limit", qty="1", limit="100",
            buying_power="99800.00", sell_available="0.000000", quote_at=quote_at,
            reservation="100.00", fill_qty="0", fill_notional="0.00", unfilled="1",
        )
        assert _buying_power(db_session, owner_id) == "99800.00"
    elif case == "insufficient-funds":
        _set_cash(db_session, owner_id, "50")
        _book(db_session, asset_id, [("sell", "1", "100")], case)
        _commit(db_session)
        body = _preview(db_session, owner_id, side="buy", qty="1", limit="100")
        _expect(
            body, status="blocked", reason="Insufficient buying power", side="buy", order_type="limit",
            qty="1", limit="100", buying_power="50.00", sell_available="0.000000", quote_at=quote_at,
        )
    elif case == "reserved-shares":
        _holding(db_session, owner_id, asset_id, "5")
        _resting(db_session, owner_id, asset_id, "sell", "2", "110")
        _commit(db_session)
        body = _preview(db_session, owner_id, side="sell", qty="1", limit="100")
        _expect(
            body, status="eligible", reason=None, side="sell", order_type="limit", qty="1", limit="100",
            buying_power="100000.00", sell_available="3.000000", quote_at=quote_at,
            reservation=None, fill_qty="0", fill_notional="0.00", unfilled="1",
        )
    else:
        _holding(db_session, owner_id, asset_id, "2")
        _resting(db_session, owner_id, asset_id, "sell", "1.5", "110")
        _commit(db_session)
        body = _preview(db_session, owner_id, side="sell", qty="1", limit="100")
        _expect(
            body, status="blocked", reason="Not enough holdings to sell", side="sell", order_type="limit",
            qty="1", limit="100", buying_power="100000.00", sell_available="0.500000", quote_at=quote_at,
        )


def test_owner_rounded_slices_fail_post_fill_reservation(db_session, auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "max_stock_concentration_pct", Decimal("100"))
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    _set_cash(db_session, owner_id, "0.01")
    _book(db_session, asset_id, [("sell", "0.00005", "100"), ("sell", "0.00005", "100")], "round")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="buy", qty="0.0001", limit="100")
    _expect(
        body, status="blocked", reason="Insufficient buying power after matching", side="buy", order_type="limit",
        qty="0.0001", limit="100", buying_power="0.01", sell_available="0.000000", quote_at=quote_at,
    )


def test_half_cent_slices_sum_to_two_cents(db_session, auth_headers):
    slice_notional = notional_amount(Decimal("0.00005"), Decimal("100"))
    assert slice_notional == Decimal("0.01")
    combined = Decimal("0.00005") * Decimal("100") * 2
    assert combined.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) == Decimal("0.01")
    assert slice_notional * 2 == Decimal("0.02")

    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    _book(db_session, asset_id, [("sell", "0.00005", "100"), ("sell", "0.00005", "100")], "half")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="buy", qty="0.0001", limit="100")
    _expect(
        body, status="eligible", reason=None, side="buy", order_type="limit", qty="0.0001", limit="100",
        buying_power="100000.00", sell_available="0.000000", quote_at=quote_at,
        reservation="0.01", fill_qty="0.0001", fill_notional="0.02", unfilled="0",
    )
    assert Decimal(body["initial_reservation"]) == notional_amount(Decimal("0.0001"), Decimal("100"))
    assert Decimal(body["estimated_fill_notional"]) == slice_notional * 2


def test_dust_slice_blocks_the_whole_order(db_session, auth_headers):
    assert notional_amount(Decimal("0.000001"), Decimal("101")) == Decimal("0.00")
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    _book(db_session, asset_id, [("sell", "1", "100"), ("sell", "0.000001", "101")], "dust")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="buy", qty="1.000001", limit=None, order_type="market")
    _expect(
        body, status="blocked", reason="Trade value must be at least $0.01", side="buy", order_type="market",
        qty="1.000001", limit=None, buying_power="100000.00", sell_available="0.000000", quote_at=quote_at,
    )


@pytest.mark.parametrize("kind", ["shares", "cash"])
def test_insolvent_maker_is_unavailable_and_not_skipped(db_session, auth_headers, kind):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    if kind == "shares":
        broke_id = _maker(db_session, "broke@example.com")
        _resting(db_session, broke_id, asset_id, "sell", "1", "90")
        solvent_id = _maker(db_session, "solvent@example.com")
        _holding(db_session, solvent_id, asset_id, "1")
        _resting(db_session, solvent_id, asset_id, "sell", "1", "95")
        _commit(db_session)
        body = _preview(db_session, owner_id, side="buy", qty="1", limit="100")
        side, order_type, qty, limit = "buy", "limit", "1", "100"
    else:
        _holding(db_session, owner_id, asset_id, "1")
        broke_id = _maker(db_session, "broke@example.com", "10")
        _resting(db_session, broke_id, asset_id, "buy", "1", "100")
        solvent_id = _maker(db_session, "solvent@example.com")
        _resting(db_session, solvent_id, asset_id, "buy", "1", "99")
        _commit(db_session)
        body = _preview(db_session, owner_id, side="sell", qty="1", limit="90")
        side, order_type, qty, limit = "sell", "limit", "1", "90"
    _expect(
        body, status="unavailable", reason="Unavailable liquidity", side=side, order_type=order_type,
        qty=qty, limit=limit, buying_power=_buying_power(db_session, owner_id),
        sell_available=_sell_available(db_session, owner_id, asset_id), quote_at=quote_at,
    )


def test_same_maker_second_slice_fails_after_the_first_fit(db_session, auth_headers):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    maker_id = _maker(db_session, "maker@example.com")
    _holding(db_session, maker_id, asset_id, "1")
    _resting(db_session, maker_id, asset_id, "sell", "1", "90")
    _resting(db_session, maker_id, asset_id, "sell", "1", "95")
    later_id = _maker(db_session, "later@example.com")
    _holding(db_session, later_id, asset_id, "5")
    _resting(db_session, later_id, asset_id, "sell", "1", "96")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="buy", qty="3", limit="100")
    _expect(
        body, status="unavailable", reason="Unavailable liquidity", side="buy", order_type="limit",
        qty="3", limit="100", buying_power="100000.00", sell_available="0.000000", quote_at=quote_at,
    )


def test_maker_other_asset_reservation_fails_after_fill(db_session, auth_headers):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    _holding(db_session, owner_id, asset_id, "1")
    msft = Asset(symbol="MSFT", asset_type="stock", name="Microsoft", is_active=True)
    db_session.add(msft)
    db_session.flush()
    msft_id = int(msft.id)
    maker_id = _maker(db_session, "maker@example.com", "150")
    _resting(db_session, maker_id, asset_id, "buy", "1", "100")
    _resting(db_session, maker_id, msft_id, "buy", "1", "100")
    solvent_id = _maker(db_session, "solvent@example.com")
    _resting(db_session, solvent_id, asset_id, "buy", "1", "99")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="sell", qty="1", limit="90")
    _expect(
        body, status="unavailable", reason="Unavailable liquidity", side="sell", order_type="limit",
        qty="1", limit="90", buying_power="100000.00", sell_available="1.000000", quote_at=quote_at,
    )
    assert reserved_cash(db_session, maker_id) == Decimal("200.00")


def test_missing_asset_row_is_not_inserted(db_session, auth_headers):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session, with_asset=False)
    assert asset_id is None
    body = _preview(db_session, owner_id, side="buy", qty="1", limit="100")
    _expect(
        body, status="eligible", reason=None, side="buy", order_type="limit", qty="1", limit="100",
        buying_power="100000.00", sell_available="0.000000", quote_at=quote_at,
        reservation="100.00", fill_qty="0", fill_notional="0.00", unfilled="1",
    )
    assert db_session.execute(select(Asset.id).where(Asset.symbol == "AAPL")).scalar_one_or_none() is None


def _trade(client, headers, quantity):
    response = client.post(
        "/trades/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"symbol": "AAPL", "asset_type": "stock", "side": "buy", "quantity": quantity},
    )
    assert response.status_code == 200, response.text
    return response


def _submit(client, headers, side, quantity, price):
    response = client.post(
        "/orders/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json={"symbol": "AAPL", "side": side, "quantity": quantity, "limit_price": price},
    )
    assert response.status_code == 200, response.text
    return int(response.json()["id"])


def test_preview_matches_same_price_submission(client, db_session, auth_headers):
    _seed(db_session, with_asset=False)
    first_headers = auth_headers("first@example.com")
    second_headers = auth_headers("second@example.com")
    _trade(client, first_headers, 1)
    _trade(client, second_headers, 1)
    first_id = _submit(client, first_headers, "sell", 1, 90)
    second_id = _submit(client, second_headers, "sell", 1, 90)
    buyer_headers = auth_headers("buyer@example.com")
    buyer_id = int(db_session.execute(select(User.id).where(User.email == "buyer@example.com")).scalar_one())
    quote_at = db_session.get(MarketQuoteCache, "AAPL").quote_at
    asset_id = int(db_session.execute(select(Asset.id).where(Asset.symbol == "AAPL")).scalar_one())
    _commit(db_session)

    body = _preview(db_session, buyer_id, side="buy", qty="1", limit="100")
    _expect(
        body, status="eligible", reason=None, side="buy", order_type="limit", qty="1", limit="100",
        buying_power="100000.00", sell_available="0.000000", quote_at=quote_at,
        reservation="100.00", fill_qty="1", fill_notional="90.00", unfilled="0",
    )

    buyer_order_id = _submit(client, buyer_headers, "buy", 1, 100)
    db_session.rollback()
    db_session.expire_all()
    assert db_session.get(Order, first_id).status == "filled"
    assert db_session.get(Order, second_id).status == "open"
    assert db_session.get(Order, second_id).remaining_quantity == Decimal("1")
    buyer_order = db_session.get(Order, buyer_order_id)
    assert buyer_order.status == "filled"
    assert buyer_order.remaining_quantity == Decimal(body["unfilled_quantity"])
    fills = db_session.execute(select(Trade).where(Trade.order_id == buyer_order_id)).scalars().all()
    assert sum((trade.quantity for trade in fills), Decimal(0)) == Decimal(body["estimated_fill_quantity"])
    assert sum((notional_amount(trade.quantity, trade.price_at_execution) for trade in fills), Decimal(0)) == Decimal(body["estimated_fill_notional"])
    assert {trade.price_at_execution for trade in fills} == {Decimal("90")}
    assert asset_id == int(db_session.get(Order, first_id).asset_id)


def test_buying_power_keeps_reserve_deficit(db_session, auth_headers):
    owner_id = _owner(db_session, auth_headers)
    asset_id, quote_at = _seed(db_session)
    _set_cash(db_session, owner_id, "50")
    _resting(db_session, owner_id, asset_id, "buy", "1", "100")
    _commit(db_session)
    body = _preview(db_session, owner_id, side="buy", qty="1", limit=None, order_type="market")
    _expect(
        body, status="blocked", reason="Insufficient buying power", side="buy", order_type="market",
        qty="1", limit=None, buying_power="-50.00", sell_available="0.000000", quote_at=quote_at,
    )
