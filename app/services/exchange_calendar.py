"""NYSE trading-day calendar: the standard annual full-closure schedule only.

This models the fixed, publicly documented annual NYSE holiday schedule (New Year's Day,
Martin Luther King Jr. Day, Washington's Birthday, Good Friday, Memorial Day, Juneteenth,
Independence Day, Labor Day, Thanksgiving, and Christmas) plus weekends. It does NOT model
irregular ad hoc closures -- September 11, 2001, weather, system outages, or any other
one-off closure decided outside this fixed annual schedule. A `coverage_status` computed
from this calendar is a comparison against the standard annual schedule only, never a claim
that every historical trading day is captured.

Historical corrections baked into the rules below, each checked against a primary or
contemporaneous news source rather than derived from this module's own logic:

- Juneteenth became an NYSE closure only from 2022 onward. 2021-06-18 (the Friday before
  June 19, 2021, a Saturday) was a normal trading day; the NYSE did not observe Juneteenth
  that year. 2022-06-20 (observed Monday, since June 19, 2022 fell on a Sunday) was closed.
- Martin Luther King Jr. Day became a full NYSE closure only starting in 1998
  (closed 1998-01-19; 1997-01-20, the same weekday-of-month a year earlier, was a normal
  trading day).
- NYSE Rule 7.2 has, on at least two confirmed occasions, kept December 31 open instead of
  observing New Year's Day early when January 1 fell on a Saturday: 2010-12-31 and
  2021-12-31 both stayed open (citing "unusual business conditions" / quarter-end
  accounting) even though January 1 of the following year (2011, 2022) was a Saturday.
  This is a discretionary Board decision, not a general rule, and it is modeled here only
  for those two specific confirmed instances. Any other year where January 1 falls on a
  Saturday uses the standard observed-Friday-closed shift as a documented default, which is
  NOT independently confirmed for every such year in the supported range.

Supported range: 1990-01-01 through 2035-12-31 inclusive. A date outside that range raises
ValueError rather than guessing.
"""

from datetime import date, timedelta

_MIN_YEAR = 1990
_MAX_YEAR = 2035

# Confirmed NYSE Rule 7.2 discretionary exceptions, keyed by the year whose January 1 is the
# Saturday that was NOT observed early. See module docstring.
_NEW_YEARS_OBSERVANCE_WAIVED_YEARS = frozenset({2011, 2022})

_ONE_DAY = timedelta(days=1)

_holiday_cache: dict[int, frozenset[date]] = {}


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The nth (1-indexed) occurrence of `weekday` (Monday=0) in year/month."""
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + 7 * (n - 1))


def _last_weekday(year: int, month: int, weekday: int) -> date:
    """The last occurrence of `weekday` (Monday=0) in year/month."""
    next_month = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
    last_day = next_month - _ONE_DAY
    offset = (last_day.weekday() - weekday) % 7
    return last_day - timedelta(days=offset)


def _easter_sunday(year: int) -> date:
    """Easter Sunday via the anonymous Gregorian (Gauss) algorithm. Integer arithmetic only."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def _observed(day: date) -> date:
    """Weekend-observed shift: Saturday -> preceding Friday, Sunday -> following Monday."""
    if day.weekday() == 5:
        return day - _ONE_DAY
    if day.weekday() == 6:
        return day + _ONE_DAY
    return day


def _nyse_holidays(year: int) -> frozenset[date]:
    """NYSE full-closure dates that fall within `year`. See module docstring for the
    Dec-31/New Year's cross-year handling and the confirmed historical exceptions."""
    holidays: set[date] = set()

    new_years = date(year, 1, 1)
    if new_years.weekday() == 6:  # Sunday -> observed Monday, still in `year`
        holidays.add(new_years + _ONE_DAY)
    elif new_years.weekday() == 5:  # Saturday -> observed Friday is Dec 31 of year-1, not `year`
        pass
    else:
        holidays.add(new_years)

    # Look ahead one year: if next January 1 is a Saturday, the observed Friday is Dec 31 of
    # THIS year, unless that specific transition is a confirmed Rule 7.2 waiver.
    next_new_years = date(year + 1, 1, 1)
    if next_new_years.weekday() == 5 and (year + 1) not in _NEW_YEARS_OBSERVANCE_WAIVED_YEARS:
        holidays.add(date(year, 12, 31))

    if year >= 1998:
        holidays.add(_nth_weekday(year, 1, 0, 3))  # MLK Day: 3rd Monday of January

    holidays.add(_nth_weekday(year, 2, 0, 3))  # Washington's Birthday: 3rd Monday of February
    holidays.add(_easter_sunday(year) - timedelta(days=2))  # Good Friday
    holidays.add(_last_weekday(year, 5, 0))  # Memorial Day: last Monday of May

    if year >= 2022:
        holidays.add(_observed(date(year, 6, 19)))  # Juneteenth, from 2022 onward

    holidays.add(_observed(date(year, 7, 4)))  # Independence Day
    holidays.add(_nth_weekday(year, 9, 0, 1))  # Labor Day: 1st Monday of September
    holidays.add(_nth_weekday(year, 11, 3, 4))  # Thanksgiving: 4th Thursday of November
    holidays.add(_observed(date(year, 12, 25)))  # Christmas

    return frozenset(holidays)


def _holidays_for_year(year: int) -> frozenset[date]:
    cached = _holiday_cache.get(year)
    if cached is None:
        cached = _nyse_holidays(year)
        _holiday_cache[year] = cached
    return cached


def _check_supported(day: date) -> None:
    if day.year < _MIN_YEAR or day.year > _MAX_YEAR:
        raise ValueError(
            f"{day.isoformat()} is outside the supported NYSE calendar range "
            f"({_MIN_YEAR}-01-01 through {_MAX_YEAR}-12-31)."
        )


def is_nyse_trading_day(day: date) -> bool:
    """True if `day` is a standard-schedule NYSE trading day. Raises ValueError if `day` is
    outside the supported 1990-2035 range. Does not know about ad hoc closures."""
    _check_supported(day)
    if day.weekday() >= 5:
        return False
    return day not in _holidays_for_year(day.year)


def expected_session_dates(start: date, end: date) -> list[date]:
    """Every standard-schedule NYSE trading day from `start` to `end`, inclusive, ascending.
    Raises ValueError if `start > end` or either date is outside the supported range."""
    if start > end:
        raise ValueError("start must not be after end.")
    _check_supported(start)
    _check_supported(end)
    days: list[date] = []
    current = start
    while current <= end:
        if is_nyse_trading_day(current):
            days.append(current)
        current += _ONE_DAY
    return days


def expected_session_count(start: date, end: date) -> int:
    """Count of standard-schedule NYSE trading days from `start` to `end`, inclusive."""
    return len(expected_session_dates(start, end))
