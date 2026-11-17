"""Pacing and HTTP 429 behavior for the Massive client. No live calls."""

import math
from datetime import date, datetime, timezone

import pytest

from app.core.config import settings
from app.services.market_providers import ProviderUnavailable
from app.services.massive_client import (
    RequestPacer,
    bounded_retry_delay,
    get_shared_pacer,
    http_get_massive,
    http_get_massive_ticker,
    reset_shared_pacer,
)


class _Response:
    def __init__(self, status_code, headers=None, body=None):
        self.status_code = status_code
        self.headers = headers or {}
        self._body = {} if body is None else body

    def json(self):
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def test_pacer_spaces_calls_at_the_free_plan_interval():
    clock = {"now": 1000.0}
    slept = []

    def fake_clock():
        return clock["now"]

    def fake_sleep(seconds):
        slept.append(seconds)
        clock["now"] += seconds

    pacer = RequestPacer(4.8, sleep=fake_sleep, clock=fake_clock)
    assert pacer.wait() == 0
    assert pacer.wait() == pytest.approx(12.5)
    assert pacer.wait() == pytest.approx(12.5)
    assert slept == pytest.approx([12.5, 12.5])


def test_default_spacing_stays_under_five_requests_per_minute():
    assert settings.massive_requests_per_minute == pytest.approx(4.8)
    assert RequestPacer(settings.massive_requests_per_minute).min_interval == pytest.approx(12.5)


def test_retry_delay_floors_at_the_pacer_interval_and_caps_the_header():
    now = datetime(2026, 11, 15, 21, 0, tzinfo=timezone.utc)
    assert bounded_retry_delay("0", attempt=1, min_interval=12.5, cap=60, now=now) == pytest.approx(12.5)
    assert bounded_retry_delay("10000", attempt=1, min_interval=12.5, cap=60, now=now) == pytest.approx(60)
    assert bounded_retry_delay(
        "Sun, 15 Nov 2026 21:00:30 GMT",
        attempt=1,
        min_interval=12.5,
        cap=60,
        now=now,
    ) == pytest.approx(30)
    assert bounded_retry_delay(None, attempt=1, min_interval=12.5, cap=60, now=now) == pytest.approx(12.5)
    assert bounded_retry_delay(None, attempt=3, min_interval=12.5, cap=60, now=now) == pytest.approx(50)
    assert bounded_retry_delay(None, attempt=4, min_interval=12.5, cap=60, now=now) == pytest.approx(60)
    assert bounded_retry_delay("soon", attempt=1, min_interval=12.5, cap=60, now=now) == pytest.approx(12.5)
    assert bounded_retry_delay("soon", attempt=2, min_interval=12.5, cap=60, now=now) == pytest.approx(25)
    assert bounded_retry_delay("nan", attempt=1, min_interval=12.5, cap=60, now=now) == pytest.approx(12.5)
    assert bounded_retry_delay("inf", attempt=3, min_interval=12.5, cap=60, now=now) == pytest.approx(50)


def test_http_get_honors_retry_after_without_a_tight_loop(monkeypatch):
    responses = [
        _Response(429, {"Retry-After": "0"}),
        _Response(429, {"Retry-After": "10000"}),
        _Response(200, {}, {"status": "OK", "results": []}),
    ]
    seen = []
    sleeps = []

    def fake_get(*args, **kwargs):
        seen.append(args[0])
        return responses.pop(0)

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    body = http_get_massive(
        "massive",
        date(2026, 11, 13),
        "test-key",
        pacer=RequestPacer(4.8, sleep=lambda _seconds: None),
        sleeper=lambda seconds: sleeps.append(seconds),
        max_attempts=4,
        retry_cap=60,
    )

    assert body == {"status": "OK", "results": []}
    assert len(seen) == 3
    assert sleeps == pytest.approx([12.5, 60])
    assert "adjusted=false" in seen[0]
    assert "2026-11-13" in seen[0]
    assert "test-key" in seen[0]


def test_http_get_requests_split_adjusted_bars_only_when_explicit(monkeypatch):
    seen = []
    monkeypatch.setattr(
        "app.services.massive_client.requests.get",
        lambda url, **_kwargs: (seen.append(url) or _Response(200, body={"adjusted": True, "status": "OK", "results": []})),
    )
    http_get_massive("massive", date(2026, 11, 13), "test-key",
                     pacer=RequestPacer(4.8, sleep=lambda _seconds: None), adjusted=True)
    assert "adjusted=true" in seen[0]


def test_http_get_treats_an_unparseable_retry_after_as_backoff(monkeypatch):
    responses = [
        _Response(429, {"Retry-After": "soon"}),
        _Response(429, {"Retry-After": "nan"}),
        _Response(200, {}, {"status": "OK", "results": []}),
    ]
    sleeps = []

    def fake_get(*args, **kwargs):
        return responses.pop(0)

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    body = http_get_massive(
        "massive",
        date(2026, 11, 13),
        "test-key",
        pacer=RequestPacer(4.8, sleep=lambda _seconds: None),
        sleeper=lambda seconds: sleeps.append(seconds),
        max_attempts=4,
        retry_cap=60,
    )

    assert body == {"status": "OK", "results": []}
    assert sleeps == pytest.approx([12.5, 25])
    assert all(math.isfinite(delay) for delay in sleeps)


def test_http_get_stops_after_the_bounded_429_attempts(monkeypatch):
    calls = {"n": 0}
    sleeps = []

    def fake_get(*args, **kwargs):
        calls["n"] += 1
        return _Response(429, {"Retry-After": "1"})

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    with pytest.raises(ProviderUnavailable, match="429"):
        http_get_massive(
            "massive",
            date(2026, 11, 13),
            "test-key",
            pacer=RequestPacer(4.8, sleep=lambda _seconds: None),
            sleeper=lambda seconds: sleeps.append(seconds),
            max_attempts=3,
            retry_cap=60,
        )

    assert calls["n"] == 3
    assert len(sleeps) == 2
    assert all(delay >= 12.5 for delay in sleeps)
    assert all(delay <= 60 for delay in sleeps)


def test_shared_pacer_is_reused_across_callers():
    reset_shared_pacer()
    try:
        assert get_shared_pacer() is get_shared_pacer()
    finally:
        reset_shared_pacer()


def test_ticker_reference_error_hides_the_request(monkeypatch):
    seen = []

    def fake_get(*args, **kwargs):
        seen.append(args[0])
        return _Response(404, {})

    monkeypatch.setattr("app.services.massive_client.requests.get", fake_get)
    with pytest.raises(ProviderUnavailable, match="status 404") as caught:
        http_get_massive_ticker(
            "EXMP",
            "test-key",
            pacer=RequestPacer(4.8, sleep=lambda _seconds: None),
            sleeper=lambda _seconds: None,
            max_attempts=1,
        )

    message = str(caught.value)
    assert seen and "/v3/reference/tickers/EXMP" in seen[0]
    assert "test-key" not in message
    assert "apiKey" not in message
    assert "api.massive.com" not in message
