from datetime import datetime, timezone
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.aml import AmlCase, Incident
from app.models.surveillance import SurveillanceCase
from app.models.user import User
from app.services.sanctions import check_sanctions_screening, normalize_name


KRI_FILE = Path(__file__).resolve().parents[2] / "grc" / "kris.yaml"


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def load_kri_definitions(path: Path | None = None) -> list[dict]:
    loaded = yaml.safe_load((path or KRI_FILE).read_text(encoding="utf-8"))
    rows = loaded.get("kris") if isinstance(loaded, dict) else None
    if not isinstance(rows, list) or not rows:
        raise ValueError("KRI file is incomplete")
    return rows


def kri_values(db: Session, now: datetime | None = None) -> list[dict]:
    current = now or _now()
    aml_cases = db.execute(select(AmlCase)).scalars().all()
    surveillance_cases = db.execute(select(SurveillanceCase)).scalars().all()
    incidents = db.execute(select(Incident)).scalars().all()
    named = [user for user in db.query(User).all() if normalize_name(user.full_name)]
    sanctions = check_sanctions_screening(db)
    measures = {
        "KRI-01": (len(aml_cases), sum(1 for case in aml_cases if case.status == "open" and current > case.due_at)),
        "KRI-02": (len(named), sum(1 for item in sanctions["violations"] if str(item).startswith("user:"))),
        "KRI-03": (len(incidents), sum(1 for row in incidents if row.customer_notified_at is None and current > row.customer_notice_due_at)),
        "KRI-04": (len(surveillance_cases), sum(1 for case in surveillance_cases if case.status == "open" and current > case.due_at)),
    }
    output = []
    for item in load_kri_definitions():
        population, value = measures[item["id"]]
        threshold = int(item["threshold"])
        if population == 0:
            status = "no_sample"
        elif value > threshold:
            status = "breach"
        else:
            status = "within_threshold"
        output.append({
            "id": item["id"], "title": item["title"], "owner": item["owner"],
            "threshold": threshold, "value": value, "status": status, "escalation": item["escalation"],
        })
    return output
