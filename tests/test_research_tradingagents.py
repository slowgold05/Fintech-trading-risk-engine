"""TradingAgents synthesis backend. The real package is never imported here."""

from pathlib import Path

import pytest

from app.core.config import settings
from app.services.research_tradingagents import _build_config, generate_tradingagents_synthesis


def _patch_graph(monkeypatch, final_state, signal, recorded=None):
    class FakeGraph:
        def __init__(self, debug, config):
            if recorded is not None:
                recorded["debug"] = debug
                recorded["config"] = config

        def propagate(self, symbol, as_of_date):
            if recorded is not None:
                recorded["symbol"] = symbol
                recorded["as_of_date"] = as_of_date
            return final_state, signal

    monkeypatch.setattr(
        "app.services.research_tradingagents._import_tradingagents",
        lambda: (FakeGraph, {"some": "default"}),
    )


def test_generate_tradingagents_synthesis_maps_final_state_fields(monkeypatch, tmp_path) -> None:
    final_state = {
        "investment_debate_state": {
            "bull_history": "BULL-MARKER",
            "bear_history": "BEAR-MARKER",
        },
        "risk_debate_state": {"history": "RISK-MARKER"},
        "investment_plan": "PLAN-MARKER",
        "market_report": "MARKET-MARKER",
        "sentiment_report": "SENTIMENT-MARKER",
        "news_report": "NEWS-MARKER",
        "fundamentals_report": "FUNDAMENTALS-MARKER",
        "trader_investment_plan": "TRADER-MARKER",
        "final_trade_decision": "DECISION-MARKER",
    }
    recorded = {}
    monkeypatch.setattr(settings, "research_tradingagents_data_dir", str(tmp_path))
    _patch_graph(monkeypatch, final_state, "Buy", recorded)

    result = generate_tradingagents_synthesis("AAPL", "2026-11-08")

    assert result["bull_case"] == "BULL-MARKER"
    assert result["bear_case"] == "BEAR-MARKER"
    assert result["synthesis"] == "PLAN-MARKER"
    assert result["risks"] == "RISK-MARKER"
    assert result["model_version"] == settings.research_llm_model
    assert result["prompt_version"] == "tradingagents-v1"
    assert result["backend_detail"] == {
        "signal": "Buy",
        "market_report": "MARKET-MARKER",
        "sentiment_report": "SENTIMENT-MARKER",
        "news_report": "NEWS-MARKER",
        "fundamentals_report": "FUNDAMENTALS-MARKER",
        "trader_investment_plan": "TRADER-MARKER",
        "final_trade_decision": "DECISION-MARKER",
    }
    assert result["backend_detail"]["signal"] == "Buy"
    assert recorded["debug"] is False
    assert recorded["symbol"] == "AAPL"
    assert recorded["as_of_date"] == "2026-11-08"
    assert recorded["config"]["llm_provider"] == "ollama"


def test_generate_tradingagents_synthesis_handles_missing_state_keys(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(settings, "research_tradingagents_data_dir", str(tmp_path))
    _patch_graph(monkeypatch, {}, "Hold")

    result = generate_tradingagents_synthesis("AAPL", "2026-11-08")

    assert result["bull_case"] is None
    assert result["bear_case"] is None
    assert result["synthesis"] is None
    assert result["risks"] is None
    assert result["model_version"] == settings.research_llm_model
    assert result["prompt_version"] == "tradingagents-v1"
    detail = result["backend_detail"]
    assert detail["signal"] == "Hold"
    for key in (
        "market_report",
        "sentiment_report",
        "news_report",
        "fundamentals_report",
        "trader_investment_plan",
        "final_trade_decision",
    ):
        assert detail[key] is None


def test_build_config_points_at_ollama_and_the_configured_model(tmp_path) -> None:
    config = _build_config(tmp_path, {"some": "default", "llm_provider": "openai"})

    assert config["llm_provider"] == "ollama"
    assert config["backend_url"].endswith("/v1")
    assert config["backend_url"] == f"{settings.research_llm_base_url}/v1"
    assert config["deep_think_llm"] == settings.research_llm_model
    assert config["quick_think_llm"] == settings.research_llm_model
    assert config["max_debate_rounds"] == 1
    assert config["max_risk_discuss_rounds"] == 1
    assert Path(config["results_dir"]) == tmp_path / "logs"
    assert Path(config["data_cache_dir"]) == tmp_path / "cache"
    assert Path(config["memory_log_path"]) == tmp_path / "memory" / "trading_memory.md"
    assert config["some"] == "default"


def test_missing_package_raises_a_clear_runtime_error() -> None:
    with pytest.raises(RuntimeError) as exc_info:
        generate_tradingagents_synthesis("AAPL", "2026-11-08")
    message = str(exc_info.value)
    assert "tradingagents" in message
    assert "not installed" in message


def test_module_imports_without_the_real_package() -> None:
    import app.services.research_tradingagents as module

    assert hasattr(module, "generate_tradingagents_synthesis")
    assert hasattr(module, "_build_config")
