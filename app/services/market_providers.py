"""Market-data adapters.

Parsing is local. A live call happens only when the caller passes `http_get`
and a key. This module's defaults do not open a socket. Massive, Finnhub, and
Twelve Data stay disconnected until those arguments are supplied.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
from decimal import Decimal

from app.services.market_quality import Bar


class ProviderUnavailable(RuntimeError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _bar(symbol: str, day: date, open_, high, low, close, volume, source: str) -> Bar:
    return Bar(
        symbol=symbol.upper(),
        day=day,
        open=Decimal(str(open_)),
        high=Decimal(str(high)),
        low=Decimal(str(low)),
        close=Decimal(str(close)),
        volume=int(volume),
        source=source,
        fetched_at=_now(),
    )


def parse_massive_grouped(payload: dict, day: date) -> list[Bar]:
    rows = payload.get("results") if isinstance(payload, dict) else None
    if payload.get("status") not in {None, "OK"} or not isinstance(rows, list):
        raise ValueError("Massive grouped payload is incomplete")
    bars = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("T"):
            raise ValueError("Massive grouped row is incomplete")
        bars.append(_bar(str(row["T"]), day, row["o"], row["h"], row["l"], row["c"], row["v"], "massive"))
    return bars


def parse_finnhub_candles(symbol: str, payload: dict) -> list[Bar]:
    if not isinstance(payload, dict) or payload.get("s") != "ok":
        raise ValueError("Finnhub candle payload is incomplete")
    stamps = payload.get("t") or []
    bars = []
    for index, stamp in enumerate(stamps):
        day = datetime.fromtimestamp(int(stamp), timezone.utc).date()
        bars.append(_bar(
            symbol, day, payload["o"][index], payload["h"][index], payload["l"][index],
            payload["c"][index], payload["v"][index], "finnhub",
        ))
    return bars


def parse_twelve_series(symbol: str, payload: dict) -> list[Bar]:
    rows = payload.get("values") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("Twelve Data payload is incomplete")
    bars = []
    for row in rows:
        bars.append(_bar(
            symbol, date.fromisoformat(str(row["datetime"])[:10]), row["open"], row["high"],
            row["low"], row["close"], row["volume"], "twelve",
        ))
    return bars


def fetch_massive_grouped(day: date, api_key: str, http_get) -> list[Bar]:
    if not api_key:
        raise ProviderUnavailable("MASSIVE_API_KEY is empty")
    payload = http_get("massive", day, api_key)
    return parse_massive_grouped(payload, day)


def fetch_finnhub_candles(symbol: str, api_key: str, http_get) -> list[Bar]:
    if not api_key:
        raise ProviderUnavailable("FINNHUB_API_KEY is empty")
    payload = http_get("finnhub", symbol, api_key)
    return parse_finnhub_candles(symbol, payload)


def fetch_twelve_series(symbol: str, api_key: str, http_get) -> list[Bar]:
    if not api_key:
        raise ProviderUnavailable("TWELVE_DATA_API_KEY is empty")
    payload = http_get("twelve", symbol, api_key)
    return parse_twelve_series(symbol, payload)


@dataclass
class CallBudget:
    """Counts calls inside one job. It is not a shared rate limiter."""

    limit: int
    used: int = 0

    def take(self) -> bool:
        if self.used >= self.limit:
            return False
        self.used += 1
        return True


def fetch_with_budget(budget: CallBudget, fetch):
    if not budget.take():
        raise ProviderUnavailable("Provider call budget is exhausted")
    return fetch()


def source_status(fetch) -> str:
    try:
        bars = fetch()
    except ProviderUnavailable:
        return "source unavailable"
    if not bars:
        return "source unavailable"
    return "ok"


class Chain:
    def __init__(self, fetches: list):
        self.fetches = fetches

    def fetch(self) -> tuple[str, list[Bar]]:
        errors: list[str] = []
        for name, fetch in self.fetches:
            try:
                bars = fetch()
            except (ProviderUnavailable, ValueError) as exc:
                errors.append(f"{name}: {exc}")
                continue
            if bars:
                return name, bars
            errors.append(f"{name}: empty")
        raise ProviderUnavailable("; ".join(errors) or "No provider returned bars")
