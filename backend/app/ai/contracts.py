from __future__ import annotations

from datetime import date as Date
from typing import Literal

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, model_validator

ExtractionCategory = Literal[
    "financial",
    "subscription",
    "cancellation",
    "refund",
    "privacy",
    "commitment",
]
CandidateSeverity = Literal["low", "moderate", "high", "critical"]
ReviewFlagCode = Literal[
    "ambiguous_claim",
    "conflicting_claim",
    "invalid_evidence",
    "prompt_injection_detected",
    "source_section_not_found",
    "source_url_mismatch",
    "unsupported_claim",
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ExtractionAttributes(StrictModel):
    amount: str | None = Field(default=None, max_length=40)
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    duration_days: int | None = Field(default=None, ge=0, le=36_500)
    recurrence: str | None = Field(default=None, max_length=40)
    start_date: Date | None = None
    end_date: Date | None = None
    notice_days: int | None = Field(default=None, ge=0, le=36_500)
    restrictions: list[str] = Field(default_factory=list, max_length=20)


class ExtractedFinding(StrictModel):
    category: ExtractionCategory
    risk_type: str = Field(min_length=1, max_length=100)
    consequence: str = Field(min_length=1, max_length=2_000)
    severity_candidate: CandidateSeverity
    evidence_text: str = Field(min_length=1, max_length=4_000)
    source_section_id: str = Field(min_length=1, max_length=80)
    source_url: AnyHttpUrl
    attributes: ExtractionAttributes = Field(default_factory=ExtractionAttributes)
    confidence: float = Field(ge=0, le=1)


class ExtractionReviewFlag(StrictModel):
    code: ReviewFlagCode
    message: str = Field(min_length=1, max_length=500)
    source_section_id: str | None = Field(default=None, max_length=80)
    user_visible: bool = True


class StructuredExtraction(StrictModel):
    findings: list[ExtractedFinding] = Field(default_factory=list, max_length=50)
    no_finding: bool
    review_flags: list[ExtractionReviewFlag] = Field(default_factory=list, max_length=50)

    @model_validator(mode="after")
    def validate_no_finding_state(self) -> StructuredExtraction:
        if self.no_finding != (not self.findings):
            raise ValueError("no_finding must match whether findings are present")
        return self
