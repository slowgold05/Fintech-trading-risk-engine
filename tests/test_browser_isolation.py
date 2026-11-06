import runpy
from pathlib import Path

import pytest
import requests


def test_disposable_browser_api_blocks_provider_http(monkeypatch):
    def unexpected_network(*_args, **_kwargs):
        raise AssertionError("Browser API entry point failed to block external HTTP")

    monkeypatch.setattr(requests.sessions.Session, "request", unexpected_network)
    entry = Path(__file__).parent / "browser" / "isolated_api.py"
    namespace = runpy.run_path(str(entry))
    assert namespace["app"].title == "Fintech Trading & Risk Engine"
    with pytest.raises(requests.RequestException, match="External HTTP is disabled"):
        requests.get("https://provider.invalid/quote", timeout=1)
