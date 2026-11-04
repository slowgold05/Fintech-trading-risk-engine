from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from statistics import median

from app.services.surveillance_rules import decimal_param, int_param


@dataclass(frozen=True)
class SurveillanceEvent:
    event_id: str
    at: datetime
    user_id: int
    symbol: str
    kind: str
    side: str
    quantity: Decimal
    price: Decimal
    order_id: str | None = None


@dataclass(frozen=True)
class Detection:
    rule_id: str
    user_id: int
    symbol: str
    event_ids: tuple[str, ...]
    summary: str


def detect(rule: dict, events: list[SurveillanceEvent]) -> list[Detection]:
    handlers = {
        "SM-SV-01": _wash_trades,
        "SM-SV-02": _spoofing,
        "SM-SV-03": _pump_and_dump,
        "SM-SV-04": _unusual_volume,
    }
    handler = handlers.get(rule["id"])
    if handler is None:
        raise ValueError(f"No detector for {rule['id']}")
    ordered = sorted(events, key=lambda item: (item.at, item.event_id))
    return handler(rule, ordered)


def _within(left: datetime, right: datetime, minutes: int) -> bool:
    return abs(left - right) <= timedelta(minutes=minutes)


def _quantity_matches(left: Decimal, right: Decimal, ratio: Decimal) -> bool:
    larger = max(left, right)
    return larger > 0 and min(left, right) / larger >= ratio


def _price_matches(left: Decimal, right: Decimal, tolerance_pct: Decimal) -> bool:
    middle = (left + right) / 2
    if middle <= 0:
        return False
    return abs(left - right) / middle * 100 <= tolerance_pct


def _one_book_print(left: SurveillanceEvent, right: SurveillanceEvent) -> bool:
    # Trades have no shared execution id. A book match is the two order ids at one price and time.
    return (
        left.user_id != right.user_id
        and bool(left.order_id)
        and bool(right.order_id)
        and left.order_id != right.order_id
        and left.at == right.at
        and left.quantity == right.quantity
        and left.price == right.price
    )


def _wash_trades(rule: dict, events: list[SurveillanceEvent]) -> list[Detection]:
    window = int_param(rule, "window_minutes")
    ratio = decimal_param(rule, "quantity_match_ratio")
    tolerance = decimal_param(rule, "price_tolerance_pct")
    trades = [item for item in events if item.kind == "trade"]
    found = []
    seen = set()
    for index, left in enumerate(trades):
        for right in trades[index + 1:]:
            if left.symbol != right.symbol or left.side == right.side:
                continue
            if not _within(left.at, right.at, window):
                continue
            if not _quantity_matches(left.quantity, right.quantity, ratio):
                continue
            if not _price_matches(left.price, right.price, tolerance):
                continue
            if _one_book_print(left, right):
                continue
            same_account = left.user_id == right.user_id
            users = (left.user_id,) if same_account else (left.user_id, right.user_id)
            event_ids = tuple(sorted((left.event_id, right.event_id)))
            for user_id in users:
                key = (user_id, left.symbol, event_ids)
                if key in seen:
                    continue
                seen.add(key)
                relation = "the same account" if same_account else "two accounts"
                found.append(Detection(
                    rule["id"], user_id, left.symbol, event_ids,
                    f"Offsetting {left.symbol} fills within {window} minutes on {relation}",
                ))
    return found


def _spoofing(rule: dict, events: list[SurveillanceEvent]) -> list[Detection]:
    window = int_param(rule, "window_minutes")
    minimum = decimal_param(rule, "min_display_quantity")
    max_cancel = int_param(rule, "max_cancel_seconds")
    max_execution = decimal_param(rule, "max_execution_quantity")
    orders = {item.order_id: item for item in events if item.kind == "order" and item.order_id}
    found = []
    seen = set()
    for cancel in events:
        if cancel.kind != "cancel" or not cancel.order_id or cancel.order_id not in orders:
            continue
        order = orders[cancel.order_id]
        if (cancel.at - order.at).total_seconds() > max_cancel or cancel.at < order.at:
            continue
        if order.quantity < minimum:
            continue
        for trade in events:
            if trade.kind != "trade" or trade.user_id != order.user_id or trade.symbol != order.symbol:
                continue
            if trade.side == order.side or trade.quantity > max_execution:
                continue
            if not _within(trade.at, cancel.at, window):
                continue
            key = (order.user_id, order.symbol, order.event_id, trade.event_id)
            if key in seen:
                continue
            seen.add(key)
            found.append(Detection(
                rule["id"], order.user_id, order.symbol, (order.event_id, cancel.event_id, trade.event_id),
                f"Large {order.side} {order.symbol} order canceled within {max_cancel} seconds of an opposite fill",
            ))
    return found


