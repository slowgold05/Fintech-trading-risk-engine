"""Period dollars when ledger postings and close marks use compatible units."""

from collections import defaultdict
from datetime import date
from decimal import Decimal, ROUND_HALF_UP

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.market_bar_daily import MarketBarDaily
from app.models.trade import Trade
from app.schemas.night_portfolio_review import ContributionItem, ReviewContribution
from app.services.demo_market_history import PriceSeries
from app.services.history_series import ADJUSTED, RAW
from app.services.performance_service import _effective_at, _flow_since, _state_as_of
from app.services.portfolio_valuation import CENT
from app.services.trade_execution import notional_amount


def _missing(reason: str) -> ReviewContribution:
    return ReviewContribution(coverage="missing", items=[], residual_usd=None, reason=reason)


def _cents(value: Decimal) -> Decimal:
    rounded = value.quantize(CENT, rounding=ROUND_HALF_UP)
    return rounded if rounded else abs(rounded)


def _trade_postings(db: Session, owner: int, book, start: date, end: date):
    events = defaultdict(list)
    for entry in book:
        if entry.event_kind == "trade" and entry.account in {"position", "cash"}:
            events[entry.event_id].append(entry)
    ids = {row.trade_id for rows in events.values() for row in rows if row.trade_id is not None}
    trades = {
        trade.id: trade
        for trade in db.scalars(select(Trade).where(Trade.user_id == owner, Trade.id.in_(ids)))
    } if ids else {}

    cash_by_asset = defaultdict(Decimal)
    quantity_by_asset = defaultdict(Decimal)
    receipts_by_asset = defaultdict(list)
    for rows in events.values():
        position = [row for row in rows if row.account == "position"]
        cash = [row for row in rows if row.account == "cash"]
        dates = {_effective_at(row).date() for row in rows}
        in_period = any(start < day <= end for day in dates)
        if len(position) != 1 or len(cash) != 1 or len(dates) != 1:
            if in_period:
                return None
            continue
        p, c = position[0], cash[0]
        trade = trades.get(p.trade_id)
        day = next(iter(dates))
        if day > end:
            continue
        if (
            trade is None or trade.id != c.trade_id or trade.asset_id != p.asset_id
            or p.unit != f"ASSET:{trade.asset_id}" or c.unit != "USD" or c.asset_id is not None
            or trade.side not in {"buy", "sell"} or trade.quantity <= 0 or trade.price_at_execution <= 0
        ):
            if in_period:
                return None
            receipts_by_asset[p.asset_id].append((day, None))
            continue
        direction = 1 if trade.side == "buy" else -1
        if p.amount != trade.quantity * direction or c.amount != -direction * notional_amount(
            trade.quantity, trade.price_at_execution,
        ):
            if in_period:
                return None
            receipts_by_asset[p.asset_id].append((day, None))
            continue
        receipts_by_asset[p.asset_id].append((day, trade))
        if in_period:
            cash_by_asset[trade.asset_id] += c.amount
            quantity_by_asset[trade.asset_id] += p.amount
    return cash_by_asset, quantity_by_asset, receipts_by_asset


def _adjusted_book_matches(db, symbol, source, seed, receipts, bars, start, start_qty, clock):
    """Dated demo fills establish a synthetic share basis if their stored marks still match."""
    if not seed or not receipts:
        return False
    anchors = {
        (date.fromisoformat(fill["date"]), fill["side"], Decimal(fill["quantity"]), Decimal(fill["price"]))
        for fill in seed["fills"]
        if fill["symbol"] == symbol and (fill["provider"], fill["adjustment"]) == (source.provider, ADJUSTED)
    }
    used = set()
    anchored_start_qty = Decimal(0)
    for day, trade in receipts:
        if trade is None or not trade.demo_seed:
            return False
        signature = (day, trade.side, trade.quantity, trade.price_at_execution)
        if signature not in anchors or signature in used:
            return False
        used.add(signature)
        if day <= start:
            anchored_start_qty += trade.quantity if trade.side == "buy" else -trade.quantity
    if start_qty != anchored_start_qty:
        return False
    # Older fill dates are read by key only to detect a provider restating an
    # adjusted series after those synthetic units were purchased.
    anchor_days = {day for day, _, _, _ in used}
    observed = {day: mark.price for day, mark in bars.items() if day in anchor_days}
    lookup = anchor_days - observed.keys()
    if lookup:
        observed.update(dict(db.execute(select(MarketBarDaily.session_date, MarketBarDaily.close).where(
            MarketBarDaily.symbol == symbol,
            MarketBarDaily.provider == source.provider,
            MarketBarDaily.adjustment_type == ADJUSTED,
            MarketBarDaily.session_date.in_(lookup),
            MarketBarDaily.quality_status == "valid",
            MarketBarDaily.fetched_at <= clock,
        )).all()))
    return all(observed.get(day) == price for day, _, _, price in used)


