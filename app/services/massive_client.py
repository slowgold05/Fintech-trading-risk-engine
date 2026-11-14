"""HTTP client for Massive grouped-daily bars.

``http_get_massive`` performs a real GET. Callers that must not touch the
network, including this unit's tests, pass a different ``http_get``.
"""

from __future__ import annotations

from datetime import date
from urllib.parse import urlencode

import requests

from app.services.market_providers import ProviderUnavailable

# Same timeout nasdaq_universe_service uses for its requests.get calls.
_TIMEOUT_SECONDS = 30
_GROUPED_URL = "https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/{day}"


def http_get_massive(kind: str, arg, api_key: str) -> dict:
    """GET one grouped-daily payload. ``arg`` is the session date."""
    if kind != "massive":
        raise ProviderUnavailable(f"Unsupported provider kind: {kind}")
    session_day = arg.isoformat() if isinstance(arg, date) else str(arg)
    url = _GROUPED_URL.format(day=session_day) + "?" + urlencode({"apiKey": api_key})
    try:
        response = requests.get(url, timeout=_TIMEOUT_SECONDS)
    except requests.RequestException as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc
    if response.status_code < 200 or response.status_code >= 300:
        raise ProviderUnavailable(
            f"Massive grouped request failed with status {response.status_code}"
        )
    try:
        return response.json()
    except requests.RequestException as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc
    except ValueError as exc:
        raise ProviderUnavailable(exc.__class__.__name__) from exc
