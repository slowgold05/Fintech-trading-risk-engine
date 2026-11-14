import csv
from pathlib import Path

_CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "index_benchmarks.csv"


def load_index_benchmarks() -> list[dict]:
    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
