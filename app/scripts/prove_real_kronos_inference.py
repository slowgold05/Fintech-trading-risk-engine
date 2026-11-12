"""Prove one real Kronos inference call end to end.

Tests and CI do not run this script. It requires requirements-forecast.txt
installed (torch, pandas, the vendored kronos package's own HuggingFace
download of NeoQuasar/Kronos-small and NeoQuasar/Kronos-Tokenizer-base).

Seeds a synthetic, in-memory SQLite database with a realistic random-walk
daily OHLCV series (never real market data -- this is a mechanism proof,
not a forecast-quality claim) and calls generate_forecast for real,
downloading the real pinned weights on first run.

Usage: python -m app.scripts.prove_real_kronos_inference
"""

import random
import sys
import time
from datetime import date, datetime, timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.models.market_bar_daily import MarketBarDaily
from app.models.market_symbol import MarketSymbol
from app.services.exchange_calendar import is_nyse_trading_day
from app.services.forecast_kronos import generate_forecast

SYMBOL = "KRNPROOF"
LOOKBACK = 400
HORIZON = 10


def _recent_sessions(count: int) -> list[date]:
    found: list[date] = []
    day = date.today()
    while len(found) < count:
        day -= timedelta(days=1)
        if is_nyse_trading_day(day):
            found.append(day)
    found.reverse()
    return found


def main() -> None:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    db.add(MarketSymbol(symbol=SYMBOL, company_name="Kronos real-inference proof", exchange="NASDAQ", is_active=True))
    db.flush()

    random.seed(42)
    price = 150.0
    for session_date in _recent_sessions(LOOKBACK + 20):
        change = random.uniform(-0.02, 0.02)
        open_ = price
        close = price * (1 + change)
        high = max(open_, close) * (1 + random.uniform(0, 0.01))
        low = min(open_, close) * (1 - random.uniform(0, 0.01))
        db.add(MarketBarDaily(
            symbol=SYMBOL, session_date=session_date, provider="yahoo", adjustment_type="raw",
            open=Decimal(str(round(open_, 6))), high=Decimal(str(round(high, 6))),
            low=Decimal(str(round(low, 6))), close=Decimal(str(round(close, 6))),
            volume=1_000_000, fetched_at=datetime.utcnow(), quality_status="valid",
        ))
        price = close
    db.commit()
    print(f"Seeded {LOOKBACK + 20} synthetic (non-real-market) daily bars for {SYMBOL}.")

    start = time.time()
    result = generate_forecast(
        db, symbol=SYMBOL, provider="yahoo", adjustment_type="raw",
        lookback=LOOKBACK, horizon=HORIZON, sample_count=1, seed=42,
    )
    elapsed = time.time() - start

    print(f"Real inference completed in {elapsed:.1f}s against real weights.")
    print(f"Model: {result['model_name']}  Tokenizer: {result['tokenizer_name']}")
    print(f"Input cutoff: {result['input_cutoff']}  Generated at: {result['generated_at']}")
    print(f"Forecast bars: {len(result['bars'])}")
    for bar in result["bars"]:
        print(f"  {bar}")

    assert len(result["bars"]) == HORIZON, "expected one bar per requested horizon day"

    # The raw model output has no hard OHLC-ordering guarantee -- it is a
    # generative sampler, not a rule-based system. Observe and report this
    # rather than assert it away; a real finding, not a proof-script bug.
    violations = [
        bar for bar in result["bars"]
        if not (bar["low"] <= bar["open"] <= bar["high"] and bar["low"] <= bar["close"] <= bar["high"])
    ]
    if violations:
        print(f"NOTE: {len(violations)}/{HORIZON} raw forecast bars violate OHLC ordering "
              "(low <= open/close <= high) -- the raw model output has no hard guarantee of this. "
              "Any consumer that stores these (e.g. a table with OHLC CheckConstraints) needs its "
              "own clamping/validation layer before persisting raw Kronos output. Not fixed here.")
        for bar in violations:
            print(f"  violates ordering: {bar}")
    else:
        print("OHLC ordering happened to hold on every bar in this run (not a guarantee).")


if __name__ == "__main__":
    main()
