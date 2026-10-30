from dataclasses import dataclass
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

import requests


class EodDataError(ValueError):
    """A safe-to-return error from the EOD market data provider."""


REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/126.0 Safari/537.36"
    )
}


@dataclass(frozen=True)
class EodQuote:
    symbol: str
    date: date
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: int

    @property
    def price(self) -> Decimal:
        return self.close

    @property
    def change(self) -> Decimal:
        return self.close - self.open

    @property
    def change_percent(self) -> Decimal:
        if self.open == 0:
            return Decimal(0)
        return ((self.close - self.open) / self.open) * 100

    def as_quote(self) -> dict:
        return {
            "symbol": self.symbol,
            "price": self.price,
            "change": self.change,
            "change_percent": self.change_percent,
            "volume": self.volume,
            "quote_date": self.date.isoformat(),
        }


def _yahoo_symbol(symbol: str) -> str:
    return symbol.upper().replace(".", "-")


def _latest_complete_daily_bar(payload: dict, symbol: str) -> EodQuote:
    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise EodDataError(f"Quote not found for {symbol}.")

    timestamps = result.get("timestamp") or []
    quotes = result.get("indicators", {}).get("quote") or []
    if not timestamps or not quotes:
        raise EodDataError(f"Quote not found for {symbol}.")

    bars = quotes[0]
    opens = bars.get("open") or []
    highs = bars.get("high") or []
    lows = bars.get("low") or []
    closes = bars.get("close") or []
    volumes = bars.get("volume") or []

    for index in range(len(timestamps) - 1, -1, -1):
        values = (
            opens[index] if index < len(opens) else None,
            highs[index] if index < len(highs) else None,
            lows[index] if index < len(lows) else None,
            closes[index] if index < len(closes) else None,
        )
        if any(value is None for value in values):
            continue

        try:
            prices = tuple(Decimal(str(value)) for value in values)
        except (InvalidOperation, ValueError, TypeError):
            continue
        if any(not price.is_finite() or price <= 0 for price in prices):
            continue

        return EodQuote(
            symbol=symbol,
            date=datetime.fromtimestamp(timestamps[index], tz=timezone.utc).date(),
            open=prices[0],
            high=prices[1],
            low=prices[2],
            close=prices[3],
            volume=int(volumes[index] or 0) if index < len(volumes) else 0,
        )

    raise EodDataError(f"Complete daily bar not found for {symbol}.")


def fetch_yahoo_quote(symbol: str) -> EodQuote:
    normalized = symbol.upper().strip()
    if not normalized:
        raise EodDataError("Symbol is required.")

    try:
        response = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{_yahoo_symbol(normalized)}",
            params={"range": "5d", "interval": "1d"},
            headers=REQUEST_HEADERS,
            timeout=15,
        )
        response.raise_for_status()
    except requests.RequestException as exc:
        raise EodDataError(f"EOD quote fetch failed for {normalized}.") from exc

    return _latest_complete_daily_bar(response.json(), normalized)


def fetch_eod_batch(symbols: list[str]) -> dict[str, EodQuote]:
    quotes = {}
    # shortcut: the chart API has one symbol per request; use a bulk feed when available.
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_yahoo_quote, symbol): symbol for symbol in symbols}
        for future in as_completed(futures):
            try:
                quote = future.result()
            except (EodDataError, OSError):
                continue
            quotes[quote.symbol] = quote
    return quotes
