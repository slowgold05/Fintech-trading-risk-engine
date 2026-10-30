import time
from decimal import Decimal, InvalidOperation
import requests
from app.core.config import settings
_cache = {}  # (symbol, asset_type) -> (price, expires_at)
_quote_cache = {}  # symbol -> (quote, expires_at)
_api_cache = {}  # cache_key -> (payload, expires_at)


class AlphaVantageError(ValueError):
    """A safe-to-return error from Alpha Vantage."""


class AlphaVantageRateLimitError(AlphaVantageError):
    """Alpha Vantage rejected a request because its quota was exhausted."""


def _raise_provider_error(data: object, fallback: str) -> None:
    if not isinstance(data, dict):
        raise AlphaVantageError(fallback)

    detail = str(data.get("Note") or data.get("Information") or "")
    normalized = detail.lower()
    if any(term in normalized for term in ("rate limit", "call frequency", "requests per day", "premium")):
        raise AlphaVantageRateLimitError("Alpha Vantage request quota has been exhausted.")

    # Provider messages can echo credentials, so never pass them to API clients.
    raise AlphaVantageError(fallback)



def _get_cached(symbol: str, asset_type: str):
    key = (symbol, asset_type)
    item = _cache.get(key)
    if not item:
        return None
    price, expires_at = item
    if time.time() > expires_at:
        _cache.pop(key, None)
        return None
    return price


def _set_cached(symbol: str, asset_type: str, price: Decimal, ttl_seconds: int = 30):
    _cache[(symbol, asset_type)] = (price, time.time() + ttl_seconds)


def _decimal(value: object, error: str) -> Decimal:
    try:
        amount = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise AlphaVantageError(error) from None
    if not amount.is_finite():
        raise AlphaVantageError(error)
    return amount


def _price(value: object, error: str) -> Decimal:
    price = _decimal(value, error)
    if price <= 0:
        raise AlphaVantageError(error)
    return price


def _parse_percent(value: str | None) -> float:
    if not value:
        return 0.0
    return float(value.replace("%", "").strip())


def _get_cached_quote(symbol: str):
    item = _quote_cache.get(symbol)
    if not item:
        return None

    quote, expires_at = item
    if time.time() > expires_at:
        _quote_cache.pop(symbol, None)
        return None

    return quote


def _set_cached_quote(symbol: str, quote: dict, ttl_seconds: int = 300):
    _quote_cache[symbol] = (quote, time.time() + ttl_seconds)


def _get_api_cached(cache_key: str):
    item = _api_cache.get(cache_key)
    if not item:
        return None

    payload, expires_at = item
    if time.time() > expires_at:
        _api_cache.pop(cache_key, None)
        return None

    return payload


def _set_api_cached(cache_key: str, payload: dict, ttl_seconds: int = 900):
    _api_cache[cache_key] = (payload, time.time() + ttl_seconds)


def get_stock_quote(symbol: str) -> dict:
    symbol = symbol.upper()
    cached = _get_cached_quote(symbol)
    if cached is not None:
        return cached

    key = settings.alpha_vantage_api_key
    if not key:
        raise ValueError("Alpha Vantage API key is not configured.")

    url = "https://www.alphavantage.co/query"
    params = {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": key}
    data = requests.get(url, params=params, timeout=15).json()
    raw_quote = data.get("Global Quote", {})
    price_str = raw_quote.get("05. price")

    if not price_str:
        _raise_provider_error(data, f"Price not found for {symbol}.")

    quote = {
        "symbol": symbol,
        "price": _price(price_str, f"Invalid price for {symbol}."),
        "change": _decimal(raw_quote.get("09. change") or 0, f"Invalid price change for {symbol}."),
        "change_percent": _parse_percent(raw_quote.get("10. change percent")),
        "volume": int(raw_quote.get("06. volume") or 0),
        "quote_date": raw_quote.get("07. latest trading day"),
    }
    _set_cached_quote(symbol, quote)
    return quote


def get_top_gainers_losers() -> dict:
    cached = _get_api_cached("top_gainers_losers")
    if cached is not None:
        return cached

    key = settings.alpha_vantage_api_key
    if not key:
        raise ValueError("Alpha Vantage API key is not configured.")

    url = "https://www.alphavantage.co/query"
    params = {"function": "TOP_GAINERS_LOSERS", "apikey": key}
    data = requests.get(url, params=params, timeout=15).json()

    if "top_gainers" not in data and "top_losers" not in data and "most_actively_traded" not in data:
        _raise_provider_error(data, "Top gainers and losers data is unavailable.")

    _set_api_cached("top_gainers_losers", data, ttl_seconds=900)
    return data


def get_company_overview(symbol: str) -> dict:
    symbol = symbol.upper().strip()
    cached = _get_api_cached(f"company_overview:{symbol}")
    if cached is not None:
        return cached

    key = settings.alpha_vantage_api_key
    if not key:
        raise ValueError("Alpha Vantage API key is not configured.")

    url = "https://www.alphavantage.co/query"
    params = {"function": "OVERVIEW", "symbol": symbol, "apikey": key}
    data = requests.get(url, params=params, timeout=15).json()

    if not data or not data.get("Symbol"):
        _raise_provider_error(data, f"Company overview not found for {symbol}.")

    _set_api_cached(f"company_overview:{symbol}", data, ttl_seconds=3600)
    return data

def get_live_price(symbol: str, asset_type: str) -> Decimal:
    symbol = symbol.upper()
    cached = _get_cached(symbol, asset_type)
    if cached is not None:
        return cached

    key = settings.alpha_vantage_api_key
    if not key:
        raise ValueError("Alpha Vantage API key is not configured.")

    if asset_type == "stock":
        price = _price(get_stock_quote(symbol)["price"], f"Invalid price for {symbol}.")
        _set_cached(symbol, asset_type, price)
        return price
    else:
        # crypto: use USD quote
        url = "https://www.alphavantage.co/query"
        params = {"function": "CURRENCY_EXCHANGE_RATE", "from_currency": symbol, "to_currency": "USD", "apikey": key}
        data = requests.get(url, params=params, timeout=15).json()
        price_str = data.get("Realtime Currency Exchange Rate", {}).get("5. Exchange Rate")

    if not price_str:
        _raise_provider_error(data, f"Price not found for {symbol} ({asset_type}).")

    price = _price(price_str, f"Invalid price for {symbol} ({asset_type}).")
    _set_cached(symbol, asset_type, price)
    return price
