import json
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from app.services.aml_detect import CashEvent, detect
from app.services.aml_rules import SCENARIO_DIR, load_rules


def parse_event(raw: dict) -> CashEvent:
    parsed = datetime.fromisoformat(str(raw["at"]).replace("Z", "+00:00"))
    if parsed.tzinfo is not None:
        parsed = parsed.astimezone(timezone.utc).replace(tzinfo=None)
    return CashEvent(str(raw["event_id"]), parsed, int(raw["user_id"]), str(raw["kind"]), Decimal(str(raw["amount"])))


def load_scenarios(rule_id: str, directory: Path | None = None) -> list[dict]:
    path = (directory or SCENARIO_DIR) / f"{rule_id}.json"
    loaded = json.loads(path.read_text(encoding="utf-8"))
    if loaded.get("rule_id") != rule_id or not isinstance(loaded.get("scenarios"), list) or not loaded["scenarios"]:
        raise ValueError(f"Labeled scenarios are incomplete: {path}")
    return loaded["scenarios"]


def score_rule(rule: dict, scenarios: list[dict] | None = None) -> dict:
    rows = scenarios if scenarios is not None else load_scenarios(rule["id"])
    counts = {"true_positive": 0, "false_positive": 0, "true_negative": 0, "false_negative": 0}
    misses = []
    for scenario in rows:
        fired = bool(detect(rule, [parse_event(item) for item in scenario["events"]]))
        label = bool(scenario["label"])
        if label and fired:
            counts["true_positive"] += 1
        elif label and not fired:
            counts["false_negative"] += 1
            misses.append(scenario["id"])
        elif fired:
            counts["false_positive"] += 1
            misses.append(scenario["id"])
        else:
            counts["true_negative"] += 1
    predicted = counts["true_positive"] + counts["false_positive"]
    actual = counts["true_positive"] + counts["false_negative"]
    return {
        **counts,
        "precision": counts["true_positive"] / predicted if predicted else None,
        "recall": counts["true_positive"] / actual if actual else None,
        "scenarios": len(rows),
        "misses": misses,
    }


def score_all() -> dict[str, dict]:
    return {rule_id: score_rule(rule) for rule_id, rule in load_rules().items()}
