from app.core.config import settings
from tests.test_history import request_body


def test_oversized_request_is_rejected_before_parsing(auth_client):
    client, _ = auth_client
    response = client.post(
        "/api/v1/analyses", content=b"x" * 1_000_001, headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "REQUEST_TOO_LARGE"


def test_duplicate_sections_and_credential_urls_are_rejected(auth_client):
    client, _ = auth_client
    body = request_body()
    body["sections"] *= 2
    assert client.post("/api/v1/analyses", json=body).status_code == 422
    body = request_body()
    body["source_url"] = "https://private:password@example.test/terms"
    assert client.post("/api/v1/analyses", json=body).status_code == 422


def test_analysis_endpoint_is_rate_limited(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(settings, "analysis_rate_limit_per_minute", 1)
    assert client.post("/api/v1/analyses", json=request_body()).status_code == 200
    limited = client.post("/api/v1/analyses", json=request_body())
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"
