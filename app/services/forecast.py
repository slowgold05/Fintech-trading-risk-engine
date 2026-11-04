"""Advisory forecast from historical volatility.

Kronos weights are not downloaded and the Kronos path cannot feed a risk rule.
The validated signal is a trailing sample standard deviation of log returns.
It is advisory. Hard limits stay deterministic.
"""

from __future__ import annotations

import math
import random
from decimal import Decimal
from statistics import stdev


MODEL_ID = "SM-FC-01"


def sample_closes() -> list[Decimal]:
    price = Decimal("100")
    closes = [price]
    for index in range(40):
        price = (price * Decimal("1.01")).quantize(Decimal("0.0001")) if index % 2 == 0 else (price * Decimal("0.99")).quantize(Decimal("0.0001"))
        closes.append(price)
    return closes


def _returns(closes: list[Decimal]) -> list[float]:
    values = []
    for previous, nxt in zip(closes, closes[1:]):
        if previous <= 0 or nxt <= 0:
            return []
        values.append(math.log(float(nxt) / float(previous)))
    return values


def forecast_from_closes(closes: list[Decimal], horizon: int = 1) -> dict | None:
    returns = _returns(closes)
    if len(returns) < 2:
        return None
    sigma = stdev(returns)
    span = sigma * math.sqrt(max(horizon, 1))
    last = float(closes[-1])
    return {
        "model_id": MODEL_ID,
        "advisory": True,
        "vol_daily": Decimal(str(round(sigma, 6))),
        "lower": Decimal(str(round(last * math.exp(-1.96 * span), 4))),
        "upper": Decimal(str(round(last * math.exp(1.96 * span), 4))),
        "last": Decimal(str(round(last, 4))),
    }


def walk_forward(closes: list[Decimal], window: int = 10) -> dict:
    hits = 0
    trials = 0
    abs_errors: list[Decimal] = []
    for index in range(window, len(closes) - 1):
        view = forecast_from_closes(closes[index - window:index + 1])
        if view is None:
            continue
        nxt = closes[index + 1]
        trials += 1
        if view["lower"] <= nxt <= view["upper"]:
            hits += 1
        realized = abs(math.log(float(nxt) / float(closes[index])))
        abs_errors.append(Decimal(str(round(realized, 6))))
    hit_rate = (hits / trials) if trials else None
    return {
        "model_id": MODEL_ID,
        "trials": trials,
        "hits": hits,
        "hit_rate": hit_rate,
        "abs_errors": abs_errors,
        "passed": bool(trials >= 5 and hit_rate is not None and hit_rate >= 0.8),
    }


def monitor_status(abs_errors: list[Decimal], threshold: Decimal = Decimal("0.20")) -> str:
    if not abs_errors:
        return "no_sample"
    mean = sum(abs_errors, Decimal(0)) / Decimal(len(abs_errors))
    return "disabled" if mean > threshold else "enabled"


def simulate_paths(closes: list[Decimal], horizon: int = 5, paths: int = 200,
                   drawdown_limit: Decimal = Decimal("0.10"), seed: int = 1729) -> dict | None:
    """Seeded historical-volatility paths. This does not load Kronos weights."""
    returns = _returns(closes)
    if len(returns) < 2:
        return None
    sigma = stdev(returns)
    mu = sum(returns) / len(returns)
    rng = random.Random(seed)
    last = float(closes[-1])
    losses: list[float] = []
    breaches = 0
    limit = float(drawdown_limit)
    for _ in range(paths):
        price = last
        peak = last
        breached = False
        for _step in range(max(horizon, 1)):
            price *= math.exp(rng.gauss(mu, sigma))
            if price > peak:
                peak = price
            if peak > 0 and (peak - price) / peak >= limit:
                breached = True
        losses.append(max(last - price, 0.0))
        if breached:
            breaches += 1
    losses.sort()

    def percentile(fraction: float) -> Decimal:
        index = min(len(losses) - 1, max(0, int(round((len(losses) - 1) * fraction))))
        return Decimal(str(round(losses[index], 4)))

    return {
        "model_id": MODEL_ID,
        "method": "seeded historical-volatility paths",
        "paths": paths,
        "horizon": horizon,
        "seed": seed,
        "drawdown_limit": drawdown_limit,
        "drawdown_probability": Decimal(str(round(breaches / paths, 4))),
        "loss_p50": percentile(0.50),
        "loss_p95": percentile(0.95),
    }


def advisory_signal(validation_passed: bool, status: str, view: dict | None) -> dict | None:
    if not validation_passed or status != "enabled" or view is None:
        return None
    return view


def kronos_status(checkpoint: str = "") -> dict:
    if checkpoint:
        return {
            "enabled": False,
            "reason": "A checkpoint path is set, but this build does not load Kronos weights.",
        }
    return {"enabled": False, "reason": "No local Kronos checkpoint is configured. Weights were not downloaded."}


def soft_limit_note(signal: dict | None, hard_limit: Decimal) -> dict:
    """Return the unchanged hard limit plus an advisory note. The note cannot tighten the limit."""
    note = None
    if signal is not None and signal["vol_daily"] >= Decimal("0.05"):
        note = "Forecast volatility is elevated. The hard limit is unchanged."
    return {"hard_limit": hard_limit, "advisory_note": note}
