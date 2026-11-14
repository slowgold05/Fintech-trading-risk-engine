"""Finnhub company news. HTTP is mocked; nothing here calls the live API."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
import requests

from app.services.finnhub_news import fetch_company_news, http_get_finnhub_news
from app.services.market_providers import ProviderUnavailable


def test_empty_key_raises_without_calling_http_get() -> None:
    def http_get(*_args, **_kwargs):
        raise AssertionError("http_get should not be called")

    with pytest.raises(ProviderUnavailable, match="FINNHUB_API_KEY is empty"):
        fetch_company_news("AAPL", "", http_get=http_get)


def test_malformed_payload_raises() -> None:
    def http_get(symbol, from_date, to_date, api_key):
        assert symbol == "AAPL"
        assert api_key == "test-key"
        return {"error": "unexpected object"}

    with pytest.raises(ProviderUnavailable, match="not a list"):
        fetch_company_news("AAPL", "test-key", http_get=http_get)


def test_well_formed_payload_is_normalized_sorted_and_capped() -> None:
    base = 1_700_000_000
    raw = [
        {
            "category": "company",
            "datetime": base + index,
            "headline": f"Headline {index}",
            "id": index,
            "image": "https://example.com/img.png",
            "related": "AAPL",
            "source": "Reuters",
            "summary": f"Summary {index}",
            "url": f"https://example.com/{index}",
        }
        for index in range(22)
    ]
    raw.extend(
        [
            {
                "datetime": base + 10_000,
                "summary": "no headline",
                "source": "Reuters",
                "url": "https://example.com/no-headline",
            },
            {
                "datetime": base + 9_000,
                "headline": "Missing url",
                "summary": "no link",
                "source": "Reuters",
            },
            {"headline": "", "url": "https://example.com/blank", "datetime": base + 8_000},
            "not-a-dict",
        ]
    )

    def http_get(symbol, from_date, to_date, api_key):
        assert symbol == "AAPL"
        assert api_key == "test-key"
        today = datetime.now(timezone.utc).date()
        assert to_date == today.isoformat()
        assert from_date == (today - timedelta(days=14)).isoformat()
        return raw

    result = fetch_company_news("AAPL", "test-key", http_get=http_get)

    assert len(result) == 20
    assert [item["headline"] for item in result] == [f"Headline {index}" for index in range(21, 1, -1)]
    newest = result[0]
    assert newest == {
        "headline": "Headline 21",
        "summary": "Summary 21",
        "source": "Reuters",
        "url": "https://example.com/21",
        "published_at": datetime.fromtimestamp(base + 21, timezone.utc).isoformat(),
    }
    assert list(newest) == ["headline", "summary", "source", "url", "published_at"]
    assert all(result[index]["published_at"] > result[index + 1]["published_at"] for index in range(19))
    assert "Missing url" not in [item["headline"] for item in result]


def test_http_get_finnhub_news_puts_the_range_and_token_in_the_url_and_rejects_non_200(monkeypatch) -> None:
    seen = []

    def fake_get(*args, **kwargs):
        seen.append((args[0] if args else kwargs.get("url"), kwargs.get("timeout")))
        return SimpleNamespace(status_code=200, json=lambda: [])

    monkeypatch.setattr("app.services.finnhub_news.requests.get", fake_get)
    body = http_get_finnhub_news("AAPL", "2026-10-29", "2026-11-12", "test-key")
    assert body == []
    assert seen[0][1] == 15
    assert seen[0][0].startswith("https://finnhub.io/api/v1/company-news?")
    assert "symbol=AAPL" in seen[0][0]
    assert "from=2026-10-29" in seen[0][0]
    assert "to=2026-11-12" in seen[0][0]
    assert "token=test-key" in seen[0][0]

    def fake_denied(*args, **kwargs):
        return SimpleNamespace(status_code=503)

    monkeypatch.setattr("app.services.finnhub_news.requests.get", fake_denied)
    with pytest.raises(ProviderUnavailable, match="503"):
        http_get_finnhub_news("AAPL", "2026-10-29", "2026-11-12", "test-key")

    def fake_timeout(*args, **kwargs):
        raise requests.Timeout("timed out")

    monkeypatch.setattr("app.services.finnhub_news.requests.get", fake_timeout)
    with pytest.raises(ProviderUnavailable, match="Timeout"):
        http_get_finnhub_news("AAPL", "2026-10-29", "2026-11-12", "test-key")

    def fake_bad_json(*args, **kwargs):
        def json():
            raise ValueError("nope")

        return SimpleNamespace(status_code=200, json=json)

    monkeypatch.setattr("app.services.finnhub_news.requests.get", fake_bad_json)
    with pytest.raises(ProviderUnavailable, match="ValueError"):
        http_get_finnhub_news("AAPL", "2026-10-29", "2026-11-12", "test-key")
