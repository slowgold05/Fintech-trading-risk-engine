"""SEC companyfacts profit margin. Fixtures only; no live SEC calls.

The old parser divided the latest revenue fact by the latest net-income fact.
Those rows often come from different durations or forms, so the ratio was not a
margin. These fixtures keep that failure mode from coming back.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.models.market_fundamentals_cache import MarketFundamentalsCache
from app.services.sec_service import (
    _parse_company_facts,
    get_sec_company_fundamentals,
    latest_dei_shares_outstanding,
)


def _fact(
    *,
    start: str,
    end: str,
    val: float,
    form: str,
    fp: str,
    fy: int,
    filed: str,
    accn: str,
    frame: str | None = None,
) -> dict:
    row = {
        "start": start,
        "end": end,
        "val": val,
        "accn": accn,
        "fy": fy,
        "fp": fp,
        "form": form,
        "filed": filed,
    }
    if frame:
        row["frame"] = frame
    return row


def _company_facts(concepts: dict[str, dict]) -> dict:
    return {
        "cik": 320193,
        "entityName": "Example Corp",
        "facts": {"us-gaap": concepts},
    }


def _usd(name: str, rows: list[dict], extra_units: dict | None = None) -> dict:
    units = {"USD": rows}
    if extra_units:
        units = {**extra_units, **units}
    return {
        "label": name,
        "description": f"{name} as reported on the filing.",
        "units": units,
    }


def _parsed(concepts: dict[str, dict]) -> dict:
    return _parse_company_facts(_company_facts(concepts), "EXMP", "0000320193")


def test_margin_uses_the_shared_annual_period_not_a_later_unmatched_quarter():
    parsed = _parsed({
        "RevenueFromContractWithCustomerExcludingAssessedTax": _usd(
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            [
                _fact(start="2024-01-01", end="2024-12-31", val=1_000_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
                _fact(start="2025-01-01", end="2025-03-31", val=220_000_000, form="10-Q", fp="Q1", fy=2025, filed="2025-05-02", accn="0000320193-25-000040", frame="CY2025Q1"),
            ],
            extra_units={
                "EUR": [_fact(start="2025-01-01", end="2025-09-30", val=9_999, form="10-Q", fp="Q3", fy=2025, filed="2025-11-01", accn="0000320193-25-000090")],
            },
        ),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-01-01", end="2024-12-31", val=250_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
        "Assets": _usd("Assets", [
            {"end": "2024-12-31", "val": 3_000_000_000, "accn": "0000320193-25-000010", "fy": 2024, "fp": "FY", "form": "10-K", "filed": "2025-02-14", "frame": "CY2024Q4I"},
        ]),
        "EarningsPerShareDiluted": {
            "label": "EarningsPerShareDiluted",
            "description": "Diluted EPS.",
            "units": {"USD/shares": [
                {"start": "2024-01-01", "end": "2024-12-31", "val": 1.25, "accn": "0000320193-25-000010", "fy": 2024, "fp": "FY", "form": "10-K", "filed": "2025-02-14", "frame": "CY2024"},
            ]},
        },
    })

    assert parsed["revenue"] == 1_000_000_000
    assert parsed["net_income"] == 250_000_000
    assert parsed["profit_margin"] == 0.25
    assert parsed["profit_margin_period"] == {
        "form": "10-K",
        "start": "2024-01-01",
        "end": "2024-12-31",
        "fp": "FY",
        "fy": 2024,
    }
    assert parsed["assets"] == 3_000_000_000
    assert parsed["eps"] == 1.25
    assert parsed["name"] == "Example Corp"


def test_same_10q_does_not_divide_quarterly_income_by_year_to_date_revenue():
    # Listed so the old end/filed tie would take YTD revenue and quarterly income.
    parsed = _parsed({
        "RevenueFromContractWithCustomerExcludingAssessedTax": _usd(
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            [
                _fact(start="2024-01-01", end="2024-09-30", val=900_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080"),
                _fact(start="2024-07-01", end="2024-09-30", val=400_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080", frame="CY2024Q3"),
            ],
        ),
        "Revenues": _usd("Revenues", [
            _fact(start="2023-01-01", end="2023-12-31", val=2_000_000_000, form="10-K", fp="FY", fy=2023, filed="2024-02-15", accn="0000320193-24-000010", frame="CY2023"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-07-01", end="2024-09-30", val=100_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080", frame="CY2024Q3"),
            _fact(start="2024-01-01", end="2024-09-30", val=90_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080"),
            _fact(start="2023-01-01", end="2023-12-31", val=200_000_000, form="10-K", fp="FY", fy=2023, filed="2024-02-15", accn="0000320193-24-000010", frame="CY2023"),
        ]),
    })

    assert parsed["profit_margin"] == 0.25
    assert parsed["revenue"] == 400_000_000
    assert parsed["net_income"] == 100_000_000
    assert parsed["profit_margin_period"] == {
        "form": "10-Q",
        "start": "2024-07-01",
        "end": "2024-09-30",
        "fp": "Q3",
        "fy": 2024,
    }


def test_full_year_beats_a_fourth_quarter_that_ends_the_same_day():
    parsed = _parsed({
        "Revenues": _usd("Revenues", [
            _fact(start="2024-10-01", end="2024-12-31", val=100_000_000, form="10-K", fp="Q4", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024Q4"),
            _fact(start="2024-01-01", end="2024-12-31", val=800_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-10-01", end="2024-12-31", val=10_000_000, form="10-K", fp="Q4", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024Q4"),
            _fact(start="2024-01-01", end="2024-12-31", val=200_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
    })

    assert parsed["profit_margin"] == 0.25
    assert parsed["profit_margin_period"]["start"] == "2024-01-01"
    assert parsed["profit_margin_period"]["fp"] == "FY"


def test_mismatched_period_or_form_leaves_the_margin_null():
    parsed = _parsed({
        "RevenueFromContractWithCustomerExcludingAssessedTax": _usd(
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            [
                _fact(start="2024-07-01", end="2024-09-30", val=400_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080", frame="CY2024Q3"),
            ],
        ),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-01-01", end="2024-09-30", val=90_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080"),
            _fact(start="2024-01-01", end="2024-12-31", val=100_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
    })

    assert parsed["revenue"] == 400_000_000
    assert parsed["net_income"] == 100_000_000
    assert parsed["net_income"] / parsed["revenue"] == 0.25
    assert parsed["profit_margin"] is None
    assert parsed["profit_margin_period"] is None


def test_same_dates_on_different_forms_do_not_match():
    parsed = _parsed({
        "SalesRevenueNet": _usd("SalesRevenueNet", [
            _fact(start="2024-01-01", end="2024-03-31", val=100_000_000, form="10-Q", fp="Q1", fy=2024, filed="2024-05-02", accn="0000320193-24-000040", frame="CY2024Q1"),
        ]),
        "ProfitLoss": _usd("ProfitLoss", [
            _fact(start="2024-01-01", end="2024-03-31", val=40_000_000, form="10-K", fp="Q1", fy=2024, filed="2024-05-02", accn="0000320193-24-000041", frame="CY2024Q1"),
        ]),
    })

    assert parsed["profit_margin"] is None
    assert parsed["profit_margin_period"] is None


def test_later_revenue_tag_matches_when_the_preferred_tag_is_a_different_year():
    parsed = _parsed({
        "RevenueFromContractWithCustomerExcludingAssessedTax": _usd(
            "RevenueFromContractWithCustomerExcludingAssessedTax",
            [
                _fact(start="2022-01-01", end="2022-12-31", val=500_000_000, form="10-K", fp="FY", fy=2022, filed="2023-02-16", accn="0000320193-23-000010", frame="CY2022"),
            ],
        ),
        "Revenues": _usd("Revenues", [
            _fact(start="2024-01-01", end="2024-12-31", val=800_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2025-01-01", end="2025-03-31", val=50_000_000, form="10-Q", fp="Q1", fy=2025, filed="2025-05-02", accn="0000320193-25-000040", frame="CY2025Q1"),
            _fact(start="2024-01-01", end="2024-12-31", val=200_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
    })

    assert parsed["profit_margin"] == 0.25
    assert parsed["revenue"] == 800_000_000
    assert parsed["net_income"] == 200_000_000
    assert parsed["profit_margin_period"]["form"] == "10-K"
    assert parsed["profit_margin_period"]["end"] == "2024-12-31"


def test_later_filing_of_the_same_period_replaces_the_original_values():
    parsed = _parsed({
        "Revenues": _usd("Revenues", [
            _fact(start="2024-01-01", end="2024-12-31", val=1_000_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
            _fact(start="2024-01-01", end="2024-12-31", val=1_100_000_000, form="10-K", fp="FY", fy=2024, filed="2025-11-01", accn="0000320193-25-000099", frame="CY2024"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-01-01", end="2024-12-31", val=100_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
            _fact(start="2024-01-01", end="2024-12-31", val=275_000_000, form="10-K", fp="FY", fy=2024, filed="2025-11-01", accn="0000320193-25-000099", frame="CY2024"),
        ]),
    })

    assert parsed["revenue"] == 1_100_000_000
    assert parsed["net_income"] == 275_000_000
    assert parsed["profit_margin"] == 0.25


def test_zero_revenue_does_not_invent_a_margin():
    parsed = _parsed({
        "Revenues": _usd("Revenues", [
            _fact(start="2024-01-01", end="2024-12-31", val=0, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-01-01", end="2024-12-31", val=10_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
        ]),
    })

    assert parsed["profit_margin"] is None
    assert parsed["profit_margin_period"] is None
    assert parsed["revenue"] == 0
    assert parsed["net_income"] == 10_000_000


def test_zero_net_income_is_a_real_margin():
    parsed = _parsed({
        "Revenues": _usd("Revenues", [
            _fact(start="2024-07-01", end="2024-09-30", val=400_000_000, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080", frame="CY2024Q3"),
        ]),
        "NetIncomeLoss": _usd("NetIncomeLoss", [
            _fact(start="2024-07-01", end="2024-09-30", val=0, form="10-Q", fp="Q3", fy=2024, filed="2024-11-01", accn="0000320193-24-000080", frame="CY2024Q3"),
        ]),
    })

    assert parsed["profit_margin"] == 0.0
    assert parsed["profit_margin_period"]["form"] == "10-Q"


def test_cached_margin_without_a_period_is_parsed_again(db_session, monkeypatch):
    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    db_session.add(MarketFundamentalsCache(
        symbol="EXMP",
        cik="0000320193",
        payload={
            "symbol": "EXMP",
            "revenue": 400_000_000,
            "net_income": 100_000_000,
            "profit_margin": 0.25,
        },
        fetched_at=fetched_at,
    ))
    db_session.commit()
    monkeypatch.setattr(
        "app.services.sec_service._get_ticker_map",
        lambda: {"EXMP": {"cik_str": 320193, "ticker": "EXMP", "title": "Example Corp"}},
    )

    def fake_get(url, headers=None, timeout=None):
        assert "companyfacts" in url
        payload = _company_facts({
            "Revenues": _usd("Revenues", [
                _fact(start="2024-01-01", end="2024-12-31", val=800_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
            ]),
            "NetIncomeLoss": _usd("NetIncomeLoss", [
                _fact(start="2024-01-01", end="2024-12-31", val=200_000_000, form="10-K", fp="FY", fy=2024, filed="2025-02-14", accn="0000320193-25-000010", frame="CY2024"),
            ]),
        })
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: payload)

    monkeypatch.setattr("app.services.sec_service.requests.get", fake_get)
    parsed = get_sec_company_fundamentals("EXMP", db_session)

    assert parsed["profit_margin"] == 0.25
    assert parsed["revenue"] == 800_000_000
    assert parsed["profit_margin_period"]["form"] == "10-K"
    assert parsed["profit_margin_period"]["end"] == "2024-12-31"


def test_fresh_cache_with_a_period_key_skips_sec(db_session, monkeypatch):
    payload = {
        "symbol": "EXMP",
        "profit_margin": None,
        "profit_margin_period": None,
        "ttm_diluted_eps": None,
        "shares_outstanding": None,
    }
    db_session.add(MarketFundamentalsCache(
        symbol="EXMP",
        cik="0000320193",
        payload=payload,
        fetched_at=datetime.now(timezone.utc).replace(tzinfo=None),
    ))
    db_session.commit()

    def boom(*_args, **_kwargs):
        raise AssertionError("provider called")

    monkeypatch.setattr("app.services.sec_service.requests.get", boom)
    assert get_sec_company_fundamentals("exmp", db_session) == payload


def _diluted(rows: list[dict]) -> dict:
    return {
        "EarningsPerShareDiluted": {
            "label": "EarningsPerShareDiluted",
            "description": "Diluted EPS.",
            "units": {"USD/shares": rows},
        }
    }


def _eps(start: str, end: str, val: float, fp: str, fy: int, filed: str, form: str = "10-Q") -> dict:
    return _fact(start=start, end=end, val=val, form=form, fp=fp, fy=fy, filed=filed, accn=f"0000320193-{fy}-{fp}-{filed}")


def _four_quarters(**overrides) -> list[dict]:
    rows = [
        _eps("2024-01-01", "2024-03-31", 1.0, "Q1", 2024, "2024-05-02"),
        _eps("2024-04-01", "2024-06-30", 1.1, "Q2", 2024, "2024-08-02"),
        _eps("2024-07-01", "2024-09-30", 1.2, "Q3", 2024, "2024-11-01"),
        _eps("2024-10-01", "2024-12-31", 1.3, "Q4", 2024, "2025-02-14", form="10-K"),
    ]
    for index, replacement in overrides.items():
        rows[index] = replacement
    return rows


def test_trailing_eps_sums_four_standard_quarters_and_skips_longer_rows():
    rows = _four_quarters() + [
        _eps("2024-01-01", "2024-06-30", 9.9, "Q2", 2024, "2024-08-02"),
        _eps("2024-01-01", "2024-12-31", 50, "FY", 2024, "2025-02-14", form="10-K"),
    ]
    parsed = _parsed(_diluted(rows))

    assert parsed["ttm_diluted_eps"] == pytest.approx(4.6)
    assert [item["fp"] for item in parsed["ttm_diluted_eps_periods"]] == ["Q1", "Q2", "Q3", "Q4"]


def test_trailing_eps_needs_four_quarters():
    parsed = _parsed(_diluted(_four_quarters()[:3]))
    assert parsed["ttm_diluted_eps"] is None
    assert parsed["ttm_diluted_eps_periods"] is None


def test_trailing_eps_derives_the_fourth_quarter_from_the_annual_filing():
    """Real filings have three 10-Q quarters and an FY 10-K, not a Q4 row."""
    rows = [
        _eps("2024-01-01", "2024-03-31", 1.0, "Q1", 2024, "2024-05-02"),
        _eps("2024-04-01", "2024-06-30", 1.1, "Q2", 2024, "2024-08-02"),
        _eps("2024-01-01", "2024-06-30", 9.9, "Q2", 2024, "2024-08-02"),
        _eps("2024-07-01", "2024-09-30", 1.2, "Q3", 2024, "2024-11-01"),
        _eps("2024-01-01", "2024-09-30", 9.9, "Q3", 2024, "2024-11-01"),
        _eps("2024-01-01", "2024-12-31", 4.6, "FY", 2024, "2025-02-14", form="10-K"),
    ]
    parsed = _parsed(_diluted(rows))

    assert parsed["ttm_diluted_eps"] == pytest.approx(4.6)
    periods = parsed["ttm_diluted_eps_periods"]
    assert [item["fp"] for item in periods] == ["Q1", "Q2", "Q3", "Q4"]
    assert [item["form"] for item in periods] == ["10-Q", "10-Q", "10-Q", "10-K"]
    assert periods[3]["start"] == "2024-10-01"
    assert periods[3]["end"] == "2024-12-31"


def test_trailing_eps_rolls_forward_from_the_derived_fourth_quarter():
    rows = [
        _eps("2024-01-01", "2024-03-31", 1.0, "Q1", 2024, "2024-05-02"),
        _eps("2024-04-01", "2024-06-30", 1.1, "Q2", 2024, "2024-08-02"),
        _eps("2024-07-01", "2024-09-30", 1.2, "Q3", 2024, "2024-11-01"),
        _eps("2024-01-01", "2024-12-31", 4.6, "FY", 2024, "2025-02-14", form="10-K"),
        _eps("2025-01-01", "2025-03-31", 1.4, "Q1", 2025, "2025-05-02"),
        _eps("2025-04-01", "2025-06-30", 1.5, "Q2", 2025, "2025-08-01"),
        _eps("2025-07-01", "2025-09-30", 1.6, "Q3", 2025, "2025-11-01"),
    ]
    parsed = _parsed(_diluted(rows))

    assert parsed["ttm_diluted_eps"] == pytest.approx(5.8)
    periods = parsed["ttm_diluted_eps_periods"]
    assert [item["fp"] for item in periods] == ["Q4", "Q1", "Q2", "Q3"]
    assert periods[0]["start"] == "2024-10-01"
    assert periods[0]["end"] == "2024-12-31"
    assert periods[-1]["end"] == "2025-09-30"


def test_derived_non_positive_trailing_eps_is_still_returned():
    rows = [
        _eps("2024-01-01", "2024-03-31", 1.0, "Q1", 2024, "2024-05-02"),
        _eps("2024-04-01", "2024-06-30", 1.0, "Q2", 2024, "2024-08-02"),
        _eps("2024-07-01", "2024-09-30", 1.0, "Q3", 2024, "2024-11-01"),
        _eps("2024-01-01", "2024-12-31", 0, "FY", 2024, "2025-02-14", form="10-K"),
    ]
    assert _parsed(_diluted(rows))["ttm_diluted_eps"] == 0


def test_trailing_eps_rejects_a_gap_that_is_not_one_continuous_year():
    rows = _four_quarters()
    rows[2] = _eps("2024-07-22", "2024-10-20", 1.2, "Q3", 2024, "2024-11-01")
    rows[3] = _eps("2024-10-21", "2025-01-19", 1.3, "Q4", 2024, "2025-02-14", form="10-K")
    assert _parsed(_diluted(rows))["ttm_diluted_eps"] is None


def test_trailing_eps_rejects_four_quarters_that_do_not_span_a_year():
    rows = [
        _eps("2024-01-01", "2024-03-11", 1, "Q1", 2024, "2024-04-01"),
        _eps("2024-03-11", "2024-05-20", 1, "Q2", 2024, "2024-06-01"),
        _eps("2024-05-20", "2024-07-29", 1, "Q3", 2024, "2024-08-01"),
        _eps("2024-07-29", "2024-10-07", 1, "Q4", 2024, "2024-11-01"),
    ]
    assert _parsed(_diluted(rows))["ttm_diluted_eps"] is None


def test_later_filing_replaces_a_quarter_inside_the_trailing_sum():
    rows = _four_quarters()
    rows.append(_eps("2024-10-01", "2024-12-31", 1.5, "Q4", 2024, "2025-03-01", form="10-K"))
    assert _parsed(_diluted(rows))["ttm_diluted_eps"] == pytest.approx(4.8)


def test_dei_shares_uses_the_latest_positive_cover_fact():
    facts = {
        "dei": {
            "EntityCommonStockSharesOutstanding": {"units": {"shares": [
                {"end": "2024-09-30", "val": 100, "filed": "2024-11-01"},
                {"end": "2024-12-31", "val": 0, "filed": "2025-02-01"},
            ]}},
            "CommonStockSharesOutstanding": {"units": {"shares": [
                {"end": "2024-12-31", "val": 80, "filed": "2025-02-01"},
                {"end": "2024-12-31", "val": 90, "filed": "2025-03-01"},
            ]}},
        }
    }
    assert latest_dei_shares_outstanding(facts) == 90
    parsed = _parse_company_facts({"entityName": "Example Corp", "facts": facts}, "EXMP", "0000320193")
    assert parsed["shares_outstanding"] == 90


def test_cached_period_without_trailing_fields_is_parsed_again(db_session, monkeypatch):
    fetched_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=5)
    db_session.add(MarketFundamentalsCache(
        symbol="EXMP",
        cik="0000320193",
        payload={
            "symbol": "EXMP",
            "profit_margin": 0.25,
            "profit_margin_period": {"form": "10-K", "start": "2024-01-01", "end": "2024-12-31", "fp": "FY", "fy": 2024},
        },
        fetched_at=fetched_at,
    ))
    db_session.commit()
    monkeypatch.setattr(
        "app.services.sec_service._get_ticker_map",
        lambda: {"EXMP": {"cik_str": 320193, "ticker": "EXMP", "title": "Example Corp"}},
    )

    def fake_get(url, headers=None, timeout=None):
        assert "companyfacts" in url
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: _company_facts({}))

    monkeypatch.setattr("app.services.sec_service.requests.get", fake_get)
    parsed = get_sec_company_fundamentals("EXMP", db_session)

    assert parsed["ttm_diluted_eps"] is None
    assert parsed["shares_outstanding"] is None
