from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import Settings, settings
from app.core.security import hash_refresh_token, password_hasher
from app.dependencies.auth import AuthRateLimiter
from app.models import RefreshSession, User

ACCOUNT = {
    "email": "Person@example.com",
    "password": "correct horse battery staple",
    "name": "Person",
}


def register(client):
    response = client.post("/api/v1/auth/register", json=ACCOUNT)
    assert response.status_code == 201, response.text
    return response.json()


def bearer(tokens):
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def test_register_login_and_profile(auth_client):
    client, factory = auth_client
    tokens = register(client)
    assert tokens["expires_in"] == settings.access_token_expire_minutes * 60
    assert tokens["user"]["email"] == "person@example.com"
    assert set(tokens["user"]) == {"id", "name", "email"}
    profile = client.get("/api/v1/users/me", headers=bearer(tokens))
    assert profile.status_code == 200
    assert profile.json() == tokens["user"]
    assert profile.headers["Cache-Control"] == "no-store"
    with factory() as db:
        user = db.scalar(select(User))
        assert user.password_hash.startswith("$argon2id$")
        assert password_hasher.verify(user.password_hash, ACCOUNT["password"])
        session = db.scalar(select(RefreshSession))
        assert session.token_hash == hash_refresh_token(tokens["refresh_token"])
        assert tokens["refresh_token"] not in session.token_hash
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "PERSON@example.com",
            "password": ACCOUNT["password"],
        },
    )
    assert login.status_code == 200
    assert login.headers["Cache-Control"] == "no-store"
    assert login.json()["refresh_token"] != tokens["refresh_token"]


def test_duplicate_email_is_case_insensitive(auth_client):
    client, factory = auth_client
    register(client)
    duplicate = client.post(
        "/api/v1/auth/register", json={**ACCOUNT, "email": "PERSON@example.com"}
    )
    assert duplicate.status_code == 409
    with factory() as db:
        assert len(db.scalars(select(User)).all()) == 1
        assert len(db.scalars(select(RefreshSession)).all()) == 1


@pytest.mark.parametrize(
    "changes",
    [
        {"password": "short"},
        {"password": "x" * 129},
        {"name": "   "},
        {"email": "invalid"},
        {"extra": True},
    ],
)
def test_invalid_registration(auth_client, changes):
    client, _ = auth_client
    response = client.post("/api/v1/auth/register", json={**ACCOUNT, **changes})
    assert response.status_code == 422
    assert ACCOUNT["password"] not in response.text


def test_wrong_password_and_unknown_account_have_same_response(auth_client):
    client, _ = auth_client
    register(client)
    wrong = client.post(
        "/api/v1/auth/login",
        json={
            "email": ACCOUNT["email"],
            "password": "wrong password value",
        },
    )
    unknown = client.post(
        "/api/v1/auth/login",
        json={
            "email": "unknown@example.com",
            "password": "wrong password value",
        },
    )
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["error"]["message"] == unknown.json()["error"]["message"]
    assert wrong.headers["WWW-Authenticate"] == "Bearer"


def test_refresh_rotates_and_rejects_reuse(auth_client):
    client, _ = auth_client
    original = register(client)
    refreshed = client.post(
        "/api/v1/auth/refresh", json={"refresh_token": original["refresh_token"]}
    )
    assert refreshed.status_code == 200
    rotated = refreshed.json()
    assert rotated["refresh_token"] != original["refresh_token"]
    assert client.get("/api/v1/users/me", headers=bearer(original)).status_code == 401
    assert client.get("/api/v1/users/me", headers=bearer(rotated)).status_code == 200
    replay = client.post("/api/v1/auth/refresh", json={"refresh_token": original["refresh_token"]})
    assert replay.status_code == 401


def test_logout_revokes_only_its_session_and_is_idempotent(auth_client):
    client, _ = auth_client
    first = register(client)
    second = client.post(
        "/api/v1/auth/login",
        json={
            "email": ACCOUNT["email"],
            "password": ACCOUNT["password"],
        },
    ).json()
    payload = {"refresh_token": first["refresh_token"]}
    for _ in range(2):
        response = client.post("/api/v1/auth/logout", json=payload)
        assert response.status_code == 204
        assert response.content == b""
    assert client.get("/api/v1/users/me", headers=bearer(first)).status_code == 401
    assert client.post("/api/v1/auth/refresh", json=payload).status_code == 401
    assert client.get("/api/v1/users/me", headers=bearer(second)).status_code == 200


