import csv
from pathlib import Path
from tempfile import TemporaryDirectory

import pytest

from app.scripts.export_controls import export_controls


def test_control_export_uses_yaml_ids_and_rejects_incomplete_rows():
    with TemporaryDirectory(dir=Path.cwd()) as folder:
        root = Path(folder)
        assert root.resolve().parent == Path.cwd().resolve()
        output = root / "matrix.csv"
        assert export_controls(Path("grc/controls"), output) == 6
        with output.open(newline="", encoding="utf-8") as csv_file:
            rows = list(csv.DictReader(csv_file))
        assert [row["id"] for row in rows] == ["SM-AC-01", "SM-AC-02", "SM-LD-01", "SM-MD-01", "SM-PT-02", "SM-PT-04"]
        assert all(row["test"] and row["evidence"] for row in rows)

        (root / "SM-BAD-01.yaml").write_text("id: SM-BAD-01\ntitle: Incomplete\n", encoding="utf-8")
        with pytest.raises(ValueError, match="Incomplete control"):
            export_controls(root, output)
