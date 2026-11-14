from pathlib import Path

import yaml


INVENTORY = Path(__file__).resolve().parents[2] / "grc" / "asset_inventory.yaml"
REQUIRED_IDS = ("web-api", "database", "source-repository", "evidence-store")
REQUIRED_FIELDS = ("id", "name", "type", "owner", "location", "data_classes")


def check_asset_inventory(path: Path | None = None) -> dict:
    inventory = path or INVENTORY
    if not inventory.exists():
        return {"checked": 0, "violation_count": 1, "violations": ["asset inventory file is missing"]}
    loaded = yaml.safe_load(inventory.read_text(encoding="utf-8"))
    assets = loaded.get("assets") if isinstance(loaded, dict) else None
    if not isinstance(assets, list):
        return {"checked": 0, "violation_count": 1, "violations": ["asset inventory has no asset list"]}
    violations = []
    seen = set()
    for asset in assets:
        if not isinstance(asset, dict):
            violations.append("asset entry is not a record")
            continue
        missing = [field for field in REQUIRED_FIELDS if not asset.get(field)]
        if missing:
            violations.append(f"{asset.get('id', 'unknown')} missing {', '.join(missing)}")
        elif not isinstance(asset["data_classes"], list) or not asset["data_classes"]:
            violations.append(f"{asset['id']} has no data class")
        seen.add(asset.get("id"))
    for required in REQUIRED_IDS:
        if required not in seen:
            violations.append(f"missing asset {required}")
    return {"checked": len(assets), "violation_count": len(violations), "violations": violations[:20]}
