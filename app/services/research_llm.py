import requests

from app.core.config import settings

_MARKERS = ["BULL CASE:", "BEAR CASE:", "SYNTHESIS:", "RISKS:"]
_KEY_BY_MARKER = {
    "BULL CASE:": "bull_case",
    "BEAR CASE:": "bear_case",
    "SYNTHESIS:": "synthesis",
    "RISKS:": "risks",
}


def _build_prompt(symbol: str, sources: list[dict]) -> str:
    lines = [f"Write a short equity research note for {symbol}."]
    lines.append("Available data sources for this note:")
    for source in sources:
        lines.append(f"- {source['type']}: {source['status']} ({source['detail']})")
    lines.append(
        "Respond using exactly these four section markers, each on its own line, "
        "followed by a short paragraph: BULL CASE:, BEAR CASE:, SYNTHESIS:, RISKS:"
    )
    return "\n".join(lines)


def _call_local_model(prompt: str) -> dict:
    response = requests.post(
        f"{settings.research_llm_base_url}/api/generate",
        json={"model": settings.research_llm_model, "prompt": prompt, "stream": False},
        timeout=settings.research_llm_timeout_seconds,
    )
    response.raise_for_status()
    return response.json()


def _parse_sections(text: str) -> dict:
    result = {"bull_case": None, "bear_case": None, "synthesis": None, "risks": None}
    positions = []
    for marker in _MARKERS:
        idx = text.find(marker)
        if idx != -1:
            positions.append((idx, marker))
    positions.sort()
    for i, (idx, marker) in enumerate(positions):
        start = idx + len(marker)
        end = positions[i + 1][0] if i + 1 < len(positions) else len(text)
        content = text[start:end].strip()
        result[_KEY_BY_MARKER[marker]] = content or None
    return result


def generate_synthesis(symbol: str, sources: list[dict]) -> dict:
    prompt = _build_prompt(symbol, sources)
    body = _call_local_model(prompt)
    text = body["response"]
    sections = _parse_sections(text)
    total_duration_ns = body.get("total_duration")
    return {
        **sections,
        "model_version": settings.research_llm_model,
        "prompt_version": settings.research_prompt_version,
        "prompt_tokens": body.get("prompt_eval_count"),
        "completion_tokens": body.get("eval_count"),
        "duration_ms": None if total_duration_ns is None else total_duration_ns // 1_000_000,
    }