def _pump_and_dump(rule: dict, events: list[SurveillanceEvent]) -> list[Detection]:
    rise_pct = decimal_param(rule, "rise_pct")
    rise_minutes = int_param(rule, "rise_minutes")
    dump_minutes = int_param(rule, "dump_minutes")
    min_buy = decimal_param(rule, "min_buy_quantity")
    min_sell = decimal_param(rule, "min_sell_quantity")
    trades = [item for item in events if item.kind == "trade"]
    found = []
    seen = set()
    for peak in trades:
        if peak.price <= 0:
            continue
        start = peak.at - timedelta(minutes=rise_minutes)
        earlier = [item for item in trades if item.symbol == peak.symbol and start <= item.at <= peak.at]
        if len(earlier) < 2 or earlier[0].price <= 0:
            continue
        if peak.price < max(item.price for item in earlier):
            continue
        if peak.price < earlier[0].price * (1 + rise_pct / 100):
            continue
        buys: dict[int, Decimal] = {}
        for item in earlier:
            if item.at < peak.at and item.side == "buy":
                buys[item.user_id] = buys.get(item.user_id, Decimal(0)) + item.quantity
        dump_end = peak.at + timedelta(minutes=dump_minutes)
        sells: dict[int, Decimal] = {}
        sell_ids: dict[int, list[str]] = {}
        for item in trades:
            if item.symbol != peak.symbol or item.side != "sell" or not peak.at <= item.at <= dump_end:
                continue
            sells[item.user_id] = sells.get(item.user_id, Decimal(0)) + item.quantity
            sell_ids.setdefault(item.user_id, []).append(item.event_id)
        for user_id, bought in buys.items():
            if bought < min_buy or sells.get(user_id, Decimal(0)) < min_sell:
                continue
            key = (user_id, peak.symbol, peak.event_id)
            if key in seen:
                continue
            seen.add(key)
            buy_ids = [item.event_id for item in earlier if item.user_id == user_id and item.side == "buy"]
            found.append(Detection(
                rule["id"], user_id, peak.symbol, tuple(buy_ids + sell_ids.get(user_id, [])),
                f"{peak.symbol} rose at least {rise_pct}% and the account sold after buying into the rise",
            ))
    return found


def _unusual_volume(rule: dict, events: list[SurveillanceEvent]) -> list[Detection]:
    window = int_param(rule, "window_minutes")
    multiple = decimal_param(rule, "multiple")
    minimum = decimal_param(rule, "min_quantity")
    peers_required = int_param(rule, "min_peers")
    trades = [item for item in events if item.kind == "trade"]
    found = []
    seen = set()
    symbols = {item.symbol for item in trades}
    for symbol in symbols:
        symbol_trades = [item for item in trades if item.symbol == symbol]
        for end in {item.at for item in symbol_trades}:
            start = end - timedelta(minutes=window)
            totals: dict[int, Decimal] = {}
            ids: dict[int, list[str]] = {}
            for item in symbol_trades:
                if start < item.at <= end:
                    totals[item.user_id] = totals.get(item.user_id, Decimal(0)) + item.quantity
                    ids.setdefault(item.user_id, []).append(item.event_id)
            for user_id, quantity in totals.items():
                peers = [value for other, value in totals.items() if other != user_id]
                if len(peers) < peers_required or quantity < minimum:
                    continue
                baseline = median(peers)
                if baseline <= 0 or quantity < multiple * baseline:
                    continue
                key = (user_id, symbol, end)
                if key in seen:
                    continue
                seen.add(key)
                found.append(Detection(
                    rule["id"], user_id, symbol, tuple(ids[user_id]),
                    f"{symbol} quantity {quantity} is at least {multiple} times the other accounts in {window} minutes",
                ))
    return found
