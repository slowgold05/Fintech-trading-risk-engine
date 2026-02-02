import time
import requests
from app.core.config import settings
import random

_cache = {}  # (symbol, asset_type) -> (price, expires_at)



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


def _set_cached(symbol: str, asset_type: str, price: float, ttl_seconds: int = 30):
    _cache[(symbol, asset_type)] = (price, time.time() + ttl_seconds)

def get_live_price(symbol: str, asset_type: str) -> float:
    symbol = symbol.upper()
    cached = _get_cached(symbol, asset_type)
    if cached is not None:
        return cached

    key = settings.alpha_vantage_api_key
    if not key:
        raise ValueError("Alpha Vantage API key is not configured.")

    if asset_type == "stock":
        url = "https://www.alphavantage.co/query"
        params = {"function": "GLOBAL_QUOTE", "symbol": symbol, "apikey": key}
        data = requests.get(url, params=params, timeout=15).json()
        price_str = data.get("Global Quote", {}).get("05. price")
    else:
        # crypto: use USD quote
        url = "https://www.alphavantage.co/query"
        params = {"function": "CURRENCY_EXCHANGE_RATE", "from_currency": symbol, "to_currency": "USD", "apikey": key}
        data = requests.get(url, params=params, timeout=15).json()
        price_str = data.get("Realtime Currency Exchange Rate", {}).get("5. Exchange Rate")

    if not price_str:
        raise ValueError(f"Price not found for {symbol} ({asset_type}). API response: {data}")

    price = float(price_str)
    price *= random.uniform(0.995, 1.005)
    _set_cached(symbol, asset_type, price)
    return price
