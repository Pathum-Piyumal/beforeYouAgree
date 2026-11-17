from fastapi import APIRouter, Depends, HTTPException, Response

from app.core.security import password_matches
from app.dependencies.auth import CurrentUser, Database, limit_auth_requests
from app.schemas.auth import DeleteAccountRequest, UpdateProfileRequest, UserProfile

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserProfile)
def current_user(user: CurrentUser, response: Response) -> UserProfile:
    response.headers["Cache-Control"] = "no-store"
    return UserProfile.model_validate(user)


@router.patch("/me", response_model=UserProfile)
def update_profile(
    request: UpdateProfileRequest, user: CurrentUser, db: Database, response: Response
) -> UserProfile:
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    user.name = request.name
    db.commit()
    return UserProfile.model_validate(user)


@router.delete("/me", status_code=204, dependencies=[Depends(limit_auth_requests)])
def delete_account(
    request: DeleteAccountRequest, user: CurrentUser, db: Database, response: Response
) -> None:
    """Delete the authenticated account and its owned data in one transaction."""
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    if not password_matches(request.password.get_secret_value(), user.password_hash):
        raise HTTPException(
            status_code=403,
            detail={
                "code": "ACCOUNT_PASSWORD_INCORRECT",
                "message": "Current password is incorrect.",
            },
            headers={"Cache-Control": "no-store"},
        )
    db.delete(user)
    db.commit()
