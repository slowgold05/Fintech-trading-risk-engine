"""Browser-test API entry point with provider HTTP disabled in this process."""

import os

import requests


def _no_provider_http(*_args, **_kwargs):
    raise requests.RequestException("External HTTP is disabled in the disposable browser API.")


requests.sessions.Session.request = _no_provider_http

from app.main import app  # noqa: E402,F401

# Test-only payload mutation. runpy sets __name__ to "<run_path>", so the
# backend isolation test does not install this wrapper.
if os.environ.get("P3A_BAD_HISTORY_FIXTURE") == "1" and __name__ == "isolated_api":
    import app.services.market_history as market_history

    _original_symbol_history = market_history._symbol_history

    def _symbol_history_bad_close(db, *, symbol, interval, range_token, provider, adjustment_type):
        payload = _original_symbol_history(
            db,
            symbol=symbol,
            interval=interval,
            range_token=range_token,
            provider=provider,
            adjustment_type=adjustment_type,
        )
        if symbol == "P3INVALID" and isinstance(payload, dict):
            bars = payload.get("bars")
            if isinstance(bars, list) and bars:
                bars[0]["close"] = "NaN"
        return payload

    market_history._symbol_history = _symbol_history_bad_close
