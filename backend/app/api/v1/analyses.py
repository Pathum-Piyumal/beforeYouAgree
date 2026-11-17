from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.security import HTTPAuthorizationCredentials

from app.dependencies.auth import (
    Database,
    bearer,
    get_current_user,
    limit_analysis_requests,
    unauthorized,
)
from app.schemas.analysis import AnalysisRequest, AnalysisResponse
from app.services.analysis import (
    AnalysisProviderError,
    InsufficientContentError,
    analyze_guest_request,
)
from app.services.history import save_analysis

router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.post("", response_model=AnalysisResponse, dependencies=[Depends(limit_analysis_requests)])
async def create_analysis(
    request: AnalysisRequest,
    db: Database,
    response: Response,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> AnalysisResponse:
    response.headers["Cache-Control"] = "no-store"
    user = get_current_user(db, credentials) if credentials else None
    if request.save_to_history and user is None:
        raise unauthorized()
    try:
        report = await analyze_guest_request(request)
        if request.save_to_history and user is not None:
            return save_analysis(db, user, request, report)
        return report
    except InsufficientContentError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "INSUFFICIENT_CONTENT", "message": str(error)},
        ) from error
    except AnalysisProviderError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": error.code, "message": str(error)},
        ) from error
