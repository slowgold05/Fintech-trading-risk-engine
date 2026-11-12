from app.services.index_benchmarks import load_index_benchmarks
from app.services.sp500_constituents import load_sp500_constituents


def test_returns_exactly_503_rows():
    rows = load_sp500_constituents()
    assert len(rows) == 503


def test_no_duplicate_tickers():
    rows = load_sp500_constituents()
    tickers = [row["ticker"] for row in rows]
    assert len(tickers) == len(set(tickers))


def test_every_row_has_all_four_fields_non_empty():
    rows = load_sp500_constituents()
    for row in rows:
        for key in ("ticker", "security", "gics_sector", "gics_sub_industry"):
            assert row[key], f"empty {key} in row {row}"


def test_spot_check_known_rows_present():
    rows = {row["ticker"]: row for row in load_sp500_constituents()}
    assert rows["AAPL"]["security"] == "Apple Inc."
    assert rows["HONA"]["security"] == "Honeywell Aerospace"
    assert rows["HON"]["security"] == "Honeywell Technologies"
    assert rows["Q"]["security"] == "Qnity Electronics"
    assert rows["P"]["security"] == "Everpure"
    assert rows["GOOGL"]["security"] == "Alphabet Inc. (Class A)"
    assert rows["GOOG"]["security"] == "Alphabet Inc. (Class C)"


def test_index_benchmarks_has_exactly_four_named_rows():
    rows = load_index_benchmarks()
    names = {row["name"] for row in rows}
    assert len(rows) == 4
    assert names == {
        "S&P 500",
        "Nasdaq Composite",
        "Dow Jones Industrial Average",
        "Russell 2000",
    }
