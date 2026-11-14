from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.control_evidence import ControlEvidence


EVIDENCE_DIR = Path(__file__).resolve().parents[2] / "grc/evidence"


def control_status(control_id: str, result: dict) -> str:
    if control_id == "SM-LD-01":
        return "fail" if result["failures"] else "pass" if result["checked"] else "no_sample"
    if control_id == "SM-MD-01":
        return "fail" if not result["checked"] or result["missing_count"] or result["stale_count"] else "pass"
    if control_id in {"SM-PT-02", "SM-PT-01", "SM-AC-02", "SM-PT-04", "SM-AC-03", "SM-PT-06", "SM-SV-05", "SM-AC-04", "SM-AC-05", "SM-AM-01", "SM-AML-03", "SM-SN-01", "SM-IR-01", "SM-RP-01", "SM-AU-01", "SM-DQ-01", "SM-FC-01", "SM-AI-01", "SM-SG-01", "SM-BR-01"}:
        return "fail" if result["violation_count"] else "pass" if result["checked"] else "no_sample"
    if control_id == "SM-AC-01":
        return "fail" if result["violation_count"] or result["checked"] != 5 else "pass"
    if control_id == "SM-EV-01":
        return "fail" if result["violation_count"] or result["checked"] != 2 else "pass"
    if control_id in {"SM-CM-01", "SM-SM-01"}:
        return "fail" if result["violation_count"] else "pass" if result["checked"] else "no_sample"
    return "unknown"


def evidence_payload(control_id: str, result: dict, run_at: datetime) -> str:
    record = {"control_id": control_id, "run_at": run_at.isoformat(), "result": result}
    return json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n"


def describe_payload(control_id: str, payload: str) -> dict:
    evidence = json.loads(payload)
    if evidence.get("control_id") != control_id or not isinstance(evidence.get("result"), dict):
        raise ValueError("Control evidence payload does not match the control")
    return {"status": control_status(control_id, evidence["result"]), "run_at": evidence.get("run_at"),
            "checked": evidence["result"].get("checked"), "sha256": sha256(payload.encode()).hexdigest()}


def write_evidence(control_id: str, result: dict, db: Session | None = None) -> tuple[Path, str]:
    run_at = datetime.now(timezone.utc)
    payload = evidence_payload(control_id, result, run_at)
    digest = sha256(payload.encode()).hexdigest()
    folder = EVIDENCE_DIR / control_id
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{run_at.strftime('%Y%m%dT%H%M%S%fZ')}-{digest[:12]}.json"
    with path.open("x", encoding="utf-8", newline="\n") as evidence:
        evidence.write(payload)
    if db is not None:
        db.add(ControlEvidence(control_id=control_id, run_at=run_at.replace(tzinfo=None), payload=payload, sha256=digest))
        db.commit()
    return path, digest


def latest_database_evidence(db: Session, control_id: str) -> dict | None:
    row = db.execute(
        select(ControlEvidence).where(ControlEvidence.control_id == control_id)
        .order_by(ControlEvidence.id.desc()).limit(1)
    ).scalar_one_or_none()
    if row is None:
        return None
    try:
        item = describe_payload(control_id, row.payload)
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        return {"status": "evidence_error", "run_at": None, "checked": None, "sha256": None}
    if item["sha256"] != row.sha256:
        return {"status": "evidence_error", "run_at": item["run_at"], "checked": item["checked"], "sha256": row.sha256}
    return item


def backfill_missing_file_evidence(db: Session) -> list[str]:
    if not EVIDENCE_DIR.exists():
        return []
    existing = set(db.execute(select(ControlEvidence.control_id).distinct()).scalars())
    imported = []
    for folder in sorted(path for path in EVIDENCE_DIR.iterdir() if path.is_dir()):
        if folder.name in existing:
            continue
        files = list(folder.glob("*.json"))
        if not files:
            continue
        latest = max(files, key=lambda path: path.stat().st_mtime)
        payload = latest.read_text(encoding="utf-8")
        try:
            evidence = json.loads(payload)
            run_at = datetime.fromisoformat(evidence["run_at"])
            if evidence.get("control_id") != folder.name:
                raise ValueError("Control ID mismatch")
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            continue
        digest = sha256(payload.encode()).hexdigest()
        db.add(ControlEvidence(control_id=folder.name, run_at=run_at.replace(tzinfo=None), payload=payload, sha256=digest))
        imported.append(folder.name)
    if imported:
        db.commit()
    return imported
