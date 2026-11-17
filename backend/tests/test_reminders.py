from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta, timezone
from uuid import UUID, uuid4

from app.models import Reminder
from app.services.reminders import promote_due
from tests.test_auth import ACCOUNT, bearer, register
from tests.test_history import save


def setup_reminder(client):
    tokens = register(client)
    save(client, tokens)
    commitments = client.get("/api/v1/commitments", headers=bearer(tokens))
    assert commitments.status_code == 200
    commitment = commitments.json()["items"][0]
    now = datetime.now(UTC)
    body = {
        "commitment_id": commitment["id"],
        "idempotency_key": str(uuid4()),
        "remind_at": (now + timedelta(days=1)).isoformat(),
        "event_at": (now + timedelta(days=2)).isoformat(),
        "timezone": "Asia/Colombo",
        "event_description": "Review the trial charge",
        "confirmed": True,
    }
    return tokens, body


def test_reminder_lifecycle_and_retry_safe_due_delivery(auth_client):
    client, factory = auth_client
    tokens, body = setup_reminder(client)
    created = client.post("/api/v1/reminders", headers=bearer(tokens), json=body)
    assert created.status_code == 201, created.text
    item = created.json()
    path = f"/api/v1/reminders/{item['id']}"
    repeated = client.post("/api/v1/reminders", headers=bearer(tokens), json=body)
    assert repeated.json()["id"] == item["id"]
    assert client.post(path + "/acknowledge", headers=bearer(tokens)).status_code == 409
    changed = {
        key: value for key, value in body.items() if key not in {"commitment_id", "idempotency_key"}
    }
    changed["event_description"] = "Updated note"
    assert client.patch(path, headers=bearer(tokens), json=changed).status_code == 200
    with factory.begin() as db:
        reminder = db.get(Reminder, UUID(item["id"]))
        reminder.remind_at = datetime.now(UTC) - timedelta(minutes=1)

    def tick():
        with factory() as db:
            return promote_due(db)

    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sum(pool.map(lambda _: tick(), range(2))) == 1
    due = client.get("/api/v1/reminders", headers=bearer(tokens)).json()["items"][0]
    assert due["status"] == "due"
    assert due["sent_at"] is None
    acknowledged = client.post(path + "/acknowledge", headers=bearer(tokens)).json()
    assert acknowledged["status"] == "acknowledged"
    assert acknowledged["sent_at"]
    assert client.post(path + "/acknowledge", headers=bearer(tokens)).json() == acknowledged
    assert client.delete(path, headers=bearer(tokens)).status_code == 204
    assert client.delete(path, headers=bearer(tokens)).status_code == 204
    assert client.patch(path, headers=bearer(tokens), json=changed).status_code == 409


def test_reminder_ownership_and_validation(auth_client):
    client, _ = auth_client
    tokens, body = setup_reminder(client)
    item = client.post("/api/v1/reminders", headers=bearer(tokens), json=body).json()
    other = client.post("/api/v1/auth/register", json={**ACCOUNT, "email": "other@example.com"})
    other_tokens = other.json()
    assert client.get("/api/v1/commitments", headers=bearer(other_tokens)).json()["total"] == 0
    assert client.get("/api/v1/reminders", headers=bearer(other_tokens)).json()["total"] == 0
    assert (
        client.post("/api/v1/reminders", headers=bearer(other_tokens), json=body).status_code == 404
    )
    path = f"/api/v1/reminders/{item['id']}"
    assert client.delete(path, headers=bearer(other_tokens)).status_code == 404
    assert client.post(path + "/acknowledge", headers=bearer(other_tokens)).status_code == 404
    assert client.get("/api/v1/reminders").status_code == 401
    for change in [
        {"confirmed": False},
        {"timezone": "Invalid/Zone"},
        {"event_description": " "},
        {"remind_at": "2020-01-01T00:00:00"},
        {"remind_at": body["event_at"]},
        {"event_at": "2020-01-01T00:00:00Z"},
    ]:
        request = {**body, "idempotency_key": str(uuid4()), **change}
        response = client.post("/api/v1/reminders", headers=bearer(tokens), json=request)
        assert response.status_code == 422, response.text
    conflict = client.post(
        "/api/v1/reminders", headers=bearer(tokens), json={**body, "event_description": "different"}
    )
    assert conflict.status_code == 409


def test_account_reminder_offsets_are_normalized_before_storage(auth_client):
    client, _ = auth_client
    tokens, body = setup_reminder(client)
    expected = datetime.fromisoformat(body["remind_at"])
    zone = timezone(timedelta(hours=5, minutes=30))
    for key in ["remind_at", "event_at"]:
        body[key] = datetime.fromisoformat(body[key]).astimezone(zone).isoformat()
    response = client.post("/api/v1/reminders", headers=bearer(tokens), json=body)
    assert response.status_code == 201, response.text
    assert datetime.fromisoformat(response.json()["remind_at"]) == expected
    saved = client.get("/api/v1/reminders", headers=bearer(tokens)).json()["items"][0]
    assert datetime.fromisoformat(saved["remind_at"]) == expected
