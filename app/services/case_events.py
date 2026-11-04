import json

DISPLAY_EVENT_LIMIT = 20


def stored_event_ids(event_ids) -> list[str]:
    return list(dict.fromkeys(event_ids))


def display_event_ids(event_ids, limit: int = DISPLAY_EVENT_LIMIT) -> list[str]:
    return stored_event_ids(event_ids)[:limit]


def already_reviewed(cases, rule_version: int, event_ids) -> bool:
    incoming = stored_event_ids(event_ids)
    if not incoming:
        return False
    wanted = set(incoming)
    for case in cases:
        if case.rule_version != rule_version:
            continue
        if wanted <= _recorded(case.event_ids):
            return True
    return False


def unreviewed_group(detections, prior, rule_version: int):
    chosen = None
    collected: list[str] = []
    for item in detections:
        identity = stored_event_ids(item.event_ids)
        if not identity or already_reviewed(prior, rule_version, identity):
            continue
        if chosen is None:
            chosen = item
        collected.extend(identity)
    if chosen is None:
        return None
    return chosen, stored_event_ids(collected)


def _recorded(raw: str) -> set[str]:
    try:
        loaded = json.loads(raw)
    except (TypeError, ValueError):
        return set()
    if not isinstance(loaded, list):
        return set()
    return {item for item in loaded if isinstance(item, str)}
