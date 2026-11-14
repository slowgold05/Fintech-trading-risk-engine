"""Daily risk brief rendered only from supplied figures.

The narrative is a template. A number that is not in the supplied figures
fails verification and is not stored.
"""

from __future__ import annotations

import json
import re
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.expansion import ExpansionAlert, RiskBrief


NUMBER = re.compile(r"\d+(?:\.\d+)?")
FIELDS = (
    ("exposure", "Portfolio exposure"),
    ("limit_used", "Limit utilisation"),
    ("limit_cap", "Hard limit"),
    ("forecast_vol", "Forecast daily volatility"),
    ("intents_proposed", "Intents proposed"),
    ("intents_approved", "Intents approved"),
    ("intents_rejected", "Intents rejected"),
    ("failed_controls", "Failed control results"),
    ("open_findings", "Open findings"),
    ("monitor", "Forecast monitor"),
)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def render_brief(figures: dict) -> str:
    lines = ["Daily risk brief"]
    for key, label in FIELDS:
        if key in figures:
            lines.append(f"{label}: {figures[key]}")
    lines.append("This brief uses only the figures listed above.")
    return "\n".join(lines)


def verify_brief(text: str, figures: dict) -> list[str]:
    allowed = {token for value in figures.values() for token in NUMBER.findall(str(value))}
    return [token for token in NUMBER.findall(text) if token not in allowed]


def alerts_for(figures: dict) -> list[dict]:
    alerts = []
    used = Decimal(str(figures.get("limit_used", "0")))
    cap = Decimal(str(figures.get("limit_cap", "1")))
    if cap > 0 and used >= cap:
        alerts.append({"kind": "limit_breach", "summary": f"Limit utilisation {used} is at the hard limit {cap}."})
    if int(figures.get("failed_controls", 0) or 0) > 0:
        alerts.append({"kind": "failed_control", "summary": f"{figures['failed_controls']} control result(s) failed."})
    if figures.get("monitor") == "disabled":
        alerts.append({"kind": "model_monitor", "summary": "The forecast monitor is disabled."})
    return alerts


def archive_brief(body: str, figures: dict, path: Path) -> Path:
    """Write the brief to a file after the same number check. This does not send a message."""
    if verify_brief(body, figures):
        raise ValueError("Brief contains a number that was not supplied")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body if body.endswith("\n") else body + "\n", encoding="utf-8", newline="\n")
    return path


def publish_brief(db: Session, figures: dict, brief_date: date | None = None) -> RiskBrief:
    body = render_brief(figures)
    problems = verify_brief(body, figures)
    if problems:
        raise ValueError("Brief contains a number that was not supplied")
    current = _now()
    row = RiskBrief(
        brief_date=brief_date or current.date(),
        body=body,
        figures=json.dumps({key: str(figures[key]) for key in figures}),
        created_at=current,
    )
    db.add(row)
    db.flush()
    for alert in alerts_for(figures):
        db.add(ExpansionAlert(
            kind=alert["kind"], summary=alert["summary"], evidence_ref=f"risk_brief:{row.id}", created_at=current,
        ))
    db.commit()
    db.refresh(row)
    return row


def latest_brief(db: Session) -> dict | None:
    row = db.execute(select(RiskBrief).order_by(RiskBrief.id.desc())).scalars().first()
    if row is None:
        return None
    return {"id": row.id, "brief_date": row.brief_date, "body": row.body, "figures": json.loads(row.figures)}


def list_alerts(db: Session) -> list[dict]:
    rows = db.execute(select(ExpansionAlert).order_by(ExpansionAlert.id.desc())).scalars().all()
    return [{"id": row.id, "kind": row.kind, "summary": row.summary, "evidence_ref": row.evidence_ref} for row in rows]


def check_briefs(db: Session) -> dict:
    rows = db.execute(select(RiskBrief)).scalars().all()
    violations = []
    for row in rows:
        if verify_brief(row.body, json.loads(row.figures)):
            violations.append(row.id)
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}
