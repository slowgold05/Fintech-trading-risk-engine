"""Walk-forward evaluation methodology and the read-only evaluation routes."""

from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.forecast_evaluation import ForecastEvaluation
from app.models.market_symbol import MarketSymbol
from app.services.forecast_evaluation import (
    _baseline_last_close,
    _directional_accuracy,
    _mean_absolute_error,
    evaluate_walk_forward_window,
    run_walk_forward_evaluation,
)


def _flat_forecaster(bars, horizon):
    return [bars[-1]["close"]] * horizon


def test_reference_vector_model_and_baseline_metrics():
    reference_close = 99
    actual = [100, 102, 101]
    predicted = [101, 101, 103]
    baseline = _baseline_last_close(reference_close, len(actual))

    assert baseline == [99, 99, 99]
    assert _mean_absolute_error(actual, predicted) == pytest.approx(1.3333, abs=5e-5)
    assert _directional_accuracy(reference_close, actual, predicted) == pytest.approx(0.6667, abs=5e-5)
    assert _mean_absolute_error(actual, baseline) == 2.0
    assert _directional_accuracy(reference_close, actual, baseline) == pytest.approx(0.3333, abs=5e-5)


def test_directional_accuracy_does_not_compound_a_single_wrong_call():
    """Only day 0 is a miss. Later days are judged against the real previous close.

    reference 100
    actual     110, 100, 90, 95
    predicted   90, 105, 80, 92

    Day 0 is down against an up move. Days 1-3 match the actual direction from
    the real previous close. Judging day 1 from the wrong prediction (105 is
    up from 90, while 100 is down from 110) would count a second miss.
    """
    accuracy = _directional_accuracy(100, [110, 100, 90, 95], [90, 105, 80, 92])
    assert accuracy == 0.75


def test_evaluate_walk_forward_window_never_shows_the_forecaster_future_bars():
    history = [
        {"session_date": "2024-01-02", "close": 10.0},
        {"session_date": "2024-01-03", "close": 11.0},
        {"session_date": "2024-01-04", "close": 12.0},
        {"session_date": "2024-01-05", "close": 13.0},
        {"session_date": "2024-01-08", "close": 14.0},
    ]
    seen = {}

    def forecaster(bars, horizon):
        seen["bars"] = list(bars)
        seen["horizon"] = horizon
        return [bars[-1]["close"]] * horizon

    cutoff_index = 3
    horizon = 2
    result = evaluate_walk_forward_window(history, cutoff_index, horizon, forecaster)

    assert seen["horizon"] == horizon
    assert seen["bars"] == history[:cutoff_index]
    future_dates = {bar["session_date"] for bar in history[cutoff_index:]}
    assert future_dates.isdisjoint(bar["session_date"] for bar in seen["bars"])
    assert result["cutoff_date"] == "2024-01-04"


def test_run_walk_forward_evaluation_windows_never_overlap():
    horizon = 3
    dates = [f"2024-01-{day:02d}" for day in range(1, 11)]
    history = [
        {"session_date": day, "close": float(index + 1)}
        for index, day in enumerate(dates)
    ]

    result = run_walk_forward_evaluation(
        history, horizon=horizon, window_count=3, forecaster=_flat_forecaster,
    )

    indexes = [dates.index(window["cutoff_date"]) for window in result["windows"]]
    assert indexes == [6, 3, 0]
    assert all(left - right == horizon for left, right in zip(indexes, indexes[1:]))
    futures = [set(dates[index + 1:index + 1 + horizon]) for index in indexes]
    assert futures[0].isdisjoint(futures[1])
    assert futures[1].isdisjoint(futures[2])


def test_run_walk_forward_evaluation_rejects_insufficient_history():
    history = [
        {"session_date": f"2024-01-{day:02d}", "close": float(day)}
        for day in range(1, 5)
    ]
    with pytest.raises(ValueError, match="insufficient"):
        run_walk_forward_evaluation(
            history, horizon=2, window_count=2, forecaster=_flat_forecaster,
        )


