import io
import json
from hashlib import sha256
from zipfile import ZipFile

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.control_evidence import ControlEvidence


def latest_evidence(db: Session) -> list[ControlEvidence]:
    latest: dict[str, ControlEvidence] = {}
    for row in db.execute(select(ControlEvidence).order_by(ControlEvidence.id)).scalars():
        latest[row.control_id] = row
    return [latest[key] for key in sorted(latest)]


def check_audit_bundle(db: Session) -> dict:
    rows = latest_evidence(db)
    violations = [row.control_id for row in rows if sha256(row.payload.encode()).hexdigest() != row.sha256]
    return {"checked": len(rows), "violation_count": len(violations), "violations": violations[:20]}


def build_evidence_zip(db: Session) -> bytes:
    rows = latest_evidence(db)
    manifest = {"files": [{"name": f"{row.control_id}.json", "sha256": row.sha256} for row in rows]}
    buffer = io.BytesIO()
    with ZipFile(buffer, "w") as archive:
        for row in rows:
            archive.writestr(f"{row.control_id}.json", row.payload)
        archive.writestr("MANIFEST.json", json.dumps(manifest, sort_keys=True))
    return buffer.getvalue()
