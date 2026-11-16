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


def trailing_diluted_eps(facts: dict) -> dict | None:
    """Sum the latest four standard diluted-EPS quarters.

    A quarter is the same shape the margin matcher accepts: fiscal period
    Q1-Q4 and a duration of 70 to 120 days. Year-to-date rows and annual rows
    are left out. Fewer than four such quarters, or four that do not cover
    about one year without overlap, is not a trailing twelve months.
    """
    chosen = _best_by_period(_share_duration_facts(facts, ["EarningsPerShareDiluted"]))
    quarters = [item for item in chosen.values() if _is_standard_quarter(item)]
    by_end: dict[str, dict] = {}
    for item in quarters:
        rank = (item["filed"], -item["concept_rank"], item["index"])
        current = by_end.get(item["end"])
        if current is None or rank > current["_pick"]:
            by_end[item["end"]] = {**item, "_pick": rank}
    ordered = sorted(by_end.values(), key=lambda item: item["end"])
    if len(ordered) < 4:
        return None
    window = ordered[-4:]
    span = _period_days(window[0]["start"], window[-1]["end"])
    if span is None or not 300 <= span <= 400:
        return None
    for previous, current in zip(window, window[1:]):
        gap = _period_days(previous["end"], current["start"])
        if gap is None or gap < -5 or gap > 20:
            return None
    return {
        "eps": sum(item["val"] for item in window),
        "periods": [
            {
                "form": item["form"],
                "start": item["start"],
                "end": item["end"],
                "fp": item["fp"],
                "fy": item["fy"],
            }
            for item in window
        ],
    }


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

