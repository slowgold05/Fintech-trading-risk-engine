import csv
import json
from pathlib import Path

import yaml


CONTROL_DIR = Path("grc/controls")
OUTPUT = Path("grc/control_matrix.csv")
FIELDS = ("id", "title", "objective", "type", "owner", "frequency", "test", "evidence", "threshold", "mappings", "risks")


def export_controls(control_dir: Path = CONTROL_DIR, output: Path = OUTPUT) -> int:
    controls = []
    seen = set()
    for path in sorted(control_dir.glob("*.yaml")):
        control = yaml.safe_load(path.read_text(encoding="utf-8"))
        if not isinstance(control, dict) or any(not control.get(field) for field in FIELDS[:8]):
            raise ValueError(f"Incomplete control definition: {path}")
        if control["id"] != path.stem or control["id"] in seen:
            raise ValueError(f"Invalid or duplicate control ID: {path}")
        if not isinstance(control.get("risks", []), list) or not isinstance(control.get("mappings", {}), dict):
            raise ValueError(f"Invalid risks or mappings: {path}")
        seen.add(control["id"])
        controls.append({
            **{field: control.get(field, "") for field in FIELDS[:-2]},
            "mappings": json.dumps(control.get("mappings", {}), sort_keys=True),
            "risks": "; ".join(control.get("risks", [])),
        })

    if not controls:
        raise ValueError("No controls found")
    with output.open("w", encoding="utf-8", newline="") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(controls)
    return len(controls)


def main() -> None:
    print(f"Exported {export_controls()} controls to {OUTPUT}")


if __name__ == "__main__":
    main()
