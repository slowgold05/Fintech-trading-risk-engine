"""HTTP client for Massive grouped-daily bars.

``http_get_massive`` performs a real GET. Callers that must not touch the
network, including unit tests, pass a different ``http_get``.

The free Stocks Basic plan allows 5 requests a minute, end-of-day bars, and
about two years of history (Massive knowledge base, confirmed 2026-11-15;
the live response headers did not publish a tighter remaining-quota). One
grouped-daily call returns every US stock for a session, so a backfill is one
request per trading day. The shared pacer spaces those calls at 12.5 seconds
(4.8 per minute) so a sliding minute stays at or under the cap.
"""

from __future__ import annotations

import threading
import time
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlencode

import requests

from app.core.config import settings
from app.services.market_providers import ProviderUnavailable

# Same timeout nasdaq_universe_service uses for its requests.get calls.
_TIMEOUT_SECONDS = 30
_GROUPED_URL = "https://api.massive.com/v2/aggs/grouped/locale/us/market/stocks/{day}"

_shared_pacer: RequestPacer | None = None
_shared_lock = threading.Lock()


class RequestPacer:
    """Spaces calls so one process stays under a requests-per-minute cap.

    The first call does not wait. Each later call waits until ``60 / rpm``
    seconds have passed since the previous call was allowed. The wait is a
    single sleep, reserved under a lock so concurrent callers queue instead
    of polling.
    """

    def __init__(self, requests_per_minute: float, *, sleep=time.sleep, clock=time.monotonic):
        if requests_per_minute <= 0:
            raise ValueError("requests_per_minute must be positive")
        self.requests_per_minute = float(requests_per_minute)
        self.min_interval = 60.0 / self.requests_per_minute
        self._sleep = sleep
        self._clock = clock
        self._lock = threading.Lock()
        self._next_allowed = 0.0

    def wait(self) -> float:
        with self._lock:
            now = self._clock()
            delay = self._next_allowed - now
            if delay < 0:
                delay = 0.0
            self._next_allowed = max(self._next_allowed, now) + self.min_interval
        if delay > 0:
            self._sleep(delay)
        return delay


def get_shared_pacer() -> RequestPacer:
    """The process-wide pacer. Quote refresh and backfill share it."""
    global _shared_pacer
    with _shared_lock:
        if _shared_pacer is None:
            _shared_pacer = RequestPacer(settings.massive_requests_per_minute)
        return _shared_pacer


def reset_shared_pacer() -> None:
    """Drop the shared pacer. Tests use this after changing settings."""
    global _shared_pacer
    with _shared_lock:
        _shared_pacer = None


def bounded_retry_delay(
    retry_after: str | None,
    *,
    attempt: int,
    min_interval: float,
    cap: float,
    now: datetime | None = None,
) -> float:
    """Seconds to wait after HTTP 429.

    Uses Retry-After when it parses (delta-seconds or HTTP-date). Otherwise
    waits ``min_interval * 2^(attempt-1)``. The result is never below
    ``min_interval`` and never above ``cap`` unless ``cap`` itself is shorter
    than ``min_interval``, in which case the floor wins so the retry cannot
    spin.
    """
    if attempt < 1:
        raise ValueError("attempt must be positive")
    parsed = _parse_retry_after(retry_after, now or datetime.now(timezone.utc))
    if parsed is None:
        parsed = min_interval * (2 ** (attempt - 1))
    floor = min_interval
    ceiling = cap if cap >= floor else floor
    if parsed < floor:
        return floor
    if parsed > ceiling:
        return ceiling
    return parsed


def _parse_retry_after(value: str | None, now: datetime) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError:
        parsed = parsedate_to_datetime(text)
    if parsed is None:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return (parsed - now).total_seconds()


def _failure_message(response) -> str:
    """Status plus a short provider message. The request URL is not included."""
    detail = ""
    try:
        body = response.json()
    except (requests.RequestException, ValueError, AttributeError):
        body = None
    if isinstance(body, dict):
        detail = str(body.get("message") or body.get("error") or "")
    if "apiKey" in detail or "api_key" in detail.lower():
        detail = ""
    detail = " ".join(detail.split())[:180]
    message = f"Massive grouped request failed with status {response.status_code}"
    if detail:
        return f"{message}: {detail}"
    return message


def http_get_massive(
    kind: str,
    arg,
    api_key: str,
    *,
    pacer: RequestPacer | None = None,
    sleeper=None,
    max_attempts: int | None = None,
    retry_cap: float | None = None,
) -> dict:
    """GET one grouped-daily payload. ``arg`` is the session date.

    ``adjusted=false`` so the bars match the raw series this app stores.
    A 429 is retried up to the configured attempt count, waiting on
    Retry-After with a floor and a cap. Any other non-2xx fails immediately.
    """
    if kind != "massive":
        raise ProviderUnavailable(f"Unsupported provider kind: {kind}")
    limiter = get_shared_pacer() if pacer is None else pacer
    pause = time.sleep if sleeper is None else sleeper
    attempts = settings.massive_max_attempts if max_attempts is None else max_attempts
    cap = settings.massive_retry_after_cap_seconds if retry_cap is None else retry_cap
    if attempts < 1:
        raise ValueError("max_attempts must be positive")

    session_day = arg.isoformat() if isinstance(arg, date) else str(arg)
    query = urlencode((("adjusted", "false"), ("apiKey", api_key)))
    url = _GROUPED_URL.format(day=session_day) + "?" + query
    for attempt in range(1, attempts + 1):
        limiter.wait()
        try:
            response = requests.get(url, timeout=_TIMEOUT_SECONDS)
        except requests.RequestException as exc:
            raise ProviderUnavailable(exc.__class__.__name__) from exc
        if response.status_code == 429 and attempt < attempts:
            headers = getattr(response, "headers", {}) or {}
            retry_after = headers.get("Retry-After") if hasattr(headers, "get") else None
            pause(bounded_retry_delay(
                retry_after,
                attempt=attempt,
                min_interval=limiter.min_interval,
                cap=cap,
            ))
            continue
        if response.status_code < 200 or response.status_code >= 300:
            raise ProviderUnavailable(_failure_message(response))
        try:
            return response.json()
        except requests.RequestException as exc:
            raise ProviderUnavailable(exc.__class__.__name__) from exc
        except ValueError as exc:
            raise ProviderUnavailable(exc.__class__.__name__) from exc
    raise ProviderUnavailable("Massive grouped request failed with status 429")
