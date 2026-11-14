import runpy
from pathlib import Path

import pytest
import requests


def test_disposable_browser_api_blocks_provider_http(monkeypatch):
    def unexpected_network(*_args, **_kwargs):
        raise AssertionError("Browser API entry point failed to block external HTTP")

    monkeypatch.setattr(requests.sessions.Session, "request", unexpected_network)
    monkeypatch.delenv("P3A_BAD_HISTORY_FIXTURE", raising=False)
    import app.services.market_history as market_history

    original_history = market_history._symbol_history
    entry = Path(__file__).parent / "browser" / "isolated_api.py"
    namespace = runpy.run_path(str(entry))
    assert namespace["app"].title == "Fintech Trading & Risk Engine"
    assert market_history._symbol_history is original_history
    with pytest.raises(requests.RequestException, match="External HTTP is disabled"):
        requests.get("https://provider.invalid/quote", timeout=1)
