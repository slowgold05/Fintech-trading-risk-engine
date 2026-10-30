import csv
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest
import yaml

from app.scripts.export_controls import export_controls


def test_control_export_uses_yaml_ids_and_rejects_incomplete_rows():
    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        assert root.resolve().parent == Path.cwd().resolve()
        output = root / "matrix.csv"
        assert export_controls(Path("grc/controls"), output) == 10
        with output.open(newline="", encoding="utf-8") as csv_file:
            rows = list(csv.DictReader(csv_file))
        assert [row["id"] for row in rows] == ["SM-AC-01", "SM-AC-02", "SM-CM-01", "SM-LD-01",
                                                 "SM-MD-01", "SM-PT-02", "SM-PT-03", "SM-PT-04", "SM-PT-05", "SM-SM-01"]
        assert all(row["test"] and row["evidence"] for row in rows)

        (root / "SM-BAD-01.yaml").write_text("id: SM-BAD-01\ntitle: Incomplete\n", encoding="utf-8")
        with pytest.raises(ValueError, match="Incomplete control"):
            export_controls(root, output)


def test_risk_register_has_unique_ids_and_known_control_links():
    risks = yaml.safe_load(Path("grc/risk_register.yaml").read_text(encoding="utf-8"))["risks"]
    ids = [risk["id"] for risk in risks]
    controls = {path.stem for path in Path("grc/controls").glob("*.yaml")}
    assert len(risks) == len(set(ids)) == 15
    assert all(risk["inherent_rating"] in {"low", "moderate", "high"}
               and set(risk["controls"]) <= controls for risk in risks)
