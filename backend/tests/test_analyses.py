from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_mock_analysis_returns_source_linked_finding_and_timeline() -> None:
    response = client.post(
        "/api/v1/analyses",
        json={
            "source_url": "https://example.test/trial",
            "sections": [
                {
                    "section_id": "pricing-1",
                    "heading": "Trial terms",
                    "text": "7-day free trial. After the trial, $49.99 per month will be charged automatically until cancellation.",
                    "source_url": "https://example.test/trial",
                }
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["score_version"] == "mock-v1"
    assert body["findings"][0]["evidence"]["section_id"] == "pricing-1"
    assert "$49.99" in body["findings"][0]["evidence"]["quote"]
    assert body["timeline"][0]["offset_days"] == 7


def test_analysis_rejects_insufficient_content_with_standard_error_shape() -> None:
    response = client.post(
        "/api/v1/analyses",
        json={
            "source_url": "https://example.test",
            "sections": [
                {
                    "section_id": "empty",
                    "text": "too short",
                    "source_url": "https://example.test",
                }
            ],
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INSUFFICIENT_CONTENT"
