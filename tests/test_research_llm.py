"""Local-model research synthesis. Parser vectors and one mocked generate call."""

from app.core.config import settings
from app.services.research_llm import _parse_sections, generate_synthesis

_BULL = "Strong recent revenue growth and a healthy balance sheet support upside."
_BEAR = "Margins have compressed and competitive pressure is rising."
_SYNTHESIS = "Overall a cautiously positive setup given the growth trajectory."
_RISKS = "Macro headwinds and regulatory filings show increased litigation exposure."

# Reference 1 from docs/P5D_RESEARCH_SYNTHESIS_CONTRACT.md.
_WELL_FORMED = f"""\
BULL CASE:
{_BULL}

BEAR CASE:
{_BEAR}

SYNTHESIS:
{_SYNTHESIS}

RISKS:
{_RISKS}
"""

# Reference 2 — the RISKS marker is absent. The other three sections are unchanged.
_MISSING_RISKS = f"""\
BULL CASE:
{_BULL}

BEAR CASE:
{_BEAR}

SYNTHESIS:
{_SYNTHESIS}
"""

# Reference 3 — same paragraphs, markers in a different order than instructed.
_OUT_OF_ORDER = f"""\
SYNTHESIS:
{_SYNTHESIS}

BULL CASE:
{_BULL}

RISKS:
{_RISKS}

BEAR CASE:
{_BEAR}
"""

# Reference 4 — the model ignored the format entirely.
_NO_MARKERS = "Revenue grew and margins held, but this note has no section markers."

_ALL_FOUR = {
    "bull_case": _BULL,
    "bear_case": _BEAR,
    "synthesis": _SYNTHESIS,
    "risks": _RISKS,
}


def test_parses_well_formed_response_in_instructed_order() -> None:
    assert _parse_sections(_WELL_FORMED) == _ALL_FOUR


def test_missing_marker_leaves_that_field_none() -> None:
    assert _parse_sections(_MISSING_RISKS) == {**_ALL_FOUR, "risks": None}


def test_parses_correctly_when_markers_are_out_of_order() -> None:
    assert _parse_sections(_OUT_OF_ORDER) == _ALL_FOUR


def test_no_markers_at_all_returns_all_none() -> None:
    assert _parse_sections(_NO_MARKERS) == {
        "bull_case": None,
        "bear_case": None,
        "synthesis": None,
        "risks": None,
    }


def test_generate_synthesis_returns_parsed_sections_and_versions(monkeypatch) -> None:
    captured = {}

    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"response": _WELL_FORMED}

    def _post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return _Response()

    monkeypatch.setattr("app.services.research_llm.requests.post", _post)
    sources = [
        {"type": "sec_fundamentals", "status": "ok", "detail": "Apple Inc."},
        {"type": "sec_filings", "status": "ok", "detail": "2 recent filings"},
    ]

    result = generate_synthesis("AAPL", sources)

    assert result == {
        **_ALL_FOUR,
        "model_version": settings.research_llm_model,
        "prompt_version": settings.research_prompt_version,
    }
    assert captured["url"] == f"{settings.research_llm_base_url}/api/generate"
    assert captured["timeout"] == settings.research_llm_timeout_seconds
    assert captured["json"]["model"] == settings.research_llm_model
    assert captured["json"]["stream"] is False
    assert "AAPL" in captured["json"]["prompt"]
    assert "sec_fundamentals: ok (Apple Inc.)" in captured["json"]["prompt"]
