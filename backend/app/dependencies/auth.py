from __future__ import annotations

from collections import OrderedDict, deque
from datetime import UTC, datetime
from threading import Lock
from time import monotonic
from typing import Annotated
from uuid import UUID

import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import TOKEN_AUDIENCE, TOKEN_ISSUER
from app.db.session import get_db
from app.models import RefreshSession, User


def unauthorized() -> HTTPException:
    return HTTPException(
        status_code=401,
        detail={"code": "UNAUTHORIZED", "message": "Invalid or expired credentials"},
        headers={"WWW-Authenticate": "Bearer"},
    )


class AuthRateLimiter:
    """Bounded, process-local limit. Multi-worker deployments also need an edge limit."""

    def __init__(self) -> None:
        self.attempts: OrderedDict[str, deque[float]] = OrderedDict()
        self.lock = Lock()

    def check(self, key: str, limit: int | None = None) -> None:
        now = monotonic()
        with self.lock:
            while self.attempts and next(iter(self.attempts.values()))[-1] <= now - 60:
                self.attempts.popitem(last=False)
            attempts = self.attempts.get(key)
            if attempts is None:
                if len(self.attempts) >= 10_000:
                    raise self.limited()
                attempts = self.attempts[key] = deque()
            while attempts and attempts[0] <= now - 60:
                attempts.popleft()
            if len(attempts) >= (
                limit if limit is not None else settings.auth_rate_limit_per_minute
            ):
                raise self.limited()
            attempts.append(now)
            self.attempts.move_to_end(key)

    @staticmethod
    def limited() -> HTTPException:
        return HTTPException(
            status_code=429,
            detail={"code": "AUTH_RATE_LIMITED", "message": "Too many attempts. Try again later."},
            headers={"Retry-After": "60"},
        )


auth_limiter = AuthRateLimiter()
analysis_limiter = AuthRateLimiter()


def limit_auth_requests(request: Request) -> None:
    auth_limiter.check(request.client.host if request.client else "unknown")


def limit_analysis_requests(request: Request) -> None:
    try:
        analysis_limiter.check(
            request.client.host if request.client else "unknown",
            settings.analysis_rate_limit_per_minute,
        )
    except HTTPException as error:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "ANALYSIS_RATE_LIMITED",
                "message": "Too many analyses. Try again in a minute.",
            },
            headers={"Retry-After": "60"},
        ) from error


bearer = HTTPBearer(auto_error=False)
Database = Annotated[Session, Depends(get_db)]


def get_current_user(
    db: Database,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> User:
    if credentials is None:
        raise unauthorized()
    try:
        claims = jwt.decode(
            credentials.credentials,
            settings.jwt_secret,
            algorithms=["HS256"],
            audience=TOKEN_AUDIENCE,
            issuer=TOKEN_ISSUER,
            options={"require": ["sub", "sid", "jti", "iss", "aud", "iat", "exp", "type"]},
        )
        if claims["type"] != "access":
            raise unauthorized()
        user_id, session_id = UUID(claims["sub"]), UUID(claims["sid"])
    except (jwt.InvalidTokenError, ValueError, TypeError, AttributeError) as error:
        raise unauthorized() from error
    session = db.scalar(
        select(RefreshSession).where(
            RefreshSession.id == session_id,
            RefreshSession.user_id == user_id,
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > datetime.now(UTC),
        )
    )
    user = db.get(User, user_id) if session else None
    if user is None:
        raise unauthorized()
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
