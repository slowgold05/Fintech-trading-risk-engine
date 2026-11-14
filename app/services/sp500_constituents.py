import csv
from pathlib import Path

_CSV_PATH = Path(__file__).resolve().parent.parent / "data" / "sp500_constituents.csv"


def load_sp500_constituents() -> list[dict]:
    with open(_CSV_PATH, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))
