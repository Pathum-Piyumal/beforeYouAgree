from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.schemas.analysis import RiskBand


class HistoryItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    domain: str
    source_url: str
    score: int | None
    risk_band: RiskBand | None
    status: str
    created_at: datetime
    report_available: bool


class HistoryPage(BaseModel):
    items: list[HistoryItem]
    total: int
    offset: int
    limit: int


class DashboardSummary(BaseModel):
    analysis_count: int
    finding_count: int
    commitment_count: int
    average_score: float | None
    risk_distribution: dict[str, int]
