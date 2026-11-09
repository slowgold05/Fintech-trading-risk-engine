"""Configured forecast models. One model, described from live settings."""

from fastapi.testclient import TestClient

from app.core.config import settings


def test_lists_the_configured_kronos_model(client: TestClient, auth_headers) -> None:
    headers = auth_headers("forecast-models@example.com")
    response = client.get("/forecasts/models", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["models"]) == 1
    model = body["models"][0]
    assert model["id"] == "kronos"
    assert model["model_name"] == settings.forecast_kronos_model_name
    assert model["tokenizer_name"] == settings.forecast_kronos_tokenizer_name
    assert model["enabled"] == settings.forecast_kronos_enabled
    assert model["enabled"] is False
    assert model["max_lookback"] == settings.forecast_kronos_max_lookback
    assert model["max_horizon"] == settings.forecast_kronos_max_horizon
    assert model["max_sample_count"] == settings.forecast_kronos_max_sample_count
    assert model["source_commit"] == "67b630e67f6a18c9e9be918d9b4337c960db1e9a"
    assert model["license"] == "MIT"


def test_enabled_field_reflects_live_settings(
    client: TestClient, auth_headers, monkeypatch
) -> None:
    monkeypatch.setattr(settings, "forecast_kronos_enabled", True)
    headers = auth_headers("forecast-models-enabled@example.com")
    response = client.get("/forecasts/models", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["models"][0]["enabled"] is True


def test_requires_authentication(client: TestClient) -> None:
    response = client.get("/forecasts/models")
    assert response.status_code == 401, response.text