def test_run_walk_forward_evaluation_averages_correctly():
    """Two windows with different errors. The report is their plain mean.

    Closes are 10, 20, 40, 30, 50. Horizon is 2, so the cutoffs are index 3
    (reference 40, actual 30 then 50) and index 1 (reference 10, actual 20
    then 40). The forecaster predicts last close + 1.
    """
    history = [
        {"session_date": "2024-01-02", "close": 10.0},
        {"session_date": "2024-01-03", "close": 20.0},
        {"session_date": "2024-01-04", "close": 40.0},
        {"session_date": "2024-01-05", "close": 30.0},
        {"session_date": "2024-01-08", "close": 50.0},
    ]

    def forecaster(bars, horizon):
        return [bars[-1]["close"] + 1.0] * horizon

    first = evaluate_walk_forward_window(history, 3, 2, forecaster)
    second = evaluate_walk_forward_window(history, 1, 2, forecaster)
    result = run_walk_forward_evaluation(
        history, horizon=2, window_count=2, forecaster=forecaster,
    )

    assert result["windows"] == [first, second]
    assert result["window_count"] == 2
    assert result["horizon"] == 2
    assert first["model_mae"] == 10.0
    assert second["model_mae"] == 19.0
    assert result["model_mae"] == (first["model_mae"] + second["model_mae"]) / 2
    assert result["model_directional_accuracy"] == (
        first["model_directional_accuracy"] + second["model_directional_accuracy"]
    ) / 2
    assert result["baseline_mae"] == (first["baseline_mae"] + second["baseline_mae"]) / 2
    assert result["baseline_directional_accuracy"] == (
        first["baseline_directional_accuracy"] + second["baseline_directional_accuracy"]
    ) / 2
    assert result["model_mae"] == 14.5
    assert result["model_directional_accuracy"] == 0.5
    assert result["baseline_mae"] == 15.0
    assert result["baseline_directional_accuracy"] == 0.25


def _insert_evaluation(db: Session) -> ForecastEvaluation:
    db.add(MarketSymbol(symbol="AAPL", company_name="Apple", exchange="NASDAQ", is_active=True))
    row = ForecastEvaluation(
        symbol="AAPL",
        provider="yahoo",
        adjustment_type="raw",
        horizon=3,
        window_count=2,
        model_mae=1.5,
        model_directional_accuracy=0.5,
        baseline_type="last_observed_close",
        baseline_mae=2.0,
        baseline_directional_accuracy=0.25,
        weights_exercised=False,
        notes="Shape check only. Weights were not exercised.",
        created_at=datetime(2026, 11, 9, 15, 4, 5),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_list_evaluations_is_visible_to_any_authenticated_user(
    client: TestClient, auth_headers, db_session: Session,
):
    row = _insert_evaluation(db_session)
    first = auth_headers("eval-reader-a@example.com")
    second = auth_headers("eval-reader-b@example.com")

    seen_by_first = client.get("/forecasts/evaluations", headers=first)
    seen_by_second = client.get("/forecasts/evaluations", headers=second)

    assert seen_by_first.status_code == 200, seen_by_first.text
    assert seen_by_second.status_code == 200, seen_by_second.text
    first_rows = seen_by_first.json()["evaluations"]
    second_rows = seen_by_second.json()["evaluations"]
    assert len(first_rows) == 1
    assert len(second_rows) == 1
    assert first_rows[0]["id"] == second_rows[0]["id"] == row.id
    assert first_rows[0]["weights_exercised"] is False
    assert second_rows[0]["notes"] == "Shape check only. Weights were not exercised."


def test_get_evaluation_by_id(client: TestClient, auth_headers, db_session: Session):
    row = _insert_evaluation(db_session)
    headers = auth_headers("eval-detail@example.com")

    response = client.get(f"/forecasts/evaluations/{row.id}", headers=headers)

    assert response.status_code == 200, response.text
    assert response.json() == {
        "id": row.id,
        "symbol": "AAPL",
        "provider": "yahoo",
        "adjustment_type": "raw",
        "horizon": 3,
        "window_count": 2,
        "model_mae": 1.5,
        "model_directional_accuracy": 0.5,
        "baseline_type": "last_observed_close",
        "baseline_mae": 2.0,
        "baseline_directional_accuracy": 0.25,
        "weights_exercised": False,
        "notes": "Shape check only. Weights were not exercised.",
        "created_at": "2026-11-09T15:04:05Z",
    }


def test_get_missing_evaluation_returns_404(client: TestClient, auth_headers):
    headers = auth_headers("eval-missing@example.com")
    response = client.get("/forecasts/evaluations/999999", headers=headers)
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == "Forecast evaluation not found"


def test_requires_authentication(client: TestClient):
    listing = client.get("/forecasts/evaluations")
    detail = client.get("/forecasts/evaluations/1")
    assert listing.status_code == 401, listing.text
    assert detail.status_code == 401, detail.text
