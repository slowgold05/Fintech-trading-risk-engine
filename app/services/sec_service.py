import math
import time
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.market_filings_cache import MarketFilingsCache
from app.models.market_fundamentals_cache import MarketFundamentalsCache
from app.models.market_symbol import MarketSymbol

SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_COMPANY_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
_DEFAULT_FILING_FORMS = ["10-K", "10-Q", "8-K"]
_REVENUE_CONCEPTS = [
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "Revenues",
    "SalesRevenueNet",
]
_NET_INCOME_CONCEPTS = ["NetIncomeLoss", "ProfitLoss"]
_QUARTER_PERIODS = {"Q1", "Q2", "Q3", "Q4"}
_ticker_cache: tuple[dict[str, dict], float] | None = None


def _headers() -> dict[str, str]:
    return {
        "User-Agent": settings.sec_user_agent,
        "Accept-Encoding": "gzip, deflate",
    }


def _get_ticker_map() -> dict[str, dict]:
    global _ticker_cache
    if _ticker_cache and _ticker_cache[1] > time.time():
        return _ticker_cache[0]

    response = requests.get(SEC_TICKERS_URL, headers=_headers(), timeout=30)
    response.raise_for_status()
    ticker_map = {
        item["ticker"].upper(): item
        for item in response.json().values()
    }
    _ticker_cache = (ticker_map, time.time() + 86400)
    return ticker_map


def _latest_fact(facts: dict, concepts: list[str], unit: str = "USD") -> float | None:
    for concept in concepts:
        units = facts.get("us-gaap", {}).get(concept, {}).get("units", {})
        candidates = units.get(unit) or next(iter(units.values()), [])
        valid = [item for item in candidates if item.get("val") is not None and item.get("end")]
        if valid:
            latest = max(valid, key=lambda item: (item.get("end", ""), item.get("filed", "")))
            return float(latest["val"])
    return None


def _finite_number(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float, str)):
        return None
    try:
        number = float(value)
    except ValueError:
        return None
    if not math.isfinite(number):
        return None
    return number


def _period_days(start: str, end: str) -> int | None:
    try:
        return (datetime.fromisoformat(end) - datetime.fromisoformat(start)).days
    except ValueError:
        return None


def _duration_facts(facts: dict, concepts: list[str]) -> list[dict]:
    collected = []
    gaap = facts.get("us-gaap", {})
    for rank, concept in enumerate(concepts):
        candidates = gaap.get(concept, {}).get("units", {}).get("USD") or []
        if not isinstance(candidates, list):
            continue
        for index, item in enumerate(candidates):
            if not isinstance(item, dict):
                continue
            start = item.get("start")
            end = item.get("end")
            form = item.get("form")
            number = _finite_number(item.get("val"))
            if not isinstance(start, str) or not isinstance(end, str) or not isinstance(form, str):
                continue
            start = start.strip()
            end = end.strip()
            form = form.strip()
            if not start or not end or not form or number is None:
                continue
            fp = item.get("fp")
            fy = item.get("fy")
            collected.append({
                "concept_rank": rank,
                "index": index,
                "start": start,
                "end": end,
                "form": form,
                "filed": item.get("filed") if isinstance(item.get("filed"), str) else "",
                "fp": fp if isinstance(fp, str) and fp else None,
                "fy": fy if isinstance(fy, int) and not isinstance(fy, bool) else None,
                "val": number,
            })
    return collected


def _best_by_period(items: list[dict]) -> dict[tuple[str, str, str], dict]:
    chosen: dict[tuple[str, str, str], dict] = {}
    for item in items:
        key = (item["form"], item["start"], item["end"])
        rank = (item["filed"], -item["concept_rank"], item["index"])
        current = chosen.get(key)
        if current is None or rank > current["_rank"]:
            chosen[key] = {**item, "_rank": rank}
    return chosen


def _is_standard_quarter(item: dict) -> bool:
    days = _period_days(item["start"], item["end"])
    return item["fp"] in _QUARTER_PERIODS and days is not None and 70 <= days <= 120


