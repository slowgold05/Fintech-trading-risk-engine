"""Tests for app.services.exchange_calendar.

Every reference date below was checked against a primary NYSE announcement or
contemporaneous news report (see app/services/exchange_calendar.py docstring and
docs/P1C_EXCHANGE_CALENDAR_VERIFICATION.md for sources), not derived from this module's
own Easter/shift logic. That keeps the test an independent check rather than a restatement
of the implementation.
"""

from datetime import date

import pytest

from app.services.exchange_calendar import (
    expected_session_count,
    expected_session_dates,
    is_nyse_trading_day,
)


def test_weekends_are_never_trading_days() -> None:
    assert is_nyse_trading_day(date(2026, 11, 6)) is True  # Friday, sanity control
    assert is_nyse_trading_day(date(2026, 11, 7)) is False  # Saturday
    assert is_nyse_trading_day(date(2026, 11, 8)) is False  # Sunday


def test_good_friday_matches_confirmed_nyse_closures() -> None:
    # NYSE Group holiday calendar press releases: Good Friday 2021-04-02, 2022-04-15, 2023-04-07.
    assert is_nyse_trading_day(date(2021, 4, 2)) is False
    assert is_nyse_trading_day(date(2022, 4, 15)) is False
    assert is_nyse_trading_day(date(2023, 4, 7)) is False
    # The Thursday before each Good Friday is a normal trading day.
    assert is_nyse_trading_day(date(2021, 4, 1)) is True
    assert is_nyse_trading_day(date(2022, 4, 14)) is True
    assert is_nyse_trading_day(date(2023, 4, 6)) is True


def test_independence_day_saturday_shift_confirmed() -> None:
    # July 4, 2009 and July 4, 2026 both fell on a Saturday; NYSE closed the preceding Friday.
    assert is_nyse_trading_day(date(2009, 7, 3)) is False
    assert is_nyse_trading_day(date(2009, 7, 4)) is False  # Saturday anyway
    assert is_nyse_trading_day(date(2026, 7, 3)) is False
    assert is_nyse_trading_day(date(2026, 7, 2)) is True


def test_independence_day_sunday_shift_confirmed() -> None:
    # July 4, 2021 fell on a Sunday; NYSE closed the following Monday, July 5, 2021.
    assert is_nyse_trading_day(date(2021, 7, 5)) is False
    assert is_nyse_trading_day(date(2021, 7, 2)) is True  # the Friday before stayed open


def test_juneteenth_observed_only_from_2022() -> None:
    # 2021: Juneteenth was not yet an NYSE holiday. June 18, 2021 (Friday) traded normally.
    assert is_nyse_trading_day(date(2021, 6, 18)) is True
    # 2022: June 19 fell on a Sunday; NYSE closed the observed Monday, June 20, 2022.
    assert is_nyse_trading_day(date(2022, 6, 20)) is False


def test_mlk_day_full_closure_only_from_1998() -> None:
    # 1997-01-20 (3rd Monday of January 1997) was a normal trading day, before NYSE observed it.
    assert is_nyse_trading_day(date(1997, 1, 20)) is True
    # 1998-01-19 (3rd Monday of January 1998) was NYSE's first full MLK Day closure.
    assert is_nyse_trading_day(date(1998, 1, 19)) is False


def test_new_years_rule_7_2_confirmed_waivers() -> None:
    # January 1, 2011 and January 1, 2022 both fell on a Saturday. NYSE kept the preceding
    # Friday (Dec 31, 2010 and Dec 31, 2021) open rather than observing New Year's Day early.
    assert is_nyse_trading_day(date(2010, 12, 31)) is True
    assert is_nyse_trading_day(date(2021, 12, 31)) is True
    # The following Monday (not a federal/NYSE holiday either) traded normally in both cases.
    assert is_nyse_trading_day(date(2011, 1, 3)) is True
    assert is_nyse_trading_day(date(2022, 1, 3)) is True


def test_expected_session_count_hand_counted_month() -> None:
    # January 2023: 31 days. Jan 1 (Sun), Jan 2 (Mon, observed New Year's), Jan 16 (MLK Day,
    # 3rd Monday) are non-trading; every other weekday trades. Hand count: 22 weekdays total
    # in Jan 2023 minus 2 holidays (Jan 2 observed, Jan 16 MLK) = 20.
    count = expected_session_count(date(2023, 1, 1), date(2023, 1, 31))
    assert count == 20


def test_expected_session_dates_ascending_and_bounded() -> None:
    days = expected_session_dates(date(2026, 11, 2), date(2026, 11, 7))
    # Nov 2-7, 2026 is Mon-Sat with no holiday; expect Mon-Fri (5 days), Saturday excluded.
    assert days == [
        date(2026, 11, 2),
        date(2026, 11, 3),
        date(2026, 11, 4),
        date(2026, 11, 5),
        date(2026, 11, 6),
    ]


def test_start_after_end_raises() -> None:
    with pytest.raises(ValueError):
        expected_session_dates(date(2026, 1, 2), date(2026, 1, 1))


def test_date_outside_supported_range_raises() -> None:
    with pytest.raises(ValueError):
        is_nyse_trading_day(date(1989, 12, 31))
    with pytest.raises(ValueError):
        is_nyse_trading_day(date(2036, 1, 1))
    with pytest.raises(ValueError):
        expected_session_dates(date(1989, 1, 1), date(1989, 12, 31))
