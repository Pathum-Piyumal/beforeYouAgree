from fastapi import APIRouter, HTTPException, status

from app.schemas.analysis import AnalysisRequest, AnalysisResponse
from app.services.analysis import InsufficientContentError, analyze_guest_request


router = APIRouter(prefix="/analyses", tags=["analyses"])


@router.post("", response_model=AnalysisResponse)
def create_analysis(request: AnalysisRequest) -> AnalysisResponse:
    try:
        return analyze_guest_request(request)
    except InsufficientContentError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"code": "INSUFFICIENT_CONTENT", "message": str(error)},
        ) from error
