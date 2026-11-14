"""Untrusted text checks for the propose-only analyst.

Ticker links require a cashtag. Bare words such as "IT" do not match.
The manipulation label never names an account. No source is fetched here.
"""

from __future__ import annotations

import re
from decimal import Decimal
from pathlib import Path

import yaml


INJECTION_PHRASES = (
    "ignore previous",
    "ignore all previous",
    "system prompt",
    "disregard the rules",
    "you are now",
)
CASHTAG = re.compile(r"\$([A-Z]{1,5})\b")
LEXICON = {"beat": 1, "growth": 1, "upgrade": 1, "loss": -1, "fraud": -1, "downgrade": -1}
REGISTRY = Path(__file__).resolve().parents[2] / "grc" / "signals" / "accounts.yaml"


def scan_untrusted(text: str) -> list[str]:
    lowered = text.casefold()
    return [phrase for phrase in INJECTION_PHRASES if phrase in lowered]


def link_tickers(text: str, universe: set[str]) -> list[str]:
    found = []
    for match in CASHTAG.findall(text.upper()):
        if match in universe and match not in found:
            found.append(match)
    return found


def sentiment_score(text: str) -> Decimal:
    total = 0
    hits = 0
    lowered = text.casefold()
    for word, weight in LEXICON.items():
        if word in lowered:
            total += weight
            hits += 1
    if hits == 0:
        return Decimal(0)
    return (Decimal(total) / Decimal(hits)).quantize(Decimal("0.01"))


def manipulation_score(*, mentions_now: int, average: Decimal, similar_posts: int,
                       new_account_share: Decimal, thin: bool) -> dict:
    flags = []
    if average > 0 and Decimal(mentions_now) > average * 3:
        flags.append("mention_spike")
    if similar_posts >= 3:
        flags.append("coordination")
    if new_account_share > Decimal("0.5"):
        flags.append("new_accounts")
    if thin:
        flags.append("thin_stock")
    alert = len(flags) >= 2
    return {
        "flags": flags,
        "alert": alert,
        "label": "unusual activity, needs review" if alert else "",
    }


def load_registry(path: Path | None = None) -> dict:
    loaded = yaml.safe_load((path or REGISTRY).read_text(encoding="utf-8"))
    if not isinstance(loaded, dict) or not isinstance(loaded.get("accounts"), list):
        raise ValueError("Signal account registry is incomplete")
    return loaded


TIER_RANK = {"regulator": 1, "newswire": 2, "company_ir": 3, "curated": 4, "analyst": 4, "search": 5}


def credibility_rank(tier: str) -> int:
    if tier not in TIER_RANK:
        raise ValueError("Unknown credibility tier")
    return TIER_RANK[tier]


def review_account(account: dict) -> list[str]:
    missing = []
    if not account.get("did"):
        missing.append("did")
    if account.get("identity") not in {"domain", "website"}:
        missing.append("identity")
    if not account.get("posted_recently"):
        missing.append("recent_post")
    if account.get("conflict"):
        missing.append("conflict")
    if account.get("lookalike"):
        missing.append("lookalike")
    if not account.get("approved_by") or not account.get("approved_at"):
        missing.append("approver")
    return missing
