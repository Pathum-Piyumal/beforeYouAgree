from datetime import UTC, datetime
from uuid import UUID

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models import Analysis, Commitment, Finding, RefreshSession, Reminder, User
from tests.test_auth import ACCOUNT, bearer, register
from tests.test_history import save


def delete_account(client, tokens=None, body=None):
    return client.request(
        "DELETE",
        "/api/v1/users/me",
        headers=bearer(tokens) if tokens else {},
        json=body if body is not None else {"password": ACCOUNT["password"]},
    )


def test_delete_account_cascades_and_revokes_all_sessions_without_affecting_other_user(auth_client):
    client, factory = auth_client
    tokens = register(client)
    report = save(client, tokens)
    second_login = client.post(
        "/api/v1/auth/login",
        json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]},
    ).json()
    other_response = client.post(
        "/api/v1/auth/register", json={**ACCOUNT, "email": "other@example.com"}
    )
    assert other_response.status_code == 201
    other = other_response.json()
    other_report = save(client, other)
    # Both owners have a full graph, including reminders and multiple sessions.
    with factory.begin() as db:
        for user_tokens, saved in [(tokens, report), (other, other_report)]:
            commitment = db.scalar(
                select(Commitment).where(Commitment.analysis_id == UUID(saved["analysis_id"]))
            )
            db.add(
                Reminder(
                    user_id=UUID(user_tokens["user"]["id"]),
                    commitment_id=commitment.id,
                    remind_at=datetime(2030, 1, 1, tzinfo=UTC),
                )
            )
    # Capture every other user's record, so cascading checks cannot pass by deleting all data.
    models = [User, Analysis, Finding, Commitment, Reminder, RefreshSession]
    with factory() as db:
        other_ids = {
            model: {row.id for row in db.scalars(select(model))}
            for model in models
        }
        for model in models:
            if model in [Finding, Commitment]:
                owned = select(model).where(model.analysis_id == UUID(report["analysis_id"]))
            elif model is User:
                owned = select(model).where(model.id == UUID(tokens["user"]["id"]))
            else:
                owned = select(model).where(model.user_id == UUID(tokens["user"]["id"]))
            other_ids[model] -= {row.id for row in db.scalars(owned)}
            assert other_ids[model]

    response = delete_account(client, tokens)
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert response.headers["Cache-Control"] == "no-store"
    with factory() as db:
        for model in models:
            assert {row.id for row in db.scalars(select(model))} == other_ids[model]
    for session in [tokens, second_login]:
        assert client.get("/api/v1/users/me", headers=bearer(session)).status_code == 401
        assert client.post(
            "/api/v1/auth/refresh", json={"refresh_token": session["refresh_token"]}
        ).status_code == 401
    assert delete_account(client, tokens).status_code == 401
    assert client.post(
        "/api/v1/auth/login",
        json={"email": ACCOUNT["email"], "password": ACCOUNT["password"]},
    ).status_code == 401
    assert client.get("/api/v1/users/me", headers=bearer(other)).status_code == 200
    assert client.get(
        f"/api/v1/analyses/{other_report['analysis_id']}", headers=bearer(other)
    ).status_code == 200


def test_deletion_requires_session_and_current_password(auth_client):
    client, _ = auth_client
    tokens = register(client)
    report = save(client, tokens)
    assert delete_account(client).status_code == 401
    response = delete_account(client, tokens, {"password": "incorrect password"})
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "ACCOUNT_PASSWORD_INCORRECT"
    assert "incorrect password" not in response.text
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).status_code == 200
    assert client.get(
        f"/api/v1/analyses/{report['analysis_id']}", headers=bearer(tokens)
    ).status_code == 200


@pytest.mark.parametrize("body", [
    {}, {"password": "short"}, {"password": "x" * 129}, {"password": None},
    {"password": ACCOUNT["password"], "user_id": "another-user"},
])
def test_invalid_deletion_request_does_not_delete_account(auth_client, body):
    client, _ = auth_client
    tokens = register(client)
    response = delete_account(client, tokens, body)
    assert response.status_code == 422
    assert ACCOUNT["password"] not in response.text
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).status_code == 200


def test_deletion_attempts_are_rate_limited(auth_client, monkeypatch):
    client, _ = auth_client
    tokens = register(client)
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 2)
    assert delete_account(client, tokens, {"password": "incorrect password"}).status_code == 403
    limited = delete_account(client, tokens)
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "60"
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).status_code == 200


def test_update_display_name_is_owner_scoped_and_preserves_sessions(auth_client):
    client, factory = auth_client
    tokens = register(client)
    other_response = client.post(
        "/api/v1/auth/register", json={**ACCOUNT, "email": "other@example.com", "name": "Other"}
    )
    assert other_response.status_code == 201
    other = other_response.json()
    response = client.patch(
        "/api/v1/users/me", headers=bearer(tokens), json={"name": "  Renée Updated  "}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {**tokens["user"], "name": "Renée Updated"}
    assert response.headers["Cache-Control"] == "no-store"
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).json() == response.json()
    assert client.get("/api/v1/users/me", headers=bearer(other)).json() == other["user"]
    with factory() as db:
        assert db.get(User, UUID(tokens["user"]["id"])).name == "Renée Updated"
        assert len(db.scalars(select(RefreshSession)).all()) == 2
    refreshed = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert refreshed.status_code == 200
    assert refreshed.json()["user"] == response.json()


@pytest.mark.parametrize("body", [
    {}, {"name": ""}, {"name": " \t\n "}, {"name": "x" * 121}, {"name": None},
    {"name": 123}, {"name": "Updated", "user_id": "other-user"},
    {"name": "Updated", "email": "changed@example.com"},
    {"name": "Updated", "password": "replacement-password"},
])
def test_invalid_profile_update_preserves_account(auth_client, body):
    client, _ = auth_client
    tokens = register(client)
    response = client.patch("/api/v1/users/me", headers=bearer(tokens), json=body)
    assert response.status_code == 422
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).json() == tokens["user"]


def test_profile_update_requires_authentication(auth_client):
    client, _ = auth_client
    tokens = register(client)
    assert client.patch("/api/v1/users/me", json={"name": "Updated"}).status_code == 401
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).json() == tokens["user"]