def _is_standard_year(item: dict) -> bool:
    days = _period_days(item["start"], item["end"])
    return item["fp"] == "FY" and days is not None and 300 <= days <= 380


def _pair_rank(revenue: dict, net_income: dict) -> tuple:
    days = _period_days(revenue["start"], revenue["end"])
    standard_quarter = _is_standard_quarter(revenue) and _is_standard_quarter(net_income)
    standard_year = _is_standard_year(revenue) and _is_standard_year(net_income)
    return (
        revenue["end"],
        1 if standard_quarter or standard_year else 0,
        1 if standard_year else 0,
        -(days if days is not None else 10**9),
        max(revenue["filed"], net_income["filed"]),
    )


_EPS_UNIT = "USD/shares"
_SHARES_CONCEPTS = (
    "EntityCommonStockSharesOutstanding",
    "CommonStockSharesOutstanding",
)


def _share_duration_facts(facts: dict, concepts: list[str]) -> list[dict]:
    collected = []
    gaap = facts.get("us-gaap", {})
    for rank, concept in enumerate(concepts):
        candidates = gaap.get(concept, {}).get("units", {}).get(_EPS_UNIT) or []
        if not isinstance(candidates, list):
            continue
        for index, item in enumerate(candidates):
            if not isinstance(item, dict):
                continue
            start = item.get("start")
            end = item.get("end")
            form = item.get("form")
            number = _finite_number(item.get("val"))
            if not isinstance(start, str) or not isinstance(end, str) or not isinstance(form, str):
                continue
            start = start.strip()
            end = end.strip()
            form = form.strip()
            if not start or not end or not form or number is None:
                continue
            fp = item.get("fp")
            fy = item.get("fy")
            collected.append({
                "concept_rank": rank,
                "index": index,
                "start": start,
                "end": end,
                "form": form,
                "filed": item.get("filed") if isinstance(item.get("filed"), str) else "",
                "fp": fp if isinstance(fp, str) and fp else None,
                "fy": fy if isinstance(fy, int) and not isinstance(fy, bool) else None,
                "val": number,
            })
    return collected


def _pick_rank(item: dict) -> tuple:
    return (item["filed"], -item["concept_rank"], item["index"])


def _dedupe_by_end(items: list[dict]) -> list[dict]:
    by_end: dict[str, dict] = {}
    for item in items:
        rank = _pick_rank(item)
        current = by_end.get(item["end"])
        if current is None or rank > current["_pick"]:
            by_end[item["end"]] = {**item, "_pick": rank}
    return sorted(by_end.values(), key=lambda item: item["end"])


def _periods_follow(items: list[dict]) -> bool:
    for previous, current in zip(items, items[1:]):
        gap = _period_days(previous["end"], current["start"])
        if gap is None or gap < -5 or gap > 20:
            return False
    return True


def _period_public(item: dict) -> dict:
    return {
        "form": item["form"],
        "start": item["start"],
        "end": item["end"],
        "fp": item["fp"],
        "fy": item["fy"],
    }


def _trailing_result(eps: float, items: list[dict]) -> dict:
    return {"eps": eps, "periods": [_period_public(item) for item in items]}


def _discrete_trailing(quarters: list[dict]) -> dict | None:
    if len(quarters) < 4:
        return None
    window = quarters[-4:]
    span = _period_days(window[0]["start"], window[-1]["end"])
    if span is None or not 300 <= span <= 400 or not _periods_follow(window):
        return None
    return _trailing_result(sum(item["val"] for item in window), window)


def _quarter_set(items: list[dict], fiscal_periods: tuple[str, ...]) -> list[dict] | None:
    chosen: dict[str, dict] = {}
    for item in items:
        fiscal_period = item["fp"]
        if fiscal_period not in fiscal_periods:
            continue
        current = chosen.get(fiscal_period)
        if current is None or item["_pick"] > current["_pick"]:
            chosen[fiscal_period] = item
    if any(fiscal_period not in chosen for fiscal_period in fiscal_periods):
        return None
    ordered = [chosen[fiscal_period] for fiscal_period in fiscal_periods]
    if not _periods_follow(ordered):
        return None
    return ordered


