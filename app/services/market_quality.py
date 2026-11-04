"""Data-quality checks for daily bars.

A failed check is a finding. Downstream risk math treats that symbol as blocked
until the bars are clean. These functions do not call a data vendor.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from hashlib import sha256


@dataclass(frozen=True)
class Bar:
    symbol: str
    day: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int
    source: str
    fetched_at: datetime


def batch_checksum(bars: list[Bar]) -> str:
    payload = [
        {
            "symbol": bar.symbol,
            "day": bar.day.isoformat(),
            "open": format(bar.open, "f"),
            "high": format(bar.high, "f"),
            "low": format(bar.low, "f"),
            "close": format(bar.close, "f"),
            "volume": bar.volume,
            "source": bar.source,
        }
        for bar in bars
    ]
    return sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


def lineage(symbol: str, bars: list[Bar], source: str) -> dict:
    used = [bar for bar in bars if bar.symbol == symbol and bar.source == source]
    return {
        "symbol": symbol,
        "source": source,
        "checksum": batch_checksum(used),
        "bar_count": len(used),
        "days": [bar.day.isoformat() for bar in sorted(used, key=lambda item: item.day)],
    }


def check_bars(
    bars: list[Bar],
    *,
    symbols: list[str],
    as_of: date,
    peers: list[Bar] | None = None,
    stale_days: int = 7,
    jump_limit: Decimal = Decimal("0.50"),
    disagreement: Decimal = Decimal("0.02"),
) -> list[dict]:
    findings: list[dict] = []
    peers = peers or []
    for symbol in symbols:
        owned = sorted((bar for bar in bars if bar.symbol == symbol), key=lambda item: item.day)
        if not owned:
            findings.append({"symbol": symbol, "code": "missing", "summary": "No bars were loaded."})
            continue
        latest = owned[-1].day
        if latest < as_of - timedelta(days=stale_days):
            findings.append({"symbol": symbol, "code": "stale", "summary": f"Last bar is {latest.isoformat()}."})
        previous: Bar | None = None
        for bar in owned:
            prices = (bar.open, bar.high, bar.low, bar.close)
            if any(price <= 0 for price in prices) or bar.high < bar.low:
                findings.append({"symbol": symbol, "code": "non_positive", "summary": f"{bar.day.isoformat()} has a non-positive or inverted price."})
            if previous is not None and previous.close > 0:
                move = abs(bar.close / previous.close - 1)
                if move > jump_limit:
                    findings.append({"symbol": symbol, "code": "jump", "summary": f"{bar.day.isoformat()} moved more than the jump limit."})
            peer_closes = [peer.close for peer in peers if peer.symbol == symbol and peer.day == bar.day and peer.source != bar.source]
            for other in peer_closes:
                if bar.close > 0 and abs(other / bar.close - 1) > disagreement:
                    findings.append({"symbol": symbol, "code": "disagreement", "summary": f"{bar.day.isoformat()} disagrees across sources."})
                    break
            previous = bar
    return findings


def blocked_symbols(findings: list[dict]) -> set[str]:
    return {item["symbol"] for item in findings}


def risk_inputs_allowed(symbol: str, findings: list[dict]) -> bool:
    return symbol not in blocked_symbols(findings)


def override_block(findings: list[dict], symbol: str, reason: str, actor: str) -> tuple[list[dict], dict]:
    """Drop one symbol's findings only when the caller supplies an actor and a reason.

    The returned log is the record. This function does not write a database row
    and the order path does not call it.
    """
    text = reason.strip()
    name = actor.strip()
    if not text or not name:
        raise ValueError("An override needs an actor and a logged reason")
    removed = [item for item in findings if item.get("symbol") == symbol]
    if not removed:
        raise ValueError("That symbol has no data-quality finding to override")
    kept = [item for item in findings if item.get("symbol") != symbol]
    return kept, {"symbol": symbol, "actor": name, "reason": text, "removed": len(removed)}
