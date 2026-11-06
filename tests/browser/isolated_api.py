"""Browser-test API entry point with provider HTTP disabled in this process."""

import requests


def _no_provider_http(*_args, **_kwargs):
    raise requests.RequestException("External HTTP is disabled in the disposable browser API.")


requests.sessions.Session.request = _no_provider_http

from app.main import app  # noqa: E402,F401