def test_concurrent_refresh_only_issues_one_replacement(auth_client):
    client, factory = auth_client
    tokens = register(client)

    def refresh_once(_):
        return client.post(
            "/api/v1/auth/refresh",
            json={
                "refresh_token": tokens["refresh_token"],
            },
        ).status_code

    with ThreadPoolExecutor(max_workers=2) as executor:
        assert sorted(executor.map(refresh_once, range(2))) == [200, 401]
    with factory() as db:
        sessions = db.scalars(select(RefreshSession)).all()
        assert len(sessions) == 2
        assert sum(session.revoked_at is None for session in sessions) == 1


@pytest.mark.parametrize("algorithm", ["none", "HS512"])
def test_rejects_unapproved_signing_algorithms(auth_client, algorithm):
    client, _ = auth_client
    tokens = register(client)
    claims = jwt.decode(tokens["access_token"], options={"verify_signature": False})
    token = jwt.encode(
        claims,
        None if algorithm == "none" else settings.jwt_secret,
        algorithm=algorithm,
    )
    response = client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


def test_expired_refresh_session_rejects_access_and_refresh(auth_client):
    client, factory = auth_client
    tokens = register(client)
    with factory.begin() as db:
        db.scalar(select(RefreshSession)).expires_at = datetime.now(UTC) - timedelta(seconds=1)
    assert client.get("/api/v1/users/me", headers=bearer(tokens)).status_code == 401
    assert (
        client.post(
            "/api/v1/auth/refresh",
            json={
                "refresh_token": tokens["refresh_token"],
            },
        ).status_code
        == 401
    )


@pytest.mark.parametrize(
    "change",
    [
        {"exp": 1},
        {"aud": "another-api"},
        {"iss": "another-issuer"},
        {"type": "refresh"},
        {"sub": str(uuid4())},
        {"sid": str(uuid4())},
        {"sid": "invalid-uuid"},
        {"sid": None},
        {"exp": None},
        {"iat": None},
    ],
)
def test_invalid_access_claims(auth_client, change):
    client, _ = auth_client
    tokens = register(client)
    claims = jwt.decode(tokens["access_token"], options={"verify_signature": False})
    claims.update(change)
    token = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    assert (
        client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"}).status_code
        == 401
    )


def test_missing_and_tampered_tokens(auth_client):
    client, _ = auth_client
    tokens = register(client)
    for token in ["malformed", tokens["refresh_token"], tokens["access_token"] + "tampered"]:
        assert (
            client.get("/api/v1/users/me", headers={"Authorization": f"Bearer {token}"}).status_code
            == 401
        )
    assert client.get("/api/v1/users/me").status_code == 401
    claims = {"sub": str(uuid4()), "exp": datetime.now(UTC) + timedelta(minutes=1)}
    missing_claims = jwt.encode(claims, settings.jwt_secret, algorithm="HS256")
    assert (
        client.get(
            "/api/v1/users/me",
            headers={
                "Authorization": f"Bearer {missing_claims}",
            },
        ).status_code
        == 401
    )


def test_auth_attempts_are_rate_limited(auth_client, monkeypatch):
    client, _ = auth_client
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 2)
    payload = {"email": "unknown@example.com", "password": "wrong password value"}
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    response = client.post("/api/v1/auth/login", json=payload)
    assert response.status_code == 429
    assert response.headers["Retry-After"] == "60"


def test_rate_limit_window_expires(monkeypatch):
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 1)
    clock = [0.0]
    monkeypatch.setattr("app.dependencies.auth.monotonic", lambda: clock[0])
    limiter = AuthRateLimiter()
    limiter.check("client")
    clock[0] = 61.0
    limiter.check("client")
    assert list(limiter.attempts["client"]) == [61.0]


def test_non_development_settings_require_signing_secret():
    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            app_environment="production",
            jwt_secret="development-only-change-me",
        )
    with pytest.raises(ValidationError):
        Settings(_env_file=None, jwt_algorithm="none")
    configured = Settings(
        _env_file=None,
        app_environment="production",
        jwt_secret="unique-production-secret" * 3,
    )
    assert configured.jwt_algorithm == "HS256"
