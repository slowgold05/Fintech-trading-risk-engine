"""The only symbols Kronos may forecast or evaluate.

``FEATURED_FORECAST_SYMBOLS`` in ``app.core.config`` is the list. This module
enforces it. Stage 6 step 3, chosen 2026-11-15.
"""

from app.core.config import FEATURED_FORECAST_SYMBOLS


class ForecastSymbolRejected(ValueError):
    """The symbol is outside the fixed 12-stock forecast list."""


def require_featured_forecast_symbol(symbol: str) -> str:
    """Return the canonical symbol, or reject anything outside the twelve."""
    normalized = symbol.strip().upper()
    if normalized not in FEATURED_FORECAST_SYMBOLS:
        raise ForecastSymbolRejected(
            f"{normalized or symbol} is outside the 12 featured forecast stocks."
        )
    return normalized
