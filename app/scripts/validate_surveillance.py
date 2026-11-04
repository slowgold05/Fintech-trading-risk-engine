"""Write the model inventory and per-rule validation reports from the labeled backtest."""

import json
from pathlib import Path

from app.services.model_inventory import merge_models, model_entry
from app.services.surveillance_backtest import score_all
from app.services.surveillance_rules import load_rules


ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / "grc" / "models" / "reports"
INVENTORY = ROOT / "grc" / "models" / "inventory.yaml"


def _ratio(value: float | None) -> str:
    if value is None:
        return "not defined"
    return f"{value:.4f}"


def write_reports() -> dict[str, dict]:
    rules = load_rules()
    scores = score_all()
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    entries = []
    for rule_id, rule in rules.items():
        score = scores[rule_id]
        precision = score["precision"]
        recall = score["recall"]
        lines = [
            f"# {rule_id} validation report",
            "",
            f"**Model:** {rule['title']} version {rule['version']}",
            f"**Type:** {rule['model_type']}",
            f"**Owner:** {rule['owner']}",
            "**Status:** Draft. Pending model owner review. This report is not an activation.",
            "",
            "## Principle",
            "",
            "The check follows the SR 26-2 idea that a model is inventoried, validated before use, "
            "activated only by someone other than the requester, and monitored after activation. "
            "The counts below come from `app.services.surveillance_backtest.score_rule` on "
            "`grc/surveillance/scenarios`. They describe this labeled set. They are not a production performance claim.",
            "",
            "## Labeled result",
            "",
            f"- Scenarios: {score['scenarios']}",
            f"- True positives: {score['true_positive']}",
            f"- False positives: {score['false_positive']}",
            f"- True negatives: {score['true_negative']}",
            f"- False negatives: {score['false_negative']}",
            f"- Precision: {_ratio(precision)} (true positives / alerts)",
            f"- Recall: {_ratio(recall)} (true positives / labeled positives)",
            f"- Misses: {', '.join(score['misses']) if score['misses'] else 'none'}",
            "",
            "## Limitations",
            "",
        ]
        lines.extend(f"- {item}" for item in rule["limitations"])
        lines.extend([
            "",
            "## Ongoing monitoring",
            "",
            f"An active version opens one case per rule, account, and symbol. The due time is {rule['sla_hours']} hours "
            "after the case opens. SM-SV-05 fails when a case is still open after that time or was closed late. "
            "A book with no cases is `no_sample`. The backtest does not write production cases.",
            "",
            "**Approval:** Pending model owner review.",
            "",
        ])
        (REPORT_DIR / f"{rule_id}.md").write_text("\n".join(lines), encoding="utf-8", newline="\n")
        entries.append(model_entry(rule, score))
    merge_models(entries, INVENTORY)
    return scores


def main() -> None:
    scores = write_reports()
    print(json.dumps({
        rule_id: {"precision": item["precision"], "recall": item["recall"], "misses": item["misses"]}
        for rule_id, item in scores.items()
    }, default=str))
    if any(item["precision"] is None or item["recall"] is None or item["misses"] for item in scores.values()):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
