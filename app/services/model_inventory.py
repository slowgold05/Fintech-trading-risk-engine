"""Merge model-inventory rows by id.

Surveillance and AML writers both update this file. Replacing the file from one
writer would drop the other family. Approval stays pending in either case.
"""

from pathlib import Path

import yaml


INVENTORY = Path(__file__).resolve().parents[2] / "grc" / "models" / "inventory.yaml"
METHOD = (
    "Each scenario is labeled fire or do-not-fire before the detector runs. "
    "Precision is true positives divided by alerts. Recall is true positives divided by labeled positives. "
    "Surveillance scenarios live in grc/surveillance/scenarios. "
    "AML scenarios are hand-labeled JSON in grc/aml/scenarios. They are not an AMLSim graph export."
)


def model_entry(rule: dict, score: dict) -> dict:
    precision = score["precision"]
    recall = score["recall"]
    return {
        "id": rule["id"],
        "version": rule["version"],
        "title": rule["title"],
        "model_type": rule["model_type"],
        "owner": rule["owner"],
        "activation": "database record required; the YAML file is not an activation",
        "validation_report": f"grc/models/reports/{rule['id']}.md",
        "scenarios": score["scenarios"],
        "true_positive": score["true_positive"],
        "false_positive": score["false_positive"],
        "true_negative": score["true_negative"],
        "false_negative": score["false_negative"],
        "precision": None if precision is None else round(float(precision), 4),
        "recall": None if recall is None else round(float(recall), 4),
    }


def merge_models(models: list[dict], path: Path | None = None) -> None:
    target = path or INVENTORY
    existing_models: list[dict] = []
    status = "draft"
    if target.exists():
        loaded = yaml.safe_load(target.read_text(encoding="utf-8")) or {}
        if isinstance(loaded, dict):
            status = loaded.get("status") or status
            rows = loaded.get("models") or []
            if isinstance(rows, list):
                existing_models = [item for item in rows if isinstance(item, dict) and item.get("id")]
    by_id = {item["id"]: item for item in existing_models}
    order = [item["id"] for item in existing_models]
    for model in models:
        if model["id"] not in by_id:
            order.append(model["id"])
        by_id[model["id"]] = model
    document = {
        "status": status,
        "approval": "Pending model owner review",
        "method": METHOD,
        "models": [by_id[key] for key in order],
    }
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(yaml.safe_dump(document, sort_keys=False), encoding="utf-8", newline="\n")
