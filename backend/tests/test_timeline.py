from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _analyze(text: str) -> dict[str, object]:
    response = client.post(
        "/api/v1/analyses",
        json={
            "source_url": "https://example.test/terms",
            "sections": [
                {
                    "section_id": "terms-1",
                    "heading": "Subscription terms",
                    "text": text,
                    "source_url": "https://example.test/terms",
                }
            ],
        },
    )
    assert response.status_code == 200
    return response.json()


def test_timeline_links_trial_charge_and_cancellation_notice_to_evidence() -> None:
    body = _analyze(
        "Start a 7-day free trial. After the trial, $49.99 per month will be charged "
        "automatically. Cancel at least 3 days before renewal."
    )
    timeline = {item["kind"]: item for item in body["timeline"]}

    trial = timeline["trial_ends"]
    assert trial["timing"] == "relative"
    assert trial["relative_to"] == "signup"
    assert trial["offset_direction"] == "after"
    assert trial["offset_days"] == 7
    assert trial["date"] is None
    assert trial["source_section_id"] == "terms-1"
    assert trial["assumptions"]

    charge = timeline["recurring_charge"]
    assert charge["timing"] == "recurring"
    assert charge["amount"] == "49.99"
    assert charge["currency"] == "USD"
    assert charge["recurrence"] == "monthly"
    assert charge["source_risk_types"] == ["automatic_renewal"]

    deadline = timeline["cancellation_deadline"]
    assert deadline["timing"] == "relative"
    assert deadline["relative_to"] == "renewal"
    assert deadline["offset_direction"] == "before"
    assert deadline["offset_days"] == 3
    assert deadline["source_risk_types"] == ["cancellation_deadline"]

    assert "7-day trial" in body["findings"][0]["consequence"]


def test_absolute_cancellation_date_preserves_timezone_without_date_math() -> None:
    body = _analyze(
        "The subscription renews automatically. Cancel by 2027-04-03 at 23:59 UTC."
    )
    deadline = next(item for item in body["timeline"] if item["kind"] == "cancellation_deadline")

    assert deadline["timing"] == "absolute"
    assert deadline["status"] == "resolved"
    assert deadline["date"] == "2027-04-03"
    assert deadline["timezone"] == "UTC"
    assert deadline["source_section_id"] == "terms-1"


def test_ambiguous_cancellation_date_remains_unresolved() -> None:
    body = _analyze(
        "The subscription renews automatically. Cancel by 03/04/2027 to avoid the next charge."
    )
    deadline = next(item for item in body["timeline"] if item["kind"] == "cancellation_deadline")

    assert deadline["timing"] == "unresolved"
    assert deadline["status"] == "unresolved"
    assert deadline["date"] is None
    assert "ambiguous" in deadline["unresolved_reason"].lower()
