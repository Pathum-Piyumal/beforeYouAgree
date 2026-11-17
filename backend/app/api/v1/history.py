from datetime import UTC, date, datetime, time
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import func, select

from app.dependencies.auth import CurrentUser, Database
from app.models import Analysis, Commitment, Finding
from app.schemas.analysis import AnalysisResponse, RiskBand
from app.schemas.history import DashboardSummary, HistoryItem, HistoryPage

router = APIRouter(tags=["history"])


def owned_analysis(db: Database, user: CurrentUser, analysis_id: UUID) -> Analysis:
    analysis = db.scalar(
        select(Analysis).where(
            Analysis.id == analysis_id,
            Analysis.user_id == user.id,
        )
    )
    if analysis is None:
        raise HTTPException(status_code=404, detail="Saved analysis not found")
    return analysis


@router.get("/analyses", response_model=HistoryPage)
def list_history(
    db: Database,
    user: CurrentUser,
    response: Response,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    risk_band: RiskBand | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> HistoryPage:
    response.headers["Cache-Control"] = "no-store"
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=422, detail="Start date must precede end date")
    conditions = [Analysis.user_id == user.id]
    if risk_band:
        conditions.append(Analysis.risk_band == risk_band)
    if date_from:
        conditions.append(Analysis.created_at >= datetime.combine(date_from, time.min, UTC))
    if date_to:
        # Avoid overflow for the maximum accepted calendar date.
        conditions.append(Analysis.created_at <= datetime.combine(date_to, time.max, UTC))
    total = db.scalar(select(func.count()).select_from(Analysis).where(*conditions)) or 0
    analyses = db.scalars(
        select(Analysis)
        .where(*conditions)
        .order_by(
            Analysis.created_at.desc(),
            Analysis.id.desc(),
        )
        .offset(offset)
        .limit(limit)
    ).all()
    return HistoryPage(
        items=[
            HistoryItem(
                id=item.id,
                domain=item.domain,
                source_url=item.source_url,
                score=item.score,
                risk_band=item.risk_band,
                status=item.status,
                created_at=item.created_at,
                report_available=item.report is not None,
            )
            for item in analyses
        ],
        total=total,
        offset=offset,
        limit=limit,
    )


@router.get("/analyses/{analysis_id}", response_model=AnalysisResponse)
def history_detail(
    analysis_id: UUID,
    db: Database,
    user: CurrentUser,
    response: Response,
) -> AnalysisResponse:
    response.headers["Cache-Control"] = "no-store"
    analysis = owned_analysis(db, user, analysis_id)
    if analysis.report is None:
        raise HTTPException(status_code=404, detail="This older analysis has no saved report")
    return AnalysisResponse.model_validate(analysis.report)


@router.delete("/analyses/{analysis_id}", status_code=204)
def delete_history(
    analysis_id: UUID,
    db: Database,
    user: CurrentUser,
    response: Response,
) -> None:
    response.headers["Cache-Control"] = "no-store"
    db.delete(owned_analysis(db, user, analysis_id))
    db.commit()


@router.get("/dashboard/summary", response_model=DashboardSummary)
def summary(db: Database, user: CurrentUser, response: Response) -> DashboardSummary:
    response.headers["Cache-Control"] = "no-store"
    analysis_count, average = db.execute(
        select(
            func.count(Analysis.id),
            func.avg(Analysis.score),
        ).where(Analysis.user_id == user.id)
    ).one()
    distribution = {band: 0 for band in ("low", "moderate", "high", "very_high", "unscored")}
    for band, count in db.execute(
        select(Analysis.risk_band, func.count())
        .where(
            Analysis.user_id == user.id,
        )
        .group_by(Analysis.risk_band)
    ):
        distribution[band or "unscored"] = count
    finding_count = (
        db.scalar(
            select(func.count())
            .select_from(Finding)
            .join(Analysis)
            .where(
                Analysis.user_id == user.id,
            )
        )
        or 0
    )
    commitment_count = (
        db.scalar(
            select(func.count())
            .select_from(Commitment)
            .join(Analysis)
            .where(
                Analysis.user_id == user.id,
            )
        )
        or 0
    )
    return DashboardSummary(
        analysis_count=analysis_count,
        average_score=round(average, 1) if average is not None else None,
        finding_count=finding_count,
        commitment_count=commitment_count,
        risk_distribution=distribution,
    )
