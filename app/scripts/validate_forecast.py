"""Write the historical-volatility model card, report, and inventory row.

The numbers come from walk_forward and simulate_paths on the built-in sample.
This script does not download weights and does not set approval.
"""

import json
from pathlib import Path

from app.services.forecast import MODEL_ID, sample_closes, simulate_paths, walk_forward
from app.services.model_inventory import merge_models


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "grc" / "models" / "reports" / "SM-FC-01.md"
CARD = ROOT / "grc" / "models" / "cards" / "SM-FC-01.md"
INVENTORY = ROOT / "grc" / "models" / "inventory.yaml"


def write_reports() -> dict:
    closes = sample_closes()
    score = walk_forward(closes)
    paths = simulate_paths(closes)
    if paths is None:
        raise RuntimeError("The sample closes did not produce a simulation")
    hit_rate = score["hit_rate"]
    hit_text = "not defined" if hit_rate is None else f"{hit_rate:.4f}"
    report = [
        f"# {MODEL_ID} validation report",
        "",
        "**Model:** Historical volatility forecast version 1",
        "**Type:** historical_volatility",
        "**Owner:** Market Risk",
        "**Status:** Draft. Pending model owner review. This report is not an activation.",
        "",
        "## Principle",
        "",
        "The check follows the SR 11-7 idea that a model is inventoried and validated before a risk rule uses it. "
        "The counts below come from `app.services.forecast.walk_forward` on `sample_closes`. "
        "Hit rate is the share of next closes that landed inside the one-step band. It is not precision or recall.",
        "",
        "## Walk-forward result",
        "",
        f"- Trials: {score['trials']}",
        f"- Hits: {score['hits']}",
        f"- Hit rate: {hit_text}",
        f"- Passed: {score['passed']}",
        "",
        "## Seeded paths",
        "",
        "These paths use the Python standard library random generator and the sample standard deviation of log returns. "
        "They are not Kronos samples.",
        "",
        f"- Paths: {paths['paths']}",
        f"- Horizon: {paths['horizon']}",
        f"- Seed: {paths['seed']}",
        f"- Drawdown limit: {paths['drawdown_limit']}",
        f"- Drawdown probability: {paths['drawdown_probability']}",
        f"- Loss p50: {paths['loss_p50']}",
        f"- Loss p95: {paths['loss_p95']}",
        "",
        "## Limitations",
        "",
        "- The sample series is a deterministic up-and-down fixture, not a market history.",
        "- Kronos weights are not loaded. A checkpoint path does not enable that model.",
        "- The advisory note does not change a hard limit.",
        "- The monitor disables the signal when the mean absolute log error is above 0.20.",
        "",
        "**Approval:** Pending model owner review.",
        "",
    ]
    card = [
        f"# {MODEL_ID} model card",
        "",
        "**Status:** Draft. Pending model owner review.",
        "",
        "## Purpose",
        "",
        "Estimate a one-step price band from the trailing sample standard deviation of log returns, and show a seeded loss distribution. The output is an advisory signal.",
        "",
        "## Data",
        "",
        "The stored report uses `sample_closes`, a 41-point alternating 1 percent fixture. A caller can pass other closes. No vendor was called to produce this card.",
        "",
        "## Version",
        "",
        "Version 1. The implementation is `app.services.forecast`. There is no weight file.",
        "",
        "## Owner",
        "",
        "Market Risk. Approval is pending model owner review.",
        "",
        "## Limitations",
        "",
        "- The band assumes the recent log-return dispersion continues for the horizon.",
        "- The drawdown probability is a seeded simulation, not a Kronos forecast.",
        "- A disabled monitor or a failed validation returns no signal.",
        "",
        "## Approved uses",
        "",
        "None. Pending model owner review.",
        "",
        "## Prohibited uses",
        "",
        "- Changing a hard position, concentration, buying-power, or price-band limit.",
        "- Placing an order.",
        "- Treating the fixture hit rate as production accuracy.",
        "- Loading or claiming a Kronos checkpoint in this build.",
        "",
    ]
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    CARD.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text("\n".join(report), encoding="utf-8", newline="\n")
    CARD.write_text("\n".join(card), encoding="utf-8", newline="\n")
    merge_models([{
        "id": MODEL_ID,
        "version": 1,
        "title": "Historical volatility forecast",
        "model_type": "historical_volatility",
        "owner": "Market Risk",
        "activation": "advisory only after validation passes and the monitor is enabled; the YAML row is not an activation",
        "validation_report": "grc/models/reports/SM-FC-01.md",
        "model_card": "grc/models/cards/SM-FC-01.md",
        "trials": score["trials"],
        "hits": score["hits"],
        "hit_rate": None if hit_rate is None else round(float(hit_rate), 4),
        "passed": bool(score["passed"]),
        "note": "Hit rate is the share of walk-forward closes inside the band. It is not precision or recall.",
    }], INVENTORY)
    return {"score": score, "paths": paths}


def main() -> None:
    written = write_reports()
    score = written["score"]
    print(json.dumps({
        "trials": score["trials"],
        "hits": score["hits"],
        "hit_rate": score["hit_rate"],
        "passed": score["passed"],
        "drawdown_probability": written["paths"]["drawdown_probability"],
    }, default=str))
    if not score["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
