"""Verified company events from the existing SEC submissions cache."""

from datetime import date, datetime
import re

from sqlalchemy.orm import Session

from app.core.read_snapshot import consistent_read, snapshot_clock
from app.models.market_filings_cache import MarketFilingsCache
from app.models.market_symbol import MarketSymbol
from app.schemas.night_market import Events, MarketEvent, Provenance
from app.services.night_market_common import market_error, normalize_symbol, utc

_SEC = "sec_edgar"
_CIK = re.compile(r"[0-9]{1,10}")
_ACCESSION = re.compile(r"[0-9]{10}-[0-9]{2}-[0-9]{6}")
_FORM = re.compile(r"[A-Z0-9][A-Z0-9 /&-]{0,39}")
_DOCUMENT = re.compile(r"[a-zA-Z0-9_-][a-zA-Z0-9._-]*(?:/[a-zA-Z0-9_-][a-zA-Z0-9._-]*)*")


def _cik_number(raw: object) -> int | None:
    if not isinstance(raw, str) or not _CIK.fullmatch(raw):
        return None
    return int(raw) or None


def _filing_date(raw: object) -> date | None:
    if not isinstance(raw, str):
        return None
    try:
        filed = date.fromisoformat(raw)
    except ValueError:
        return None
    return filed if filed.isoformat() == raw else None


def _filings(listing: MarketSymbol, cache: MarketFilingsCache | None, clock: datetime) -> list[MarketEvent]:
    if cache is None or cache.source != _SEC or cache.fetched_at > clock or not isinstance(cache.payload, dict):
        return []
    cik = _cik_number(cache.cik)
    if cik is None or _cik_number(cache.payload.get("cik")) != cik:
        return []
    if listing.cik is not None and _cik_number(listing.cik) != cik:
        return []

    records = cache.payload.get("filings")
    if not isinstance(records, list):
        return []
    source = Provenance(
        provider=_SEC, basis="filing", session_date=None,
        observed_at=utc(cache.fetched_at), coverage="available",
    )

    by_accession: dict[str, MarketEvent] = {}
    for record in records:
        if not isinstance(record, dict):
            continue
        accession, form, document = (record.get(key) for key in ("accessionNumber", "form", "primaryDocument"))
        filed = _filing_date(record.get("filingDate"))
        if (
            not isinstance(accession, str) or not _ACCESSION.fullmatch(accession)
            or not isinstance(form, str) or not _FORM.fullmatch(form)
            or not isinstance(document, str) or not _DOCUMENT.fullmatch(document)
            or filed is None or filed > clock.date()
            or accession in by_accession
        ):
            continue
        directory = accession.replace("-", "")
        by_accession[accession] = MarketEvent(
            kind="filing", date=filed, title=f"SEC Form {form}", form=form,
            url=f"https://www.sec.gov/Archives/edgar/data/{cik}/{directory}/{document}",
            source=source,
        )

    sorted_keys = sorted(by_accession, key=lambda key: (by_accession[key].date, key), reverse=True)
    return [by_accession[key] for key in sorted_keys]


def read_events(db: Session, *, symbol: str, limit: int) -> Events:
    ticker = normalize_symbol(symbol)
    with consistent_read(db):
        listing = db.get(MarketSymbol, ticker)
        if listing is None:
            raise market_error(404, "unknown_symbol", f"Unknown ticker: {ticker}.")
        items = _filings(listing, db.get(MarketFilingsCache, ticker), snapshot_clock(db))
        # Standard submissions metadata does not verify corporate action dates or terms.
        return Events(
            symbol=ticker, coverage="partial" if items else "missing",
            coverage_by_kind={"filing": "available" if items else "missing", "dividend": "missing", "split": "missing"},
            items=items[:limit],
        )
