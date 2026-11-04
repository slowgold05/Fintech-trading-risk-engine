from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal

from app.services.aml_rules import decimal_param, int_param


@dataclass(frozen=True)
class CashEvent:
    event_id: str
    at: datetime
    user_id: int
    kind: str
    amount: Decimal


@dataclass(frozen=True)
class Detection:
    rule_id: str
    user_id: int
    event_ids: list[str]
    summary: str


def detect(rule: dict, events: list[CashEvent]) -> list[Detection]:
    if rule["id"] == "SM-AML-01":
        return _structuring(rule, events)
    if rule["id"] == "SM-AML-02":
        return _rapid_movement(rule, events)
    return []


def _structuring(rule: dict, events: list[CashEvent]) -> list[Detection]:
    threshold = decimal_param(rule, "threshold")
    window = timedelta(hours=int_param(rule, "window_hours"))
    minimum = int_param(rule, "min_count")
    grouped: dict[tuple[int, str], list[CashEvent]] = {}
    for event in events:
        if event.kind in {"deposit", "withdrawal"} and event.amount < threshold:
            grouped.setdefault((event.user_id, event.kind), []).append(event)
    detections = []
    for (user_id, kind), rows in grouped.items():
        rows.sort(key=lambda item: (item.at, item.event_id))
        for start, first in enumerate(rows):
            bucket = []
            total = Decimal(0)
            for item in rows[start:]:
                if item.at - first.at > window:
                    break
                bucket.append(item)
                total += item.amount
            if len(bucket) >= minimum and total >= threshold:
                detections.append(Detection(
                    rule["id"], user_id, [item.event_id for item in bucket],
                    f"{len(bucket)} {kind}s under {threshold} total {total}",
                ))
    return detections


def _rapid_movement(rule: dict, events: list[CashEvent]) -> list[Detection]:
    window = timedelta(minutes=int_param(rule, "window_minutes"))
    minimum = decimal_param(rule, "min_deposit")
    ratio = decimal_param(rule, "withdrawal_ratio")
    grouped: dict[int, list[CashEvent]] = {}
    for event in events:
        grouped.setdefault(event.user_id, []).append(event)
    detections = []
    for user_id, rows in grouped.items():
        rows.sort(key=lambda item: (item.at, item.event_id))
        for deposit in rows:
            if deposit.kind != "deposit" or deposit.amount < minimum:
                continue
            taken = [item for item in rows if item.kind == "withdrawal" and deposit.at < item.at <= deposit.at + window]
            total = sum((item.amount for item in taken), Decimal(0))
            if total >= deposit.amount * ratio:
                detections.append(Detection(
                    rule["id"], user_id, [deposit.event_id, *[item.event_id for item in taken]],
                    f"Withdrawals of {total} followed a deposit of {deposit.amount}",
                ))
    return detections
