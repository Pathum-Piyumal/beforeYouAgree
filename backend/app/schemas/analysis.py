from __future__ import annotations

from datetime import date as Date
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, Field, HttpUrl, model_validator


AnalysisStatus = Literal["complete", "partial", "insufficient_evidence", "failed"]
RiskBand = Literal["low", "moderate", "high", "very_high"]
RiskCategory = Literal[
    "financial",
    "subscription",
    "cancellation",
    "refund",
    "privacy",
    "commitment",
]
Severity = Literal["low", "moderate", "high", "critical"]
TimelineTiming = Literal["absolute", "relative", "recurring", "unresolved"]
TimelineStatus = Literal["resolved", "unresolved"]
OffsetDirection = Literal["before", "after"]


class AnalysisSection(BaseModel):
    section_id: str = Field(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._:-]+$")
    heading: str | None = Field(default=None, max_length=200)
    text: str = Field(min_length=1, max_length=12_000)
    source_url: AnyHttpUrl


class AnalysisRequest(BaseModel):
    source_url: HttpUrl
    save_to_history: bool = False
    sections: list[AnalysisSection] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def validate_total_text(self) -> AnalysisRequest:
        total_length = sum(len(section.text) for section in self.sections)
        if total_length > 50_000:
            raise ValueError("Combined section text exceeds the 50,000 character limit")
        return self


class Evidence(BaseModel):
    section_id: str
    quote: str
    source_url: AnyHttpUrl


class FindingResponse(BaseModel):
    category: RiskCategory
    risk_type: str
    severity: Severity
    consequence: str
    evidence: Evidence


class Coverage(BaseModel):
    status: Literal["complete", "partial", "insufficient"]
    warnings: list[str] = Field(default_factory=list)


class AnalysisReviewFlag(BaseModel):
    code: str
    message: str
    source_section_id: str | None = None


class AnalysisMetadata(BaseModel):
    model_id: str
    prompt_version: str
    extraction_schema_version: str
    provider_attempts: int = Field(ge=1)
    estimated_cost_usd: float = Field(ge=0)


class CategoryScoreResponse(BaseModel):
    category: RiskCategory
    weight: float = Field(ge=0, le=1)
    assessed: bool
    score: int | None = Field(default=None, ge=0, le=100)
    contribution: float | None = Field(default=None, ge=0, le=100)
    finding_count: int = Field(ge=0)
    explanation: str


class TimelineItem(BaseModel):
    kind: str
    timing: TimelineTiming = "relative"
    status: TimelineStatus = "resolved"
    relative_to: str | None = None
    offset_direction: OffsetDirection | None = None
    offset_days: int | None = Field(default=None, ge=0)
    amount: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    recurrence: str | None = None
    date: Date | None = None
    timezone: str | None = Field(default=None, max_length=64)
    source_section_id: str | None = Field(default=None, max_length=80)
    source_risk_types: list[str] = Field(default_factory=list, max_length=20)
    source_url: AnyHttpUrl | None = None
    evidence_quote: str | None = Field(default=None, max_length=4_000)
    assumptions: list[str] = Field(default_factory=list, max_length=10)
    unresolved_reason: str | None = Field(default=None, max_length=500)


class AnalysisResponse(BaseModel):
    analysis_id: str | None = None
    status: AnalysisStatus
    score: int | None = Field(default=None, ge=0, le=100)
    risk_band: RiskBand | None = None
    score_version: str | None = None
    coverage: Coverage
    review_flags: list[AnalysisReviewFlag] = Field(default_factory=list)
    metadata: AnalysisMetadata | None = None
    score_coverage: Literal["complete", "partial", "insufficient"] = "insufficient"
    category_scores: list[CategoryScoreResponse] = Field(default_factory=list)
    dominant_contributions: list[str] = Field(default_factory=list)
    score_explanation: str | None = None
    findings: list[FindingResponse] = Field(default_factory=list)
    timeline: list[TimelineItem] = Field(default_factory=list)