def _belongs_to_year(item: dict, year: dict) -> bool:
    """The quarter's dates fall inside the annual period.

    SEC ``fy`` names the filing that reported the fact, not the fact's own
    year. A 10-Q comparative keeps the prior period's dates and carries the
    later filing's ``fy``, so membership is dates only.
    """
    return item["start"] >= year["start"] and item["end"] <= year["end"]


def _follows_year(item: dict, year: dict) -> bool:
    """The quarter starts after the annual period and still belongs to the next year."""
    if item["start"] <= year["end"]:
        return False
    gap = _period_days(year["end"], item["start"])
    return gap is not None and gap <= 320


def _day_after(value: str) -> str | None:
    try:
        return (datetime.fromisoformat(value) + timedelta(days=1)).date().isoformat()
    except ValueError:
        return None


def _derived_fourth_quarter(three: list[dict], year: dict) -> dict | None:
    start = _day_after(three[-1]["end"])
    if start is None:
        return None
    days = _period_days(start, year["end"])
    opening = _period_days(year["start"], three[0]["start"])
    if days is None or not 70 <= days <= 120 or opening is None or opening < -5 or opening > 20:
        return None
    value = year["val"] - sum(item["val"] for item in three)
    if not math.isfinite(value):
        return None
    return {
        "form": year["form"],
        "start": start,
        "end": year["end"],
        "fp": "Q4",
        "fy": year["fy"],
        "val": value,
        "filed": year["filed"],
        "concept_rank": year["concept_rank"],
        "index": year["index"],
        "_pick": _pick_rank(year),
    }


def _trailing_from_annual(quarters: list[dict], years: list[dict]) -> dict | None:
    """Fourth quarter is the full year minus the three reported quarters.

    When the next fiscal year has also reported Q1 through Q3, the trailing
    sum is that derived quarter plus those three. A roll-forward that is not
    one continuous year keeps the completed year.
    """
    if not years:
        return None
    year = max(years, key=lambda item: (item["end"], item["filed"], item["index"]))
    inside = [item for item in quarters if _belongs_to_year(item, year)]
    three = _quarter_set(inside, ("Q1", "Q2", "Q3"))
    if three is None or three[-1]["end"] >= year["end"]:
        return None
    derived = _derived_fourth_quarter(three, year)
    if derived is None:
        return None
    annual = _trailing_result(year["val"], [*three, derived])
    later = [item for item in quarters if _follows_year(item, year)]
    three_later = _quarter_set(later, ("Q1", "Q2", "Q3"))
    if three_later is None:
        return annual
    bridge = _period_days(year["end"], three_later[0]["start"])
    span = _period_days(derived["start"], three_later[-1]["end"])
    if bridge is None or bridge < -5 or bridge > 20 or span is None or not 300 <= span <= 400:
        return annual
    rolled = derived["val"] + sum(item["val"] for item in three_later)
    if not math.isfinite(rolled):
        return annual
    return _trailing_result(rolled, [derived, *three_later])


def trailing_diluted_eps(facts: dict) -> dict | None:
    """Trailing diluted EPS from the rows SEC company facts actually carry.

    Four discrete quarters are used when they form one continuous year.
    Filings usually have no Q4 row: the 10-K is the full year. The fourth
    quarter is then the year minus Q1 through Q3, and the trailing sum is
    the year. Once the next year has reported Q1 through Q3, the sum rolls
    forward from that derived quarter. None means the window cannot be built.
    """
    chosen = _best_by_period(_share_duration_facts(facts, ["EarningsPerShareDiluted"]))
    quarters = _dedupe_by_end([item for item in chosen.values() if _is_standard_quarter(item)])
    discrete = _discrete_trailing(quarters)
    if discrete is not None:
        return discrete
    years = [item for item in chosen.values() if _is_standard_year(item)]
    return _trailing_from_annual(quarters, years)


