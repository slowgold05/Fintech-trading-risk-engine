from decimal import Decimal
from pathlib import Path

import yaml


RULE_DIR = Path(__file__).resolve().parents[2] / "grc" / "surveillance"
SCENARIO_DIR = RULE_DIR / "scenarios"
REQUIRED = ("id", "version", "title", "purpose", "model_type", "parameters", "sla_hours", "limitations")


def load_rules(directory: Path | None = None) -> dict[str, dict]:
    root = directory or RULE_DIR
    rules = {}
    for path in sorted(root.glob("SM-SV-*.yaml")):
        loaded = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict) or any(loaded.get(field) in (None, "") for field in REQUIRED):
            raise ValueError(f"Incomplete surveillance rule: {path}")
        if loaded["id"] != path.stem or loaded["id"] in rules:
            raise ValueError(f"Invalid or duplicate surveillance rule: {path}")
        if not isinstance(loaded["parameters"], dict) or not isinstance(loaded["limitations"], list):
            raise ValueError(f"Surveillance rule parameters are invalid: {path}")
        if int(loaded["version"]) < 1 or int(loaded["sla_hours"]) < 1:
            raise ValueError(f"Surveillance rule version or SLA is invalid: {path}")
        loaded["version"] = int(loaded["version"])
        loaded["sla_hours"] = int(loaded["sla_hours"])
        rules[loaded["id"]] = loaded
    if not rules:
        raise ValueError("No surveillance rules found")
    return rules


def decimal_param(rule: dict, name: str) -> Decimal:
    return Decimal(str(rule["parameters"][name]))


def int_param(rule: dict, name: str) -> int:
    return int(rule["parameters"][name])
