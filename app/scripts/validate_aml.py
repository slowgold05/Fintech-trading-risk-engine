"""Write AML validation reports and merge them into the model inventory.

The counts come from the labeled scorer. This script does not download or run IBM AMLSim.
"""

import json
from pathlib import Path

from app.services.aml_backtest import score_all
from app.services.aml_rules import load_rules
from app.services.model_inventory import INVENTORY, merge_models, model_entry


ROOT = Path(__file__).resolve().parents[2]
REPORT_DIR = ROOT / "grc" / "models" / "reports"


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
            "The counts below come from `app.services.aml_backtest.score_rule` on "
            "`grc/aml/scenarios`. The scenarios are hand-labeled paper movements. "
            "They are not an IBM AMLSim graph export. They are not a production performance claim.",
            "",
            "## Labeled result",
            "",
            f"- Scenarios: {score['scenarios']}",
            f"- True positives: {score['true_positive']}",
            f"- False positives: {score['false_positive']}",
            f"- True negatives: {score['true_negative']}",
            f"- False negatives: {score['false_negative']}",
            f"- Precision: {_ratio(score['precision'])} (true positives / alerts)",
            f"- Recall: {_ratio(score['recall'])} (true positives / labeled positives)",
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
            f"An active version opens one case per rule and account. The due time is {rule['sla_hours']} hours "
            "after the case opens. SM-AML-03 fails when a case is still open after that time or was closed late. "
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