def latest_dei_shares_outstanding(facts: dict) -> float | None:
    """Latest positive share count from the SEC dei cover facts."""
    dei = facts.get("dei", {})
    if not isinstance(dei, dict):
        return None
    best: tuple[str, str, float] | None = None
    for concept in _SHARES_CONCEPTS:
        units = dei.get(concept, {}).get("units", {}).get("shares") or []
        if not isinstance(units, list):
            continue
        for item in units:
            if not isinstance(item, dict):
                continue
            end = item.get("end")
            number = _finite_number(item.get("val"))
            if not isinstance(end, str) or number is None or number <= 0:
                continue
            filed = item.get("filed") if isinstance(item.get("filed"), str) else ""
            rank = (end, filed, number)
            if best is None or rank[:2] > best[:2]:
                best = (end, filed, number)
    return None if best is None else best[2]


def _matched_margin(facts: dict) -> dict | None:
    """Return one revenue and net-income fact that share a form and duration.

    SEC companyfacts lists every reported duration in one array. A 10-Q usually
    carries both the quarter and the year-to-date total, and those rows share
    an end date. Dividing across those rows, or across a 10-Q and a 10-K, is
    not a profit margin.
    """
    revenue_facts = _best_by_period(_duration_facts(facts, _REVENUE_CONCEPTS))
    income_facts = _best_by_period(_duration_facts(facts, _NET_INCOME_CONCEPTS))
    pairs = []
    for key, revenue in revenue_facts.items():
        net_income = income_facts.get(key)
        if net_income is None or revenue["val"] == 0:
            continue
        pairs.append((revenue, net_income))
    if not pairs:
        return None
    revenue, net_income = max(pairs, key=lambda pair: _pair_rank(pair[0], pair[1]))
    return {
        "revenue": revenue["val"],
        "net_income": net_income["val"],
        "profit_margin": net_income["val"] / revenue["val"],
        "period": {
            "form": revenue["form"],
            "start": revenue["start"],
            "end": revenue["end"],
            "fp": revenue["fp"] if revenue["fp"] == net_income["fp"] else None,
            "fy": revenue["fy"] if revenue["fy"] == net_income["fy"] else None,
        },
    }