def _raw_basis_discontinuity(source, all_marks, flagged, start, end):
    if any(start <= day <= end for day in flagged):
        return True
    raw = all_marks.get(source, {})
    adjusted = all_marks.get(PriceSeries(source.provider, ADJUSTED), {})
    factors = [
        raw[day].price / adjusted[day].price
        for day in sorted(raw.keys() & adjusted.keys()) if start <= day <= end
    ]
    if len(factors) > 1 and max(factors) / min(factors) > Decimal("1.005"):
        return True
    # Large uncorroborated raw discontinuities could be unposted splits.
    closes = [raw[day].price for day in sorted(raw) if start <= day <= end]
    return any(max(a, b) / min(a, b) >= Decimal("1.5") for a, b in zip(closes, closes[1:]))


def period_contribution(
    db, owner, entries, states, symbols, sources, bars, flagged, pinned, seed,
    values, flows, start, end, clock, reset_id,
) -> ReviewContribution:
    if start is None or end is None or start == end:
        return _missing("Two fully valued account sessions are required for period contribution.")

    _, start_quantities = _state_as_of(states, start)
    _, end_quantities = _state_as_of(states, end)
    book = [entry for entry in entries if reset_id is None or entry.id > reset_id]
    postings = _trade_postings(db, owner, book, start, end)
    if postings is None:
        return _missing("Posted trade quantities and proceeds could not be reconciled.")
    cash_legs, quantity_legs, receipts = postings
    touched = {
        asset_id for asset_id in start_quantities.keys() | end_quantities.keys() | cash_legs.keys()
        if start_quantities.get(asset_id) or end_quantities.get(asset_id) or asset_id in cash_legs
    }
    items = []
    for asset_id in touched:
        start_qty = start_quantities.get(asset_id, Decimal(0))
        end_qty = end_quantities.get(asset_id, Decimal(0))
        if end_qty - start_qty != quantity_legs[asset_id]:
            return _missing("Endpoint quantities do not reconcile with trades in the current ledger book.")
        if any(
            entry.asset_id == asset_id and entry.account == "position" and entry.event_kind != "trade"
            and start < _effective_at(entry).date() <= end
            for entry in book
        ):
            return _missing("The ledger has a position change with no compatible trade basis.")
        symbol = symbols[asset_id]
        source = sources.get(symbol) or pinned.get(symbol)
        if source is not None and source.adjustment == ADJUSTED:
            if not _adjusted_book_matches(
                db, symbol, source, seed, receipts[asset_id], bars[symbol][source], start, start_qty, clock,
            ):
                return _missing("Split-adjusted marks could not be reconciled with the posted share units and trade proceeds.")
        elif source is not None and source.adjustment == RAW:
            if _raw_basis_discontinuity(source, bars[symbol], flagged[(symbol, source)], start, end):
                return _missing("A possible split or change in the raw-price basis could not be reconciled.")
        elif start_qty or end_qty or source is not None:
            return _missing("The endpoint marks and posted trade units do not have a verified common basis.")

        marks = bars[symbol].get(source, {})
        start_value = start_qty * marks[start].price if start_qty else Decimal(0)
        end_value = end_qty * marks[end].price if end_qty else Decimal(0)
        pnl = _cents(end_value - start_value + cash_legs[asset_id])
        items.append((symbol, pnl))

    items.sort(key=lambda item: (-abs(item[1]), item[0]))
    account_pnl = values[end].value - values[start].value - _flow_since(flows, start, end)
    residual = _cents(account_pnl - sum(pnl for _, pnl in items))
    return ReviewContribution(
        coverage="available",
        items=[ContributionItem(symbol=symbol, pnl_usd=format(pnl, "f")) for symbol, pnl in items],
        residual_usd=format(residual, "f"),
        reason=None,
    )
