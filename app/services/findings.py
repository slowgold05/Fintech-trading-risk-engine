"""Findings opened by a failed control result."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.expansion import Finding


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def open_finding(db: Session, control_id: str, summary: str, *, severity: str = "high",
                 owner: str = "Compliance", due_hours: int = 24) -> Finding:
    current = _now()
    existing = db.execute(select(Finding).where(
        Finding.control_id == control_id, Finding.status == "open")).scalars().first()
    if existing is not None:
        return existing
    row = Finding(
        control_id=control_id, severity=severity, owner=owner, summary=summary[:255],
        status="open", due_at=current + timedelta(hours=due_hours), opened_at=current,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def open_for_violations(db: Session, control_id: str, result: dict) -> Finding | None:
    if not result.get("violation_count"):
        return None
    return open_finding(db, control_id, f"{control_id} failed with {result['violation_count']} violation(s).")


def list_findings(db: Session) -> list[dict]:
    rows = db.execute(select(Finding).order_by(Finding.id.desc())).scalars().all()
    return [{
        "id": row.id, "control_id": row.control_id, "severity": row.severity,
        "owner": row.owner, "summary": row.summary, "status": row.status,
        "due_at": row.due_at,
    } for row in rows]


def check_open_findings(db: Session, control_id: str) -> dict:
    rows = db.execute(select(Finding).where(Finding.control_id == control_id)).scalars().all()
    violations = [row.id for row in rows if row.status == "open"]
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}


def workpaper_markdown(control_id: str, result: dict, findings: list[dict]) -> str:
    related = [item for item in findings if item["control_id"] == control_id]
    lines = [
        f"# {control_id} workpaper",
        "",
        f"- Checked: {result.get('checked', 0)}",
        f"- Violations: {result.get('violation_count', 0)}",
        "",
        "## Findings",
        "",
    ]
    if not related:
        lines.append("No open finding for this result.")
    else:
        lines.extend(f"- Finding {item['id']}: {item['summary']} ({item['status']})" for item in related)
    lines.append("")
    return "\n".join(lines)