def _parse_company_facts(data: dict, ticker: str, cik: str) -> dict:
    facts = data.get("facts", {})
    matched = _matched_margin(facts)
    if matched is None:
        revenue = _latest_fact(facts, _REVENUE_CONCEPTS)
        net_income = _latest_fact(facts, _NET_INCOME_CONCEPTS)
        profit_margin = None
        profit_margin_period = None
    else:
        revenue = matched["revenue"]
        net_income = matched["net_income"]
        profit_margin = matched["profit_margin"]
        profit_margin_period = matched["period"]
    assets = _latest_fact(facts, ["Assets"])
    liabilities = _latest_fact(facts, ["Liabilities"])
    equity = _latest_fact(facts, ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"])
    eps = _latest_fact(facts, ["EarningsPerShareDiluted", "EarningsPerShareBasic"], "USD/shares")
    trailing = trailing_diluted_eps(facts)

    return {
        "symbol": ticker,
        "cik": cik,
        "name": data.get("entityName"),
        "revenue": revenue,
        "net_income": net_income,
        "profit_margin": profit_margin,
        "profit_margin_period": profit_margin_period,
        "assets": assets,
        "liabilities": liabilities,
        "equity": equity,
        "eps": eps,
        "ttm_diluted_eps": None if trailing is None else trailing["eps"],
        "ttm_diluted_eps_periods": None if trailing is None else trailing["periods"],
        "shares_outstanding": latest_dei_shares_outstanding(facts),
        "source": "SEC EDGAR",
    }


def get_sec_company_fundamentals(symbol: str, db: Session) -> dict:
    symbol = symbol.upper().strip()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    cached = db.get(MarketFundamentalsCache, symbol)
    cached_payload = cached.payload if cached is not None and isinstance(cached.payload, dict) else {}
    if (
        cached
        and cached.fetched_at >= cutoff
        and "profit_margin_period" in cached_payload
        and "ttm_diluted_eps" in cached_payload
        and "shares_outstanding" in cached_payload
    ):
        return cached.payload

    ticker_record = _get_ticker_map().get(symbol)
    if not ticker_record:
        raise ValueError(f"SEC company record not found for {symbol}.")

    cik = str(ticker_record["cik_str"]).zfill(10)
    response = requests.get(
        SEC_COMPANY_FACTS_URL.format(cik=cik),
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    payload = _parse_company_facts(response.json(), symbol, cik)

    if cached is None:
        cached = MarketFundamentalsCache(symbol=symbol, cik=cik, payload=payload)
        db.add(cached)
    else:
        cached.cik = cik
        cached.payload = payload
        cached.fetched_at = datetime.now(timezone.utc).replace(tzinfo=None)

    market_symbol = db.get(MarketSymbol, symbol)
    if market_symbol:
        market_symbol.cik = cik

    db.commit()
    return payload


def _iso_z(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    else:
        value = value.astimezone(timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


def _parse_recent_filings(data: dict) -> list[dict]:
    recent = data.get("filings", {}).get("recent", {})
    return [
        {
            "form": form,
            "filingDate": filing_date,
            "reportDate": report_date,
            "accessionNumber": accession,
            "primaryDocument": primary_document,
        }
        for form, filing_date, report_date, accession, primary_document in zip(
            recent.get("form", []),
            recent.get("filingDate", []),
            recent.get("reportDate", []),
            recent.get("accessionNumber", []),
            recent.get("primaryDocument", []),
            strict=False,
        )
    ]


def _filings_response(
    symbol: str,
    payload: dict,
    fetched_at: datetime,
    forms: list[str] | None,
    limit: int,
) -> dict:
    effective_forms = _DEFAULT_FILING_FORMS if forms is None else forms
    cik = payload["cik"]
    selected = [item for item in payload.get("filings") or [] if item.get("form") in effective_forms]
    selected.sort(
        key=lambda item: (item.get("filingDate") or "", item.get("accessionNumber") or ""),
        reverse=True,
    )
    filings = []
    for item in selected[:limit]:
        accession = item.get("accessionNumber") or ""
        primary_document = item.get("primaryDocument") or ""
        filings.append({
            "form": item.get("form"),
            "filing_date": item.get("filingDate"),
            "report_date": item.get("reportDate"),
            "accession_number": accession,
            "primary_document": primary_document,
            "document_url": (
                f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                f"{accession.replace('-', '')}/{primary_document}"
            ),
        })
    return {
        "symbol": symbol,
        "cik": cik,
        "name": payload.get("name"),
        "filings": filings,
        "source": "SEC EDGAR",
        "fetched_at": _iso_z(fetched_at),
    }


def get_sec_company_filings(
    symbol: str,
    db: Session,
    forms: list[str] | None = None,
    limit: int = 10,
) -> dict:
    symbol = symbol.upper().strip()
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(hours=24)
    cached = db.get(MarketFilingsCache, symbol)
    if cached and cached.fetched_at >= cutoff:
        return _filings_response(symbol, cached.payload, cached.fetched_at, forms, limit)

    ticker_record = _get_ticker_map().get(symbol)
    if not ticker_record:
        raise ValueError(f"SEC company record not found for {symbol}.")

    cik = str(ticker_record["cik_str"]).zfill(10)
    response = requests.get(
        SEC_SUBMISSIONS_URL.format(cik=cik),
        headers=_headers(),
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    payload = {
        "name": data.get("entityName"),
        "cik": cik,
        "filings": _parse_recent_filings(data),
    }

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if cached is None:
        cached = MarketFilingsCache(symbol=symbol, cik=cik, payload=payload, fetched_at=now)
        db.add(cached)
    else:
        cached.cik = cik
        cached.payload = payload
        cached.fetched_at = now

    db.commit()
    return _filings_response(symbol, payload, cached.fetched_at, forms, limit)

