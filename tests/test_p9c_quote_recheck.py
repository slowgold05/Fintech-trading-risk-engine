"""Stage 4: optional quote identity recheck when confirming an order."""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import func, select

from app.models.aml import CashMovement
from app.models.market_quote_cache import MarketQuoteCache
from app.models.market_symbol import MarketSymbol
from app.models.order import Order
from app.models.trade import Trade


SYMBOL = "QREC"


def _seed_symbol(db) -> None:
    db.add(MarketSymbol(symbol=SYMBOL, company_name="Quote Recheck", exchange="NASDAQ", is_active=True))
    db.flush()


def _seed_quote(db, quote_at: datetime) -> None:
    db.add(MarketQuoteCache(
        symbol=SYMBOL, price=100, change_amount=0, change_percent=0, volume=0,
        source="yahoo", quote_at=quote_at,
    ))
    db.commit()


def _preview(client, headers) -> dict:
    response = client.post(
        "/orders/preview",
        headers=headers,
        json={"symbol": SYMBOL, "side": "buy", "quantity": 1, "limit_price": 100},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _submit(client, headers, **extra):
    body = {"symbol": SYMBOL, "side": "buy", "quantity": 1, "limit_price": 100}
    body.update(extra)
    return client.post(
        "/orders/",
        headers={**headers, "Idempotency-Key": str(uuid4())},
        json=body,
    )


def _mutation_counts(db) -> tuple[int, int, int]:
    db.expire_all()
    return (
        db.scalar(select(func.count()).select_from(Order)),
        db.scalar(select(func.count()).select_from(Trade)),
        db.scalar(select(func.count()).select_from(CashMovement)),
    )


def test_matching_quote_observed_at_places_the_same_order(client, auth_headers, db_session):
    quote_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    _seed_symbol(db_session)
    _seed_quote(db_session, quote_at)
    headers = auth_headers()
    observed = _preview(client, headers)["quote_observed_at"]
    assert observed == quote_at.isoformat() + "Z"

    without_field = _submit(client, headers)
    with_match = _submit(client, headers, expected_quote_observed_at=observed)
    assert without_field.status_code == 200, without_field.text
    assert with_match.status_code == 200, with_match.text
    assert with_match.json()["status"] == without_field.json()["status"] == "open"
    assert with_match.json()["trade_ids"] == without_field.json()["trade_ids"] == []
    assert with_match.json()["remaining_quantity"] == without_field.json()["remaining_quantity"]


def test_changed_quote_at_rejects_before_any_mutation(client, auth_headers, db_session):
    quote_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    _seed_symbol(db_session)
    _seed_quote(db_session, quote_at)
    headers = auth_headers()
    observed = _preview(client, headers)["quote_observed_at"]

    quote = db_session.get(MarketQuoteCache, SYMBOL)
    quote.quote_at = quote_at - timedelta(seconds=1)
    db_session.commit()
    before = _mutation_counts(db_session)

    rejected = _submit(client, headers, expected_quote_observed_at=observed)
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"] == "Quote has changed since preview; request a new preview"
    assert _mutation_counts(db_session) == before


def test_missing_quote_row_cannot_confirm(client, auth_headers, db_session):
    _seed_symbol(db_session)
    db_session.commit()
    headers = auth_headers()

    rejected = _submit(client, headers, expected_quote_observed_at="2026-11-11T15:30:00Z")
    assert rejected.status_code == 400, rejected.text
    assert rejected.json()["detail"] == "No current quote available to confirm against"


def test_omitted_expected_quote_observed_at_keeps_default_order_behavior(client, auth_headers, db_session):
    quote_at = datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)
    _seed_symbol(db_session)
    _seed_quote(db_session, quote_at)
    headers = auth_headers()

    accepted = _submit(client, headers)
    assert accepted.status_code == 200, accepted.text
    body = accepted.json()
    assert body["status"] == "open"
    assert body["trade_ids"] == []
    assert body["symbol"] == SYMBOL
    assert body["remaining_quantity"] == 1.0
