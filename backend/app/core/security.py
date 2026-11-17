from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models import RefreshSession, User
from app.schemas.auth import TokenResponse, UserProfile

password_hasher = PasswordHasher()
# Verify a dummy hash for unknown accounts to avoid a fast account-existence path.
dummy_password_hash = password_hasher.hash(secrets.token_urlsafe(32))
TOKEN_ISSUER = "before-you-agree"
TOKEN_AUDIENCE = "before-you-agree-api"


def password_matches(password: str, password_hash: str) -> bool:
    try:
        return password_hasher.verify(password_hash, password)
    except (InvalidHashError, VerificationError):
        return False


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def issue_tokens(db: Session, user: User) -> TokenResponse:
    now = datetime.now(UTC)
    refresh_token = secrets.token_urlsafe(48)
    session = RefreshSession(
        user_id=user.id,
        token_hash=hash_refresh_token(refresh_token),
        expires_at=now + timedelta(days=settings.refresh_token_expire_days),
    )
    db.add(session)
    db.flush()
    expires_in = settings.access_token_expire_minutes * 60
    access_token = jwt.encode(
        {
            "sub": str(user.id),
            "sid": str(session.id),
            "jti": str(uuid4()),
            "iss": TOKEN_ISSUER,
            "aud": TOKEN_AUDIENCE,
            "type": "access",
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
        },
        settings.jwt_secret,
        algorithm="HS256",
    )
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=expires_in,
        user=UserProfile.model_validate(user),
    )
