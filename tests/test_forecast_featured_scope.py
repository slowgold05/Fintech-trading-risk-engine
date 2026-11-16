"""Stage 6 step 3: the 12 featured stocks, and no unreviewed publication."""

import sys
from datetime import date, datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import FEATURED_FORECAST_SYMBOLS, settings
from app.core.forecast_universe import (
    ForecastSymbolRejected,
    require_featured_forecast_symbol,
)
from app.models.forecast_evaluation import ForecastEvaluation
from app.models.forecast_job import ForecastJob
from app.models.forecast_result import ForecastResult
from app.models.market_symbol import MarketSymbol
from app.scripts.run_forecast_evaluation import _make_kronos_forecaster, main
from app.services.forecast_kronos import generate_forecast
from app.services.forecast_publication import (
    UNREVIEWED_PUBLICATION,
    ForecastPublicationRejected,
    forecast_publish_paths,
    publish_forecast_result,
)
from app.services.forecast_worker import process_pending_forecast_jobs


_CHOSEN = (
    "AAPL",
    "MSFT",
    "NVDA",
    "AMZN",
    "GOOGL",
    "JPM",
    "JNJ",
    "XOM",
    "PG",
    "CAT",
    "HD",
    "NEE",
)


def test_featured_forecast_symbols_are_the_twelve_chosen_on_2026_11_15():
    assert FEATURED_FORECAST_SYMBOLS == _CHOSEN
    assert len(set(FEATURED_FORECAST_SYMBOLS)) == 12


def test_require_featured_forecast_symbol_normalizes_and_rejects():
    assert require_featured_forecast_symbol("  aapl ") == "AAPL"
    with pytest.raises(ForecastSymbolRejected, match="TSLA is outside the 12 featured forecast stocks"):
        require_featured_forecast_symbol("tsla")


def test_generate_forecast_rejects_a_symbol_outside_the_twelve_before_history(monkeypatch):
    def forbid(*args, **kwargs):
        raise AssertionError("history must not be read")

    monkeypatch.setattr("app.services.forecast_kronos.read_symbol_history", forbid)
    with pytest.raises(ForecastSymbolRejected, match="IBM is outside the 12 featured forecast stocks"):
        generate_forecast(
            None,
            symbol="IBM",
            provider="massive",
            adjustment_type="raw",
            lookback=1,
            horizon=1,
            sample_count=1,
        )


def test_create_job_rejects_an_active_symbol_outside_the_twelve(
    client: TestClient, auth_headers, db_session: Session,
):
    db_session.add(MarketSymbol(symbol="TSLA", company_name="Tesla", exchange="NASDAQ", is_active=True))
    db_session.commit()
    headers = auth_headers("forecast-outside@example.com")
    response = client.post(
        "/forecasts/jobs",
        headers=headers,
        json={
            "symbol": "TSLA",
            "provider": "massive",
            "adjustment_type": "raw",
            "lookback": 100,
            "horizon": 10,
            "sample_count": 1,
        },
    )
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == "TSLA is outside the 12 featured forecast stocks."


def test_evaluation_script_rejects_a_symbol_outside_the_twelve_before_the_database(monkeypatch):
    monkeypatch.setattr(sys, "argv", ["run_forecast_evaluation", "--symbol", "TSLA"])

    def boom(*args, **kwargs):
        raise AssertionError("database must not be opened")

    monkeypatch.setattr("app.scripts.run_forecast_evaluation.SessionLocal", boom)
    with pytest.raises(SystemExit) as caught:
        main()
    assert caught.value.code == 2


def test_kronos_forecaster_passes_the_window_cutoff_as_as_of(monkeypatch):
    seen = {}

    def fake_generate(db, **kwargs):
        seen.update(kwargs)
        return {"bars": [{"close": 1.5}, {"close": 2.5}]}

    monkeypatch.setattr("app.scripts.run_forecast_evaluation.generate_forecast", fake_generate)
    bars = [
        {"session_date": "2024-01-02", "close": 10.0},
        {"session_date": "2024-01-03", "close": 11.0},
    ]
    predicted = _make_kronos_forecaster(object(), "AAPL", "massive", "raw")(bars, 2)
    assert seen["symbol"] == "AAPL"
    assert seen["provider"] == "massive"
    assert seen["adjustment_type"] == "raw"
    assert seen["as_of"] == date(2024, 1, 3)
    assert seen["lookback"] == min(len(bars), settings.forecast_kronos_max_lookback)
    assert predicted == [1.5, 2.5]


def _evaluation(symbol: str, *, review_status: str) -> ForecastEvaluation:
    return ForecastEvaluation(
        symbol=symbol,
        provider="massive",
        adjustment_type="raw",
        horizon=10,
        window_count=5,
        model_mae=1.25,
        model_directional_accuracy=0.4,
        baseline_type="last_observed_close",
        baseline_mae=1.0,
        baseline_directional_accuracy=0.5,
        weights_exercised=True,
        review_status=review_status,
        notes="Model-owner review: PENDING (user).",
        created_at=datetime(2026, 11, 15, 16, 0, 0),
    )


def _payload() -> dict:
    return {
        "symbol": "AAPL",
        "provider": "massive",
        "adjustment_type": "raw",
        "model_name": "NeoQuasar/Kronos-small",
        "tokenizer_name": "NeoQuasar/Kronos-Tokenizer-base",
        "lookback": 400,
        "horizon": 10,
        "sample_count": 1,
        "input_cutoff": "2026-11-13",
        "generated_at": "2026-11-15T16:00:00Z",
        "bars": [
            {
                "session_date": "2026-11-14",
                "open": 1.0,
                "high": 1.1,
                "low": 0.9,
                "close": 1.05,
                "volume": 10.0,
            }
        ],
    }


def test_unreviewed_evaluation_cannot_reach_any_publish_path(
    client: TestClient, auth_headers, db_session: Session, monkeypatch,
):
    db_session.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    db_session.add(_evaluation("AAPL", review_status="pending"))
    db_session.commit()

    def succeed(db, **kwargs):
        return _payload()

    monkeypatch.setattr(settings, "forecast_kronos_enabled", True)
    monkeypatch.setattr("app.services.forecast_worker.generate_forecast", succeed)
    headers = auth_headers("forecast-unreviewed@example.com")
    created = client.post(
        "/forecasts/jobs",
        headers=headers,
        json={
            "symbol": "AAPL",
            "provider": "massive",
            "adjustment_type": "raw",
            "lookback": 100,
            "horizon": 10,
            "sample_count": 1,
        },
    )
    assert created.status_code == 201, created.text
    job_id = created.json()["id"]

    processed = process_pending_forecast_jobs(db_session, 5)
    assert len(processed) == 1
    assert processed[0].status == "failed"
    assert processed[0].error_message == UNREVIEWED_PUBLICATION
    assert db_session.query(ForecastResult).filter_by(job_id=job_id).all() == []
    listed = client.get("/forecasts", headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json() == {"results": []}

    job = db_session.get(ForecastJob, job_id)
    generated_at = datetime(2026, 11, 15, 16, 0, 0)
    for publish in forecast_publish_paths():
        with pytest.raises(ForecastPublicationRejected, match="unreviewed evaluation"):
            publish(db_session, job=job, payload=_payload(), generated_at=generated_at)
    assert db_session.query(ForecastResult).count() == 0

    db_session.add(_evaluation("AAPL", review_status="approved"))
    db_session.commit()
    published = publish_forecast_result(
        db_session, job=job, payload=_payload(), generated_at=generated_at,
    )
    db_session.commit()
    assert published.symbol == "AAPL"
    assert db_session.query(ForecastResult).count() == 1
