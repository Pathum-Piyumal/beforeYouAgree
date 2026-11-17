from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.core.security import (
    dummy_password_hash,
    hash_refresh_token,
    issue_tokens,
    password_hasher,
    password_matches,
)
from app.dependencies.auth import Database, limit_auth_requests, unauthorized
from app.models import RefreshSession, User
from app.schemas.auth import Credentials, RefreshRequest, RegisterRequest, TokenResponse

router = APIRouter(
    prefix="/auth",
    tags=["auth"],
    dependencies=[Depends(limit_auth_requests)],
)


def no_store(response: Response) -> None:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(request: RegisterRequest, db: Database, response: Response) -> TokenResponse:
    no_store(response)
    user = User(
        name=request.name,
        email=str(request.email),
        password_hash=password_hasher.hash(request.password.get_secret_value()),
    )
    db.add(user)
    try:
        db.flush()
        tokens = issue_tokens(db, user)
        db.commit()
    except IntegrityError as error:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail={"code": "REGISTRATION_FAILED", "message": "Unable to register this account"},
        ) from error
    return tokens


@router.post("/login", response_model=TokenResponse)
def login(request: Credentials, db: Database, response: Response) -> TokenResponse:
    no_store(response)
    user = db.scalar(select(User).where(User.email == str(request.email)))
    password = request.password.get_secret_value()
    valid = password_matches(password, user.password_hash if user else dummy_password_hash)
    if not valid or user is None:
        raise unauthorized()
    if password_hasher.check_needs_rehash(user.password_hash):
        user.password_hash = password_hasher.hash(password)
    tokens = issue_tokens(db, user)
    db.commit()
    return tokens


@router.post("/refresh", response_model=TokenResponse)
def refresh(request: RefreshRequest, db: Database, response: Response) -> TokenResponse:
    no_store(response)
    now = datetime.now(UTC)
    # Claim the token with one conditional UPDATE. Concurrent attempts cannot both rotate it.
    user_id = db.scalar(
        update(RefreshSession)
        .where(
            RefreshSession.token_hash
            == hash_refresh_token(request.refresh_token.get_secret_value()),
            RefreshSession.revoked_at.is_(None),
            RefreshSession.expires_at > now,
        )
        .values(revoked_at=now)
        .returning(RefreshSession.user_id)
    )
    if user_id is None:
        db.rollback()
        raise unauthorized()
    user = db.get(User, user_id)
    if user is None:
        db.rollback()
        raise unauthorized()
    tokens = issue_tokens(db, user)
    db.commit()
    return tokens


@router.post("/logout", status_code=204)
def logout(request: RefreshRequest, db: Database, response: Response) -> None:
    no_store(response)
    db.execute(
        update(RefreshSession)
        .where(
            RefreshSession.token_hash
            == hash_refresh_token(request.refresh_token.get_secret_value()),
            RefreshSession.revoked_at.is_(None),
        )
        .values(revoked_at=datetime.now(UTC))
    )
    db.commit()
