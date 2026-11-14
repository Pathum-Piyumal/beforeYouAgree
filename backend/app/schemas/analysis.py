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


class TimelineItem(BaseModel):
    kind: str
    relative_to: str | None = None
    offset_days: int | None = Field(default=None, ge=0)
    amount: str | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    recurrence: str | None = None
    date: Date | None = None


class AnalysisResponse(BaseModel):
    analysis_id: str | None = None
    status: AnalysisStatus
    score: int | None = Field(default=None, ge=0, le=100)
    risk_band: RiskBand | None = None
    score_version: str | None = None
    coverage: Coverage
    findings: list[FindingResponse] = Field(default_factory=list)
    timeline: list[TimelineItem] = Field(default_factory=list)
