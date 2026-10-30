from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4


EVIDENCE_DIR = Path(__file__).resolve().parents[2] / "grc/evidence"


def control_status(control_id: str, result: dict) -> str:
    if control_id == "SM-LD-01":
        return "fail" if result["failures"] else "pass" if result["checked"] else "no_sample"
    if control_id == "SM-MD-01":
        return "fail" if not result["checked"] or result["missing_count"] or result["stale_count"] else "pass"
    if control_id == "SM-PT-02":
        return "fail" if result["violation_count"] else "pass" if result["checked"] else "no_sample"
    if control_id == "SM-AC-01":
        return "fail" if result["violation_count"] or result["checked"] != 4 else "pass"
    if control_id == "SM-AC-02":
        return "fail" if result["violation_count"] else "pass" if result["checked"] else "no_sample"
    if control_id == "SM-PT-04":
        return "fail" if result["violation_count"] else "pass" if result["checked"] else "no_sample"
    return "unknown"


def write_evidence(control_id: str, result: dict) -> tuple[Path, str]:
    folder = EVIDENCE_DIR / control_id
    folder.mkdir(parents=True, exist_ok=True)
    record = {
        "control_id": control_id,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "result": result,
    }
    payload = json.dumps(record, sort_keys=True, separators=(",", ":")) + "\n"
    path = folder / f"{uuid4().hex}.json"
    with path.open("x", encoding="utf-8", newline="\n") as evidence:
        evidence.write(payload)
    return path, sha256(payload.encode()).hexdigest()
