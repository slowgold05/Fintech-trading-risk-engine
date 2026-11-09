from pathlib import Path

from app.core.config import settings


def _import_tradingagents():
    try:
        from tradingagents.graph.trading_graph import TradingAgentsGraph
        from tradingagents.default_config import DEFAULT_CONFIG
    except ImportError as exc:
        raise RuntimeError("tradingagents package is not installed") from exc
    return TradingAgentsGraph, DEFAULT_CONFIG


def _build_config(base_dir: Path, default_config: dict) -> dict:
    config = default_config.copy()
    config["llm_provider"] = "ollama"
    config["backend_url"] = f"{settings.research_llm_base_url}/v1"
    config["deep_think_llm"] = settings.research_llm_model
    config["quick_think_llm"] = settings.research_llm_model
    config["max_debate_rounds"] = 1
    config["max_risk_discuss_rounds"] = 1
    config["results_dir"] = str(base_dir / "logs")
    config["data_cache_dir"] = str(base_dir / "cache")
    config["memory_log_path"] = str(base_dir / "memory" / "trading_memory.md")
    return config


def generate_tradingagents_synthesis(symbol: str, as_of_date: str) -> dict:
    TradingAgentsGraph, default_config = _import_tradingagents()
    base_dir = Path(settings.research_tradingagents_data_dir)
    base_dir.mkdir(parents=True, exist_ok=True)
    config = _build_config(base_dir, default_config)
    graph = TradingAgentsGraph(debug=False, config=config)
    final_state, signal = graph.propagate(symbol, as_of_date)

    debate = final_state.get("investment_debate_state") or {}
    risk = final_state.get("risk_debate_state") or {}
    return {
        "bull_case": debate.get("bull_history"),
        "bear_case": debate.get("bear_history"),
        "synthesis": final_state.get("investment_plan"),
        "risks": risk.get("history"),
        "model_version": settings.research_llm_model,
        "prompt_version": "tradingagents-v1",
        "backend_detail": {
            "signal": signal,
            "market_report": final_state.get("market_report"),
            "sentiment_report": final_state.get("sentiment_report"),
            "news_report": final_state.get("news_report"),
            "fundamentals_report": final_state.get("fundamentals_report"),
            "trader_investment_plan": final_state.get("trader_investment_plan"),
            "final_trade_decision": final_state.get("final_trade_decision"),
        },
    }
