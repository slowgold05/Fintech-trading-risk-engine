import json
import re

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aml import AmlCase
from app.models.sar import SarDraft
from app.models.surveillance import SurveillanceCase
from app.models.user import User


EVENT_TOKEN = re.compile(r"\b(?:cash|trade|order|cancel)-\d+\b")
FILING_PHRASES = ("file a sar", "do not file", "we recommend filing", "sar is required", "filing decision")
REVIEW_ROLES = {"admin", "compliance_officer"}


def draft_narrative(case_kind: str, case_id: int, event_ids: list[str], summary: str) -> str:
    cited = ", ".join(event_ids)
    return "\n".join([
        f"Draft for {case_kind} case {case_id}. {summary}",
        f"Events cited: {cited}",
        "This draft describes only those events. Filing is outside this draft.",
    ])


def verify_narrative(event_ids: list[str], narrative: str) -> list[str]:
    violations = []
    lowered = narrative.casefold()
    for phrase in FILING_PHRASES:
        if phrase in lowered:
            violations.append(f"filing:{phrase}")
    cited_line = ""
    for row in narrative.splitlines():
        if row.startswith("Events cited:"):
            cited_line = row.split(":", 1)[1]
    cited = [item.strip() for item in cited_line.split(",") if item.strip()]
    if sorted(cited) != sorted(set(event_ids)) or len(cited) != len(set(cited)):
        violations.append("cited-set")
    extras = [token for token in EVENT_TOKEN.findall(narrative) if token not in set(event_ids)]
    if extras:
        violations.append("extra-event")
    return violations


def _case_events(db: Session, case_kind: str, case_id: int) -> tuple[list[str], str]:
    if case_kind == "aml":
        case = db.get(AmlCase, case_id)
    elif case_kind == "surveillance":
        case = db.get(SurveillanceCase, case_id)
    else:
        case = None
    if case is None:
        raise HTTPException(status_code=404, detail="Case not found")
    event_ids = json.loads(case.event_ids)
    if not isinstance(event_ids, list) or not event_ids:
        raise HTTPException(status_code=422, detail="The case has no event ids")
    return [str(item) for item in event_ids], case.summary


def create_draft(db: Session, user: User, case_kind: str, case_id: int) -> SarDraft:
    if user.role not in REVIEW_ROLES:
        raise HTTPException(status_code=403, detail="A reviewer role is required")
    event_ids, summary = _case_events(db, case_kind, case_id)
    narrative = draft_narrative(case_kind, case_id, event_ids, summary)
    problems = verify_narrative(event_ids, narrative)
    if problems:
        raise HTTPException(status_code=422, detail="The draft failed verification")
    row = SarDraft(
        case_kind=case_kind, case_id=case_id, event_ids=json.dumps(event_ids),
        narrative=narrative, created_by_user_id=user.id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def check_sar_drafts(db: Session) -> dict:
    rows = db.execute(select(SarDraft)).scalars().all()
    violations = []
    for row in rows:
        event_ids = json.loads(row.event_ids)
        if verify_narrative(event_ids, row.narrative):
            violations.append(row.id)
    return {"checked": len(rows), "violation_count": len(violations), "violation_ids": violations[:20]}
