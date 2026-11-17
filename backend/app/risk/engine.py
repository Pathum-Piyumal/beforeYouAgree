from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, Sequence

RiskCategory = Literal[
    "financial",
    "subscription",
    "cancellation",
    "refund",
    "privacy",
    "commitment",
]
RiskBand = Literal["low", "moderate", "high", "very_high"]
CoverageStatus = Literal["complete", "partial", "insufficient"]

RISK_SCORE_VERSION = "risk-v1"
MIN_CONFIDENCE = 0.6
CATEGORY_WEIGHTS: dict[RiskCategory, float] = {
    "financial": 0.25,
    "subscription": 0.20,
    "cancellation": 0.20,
    "refund": 0.10,
    "privacy": 0.15,
    "commitment": 0.10,
}
SEVERITY_SCORES: dict[str, int] = {
    "low": 25,
    "moderate": 50,
    "high": 75,
    "critical": 100,
}


class RiskInputError(ValueError):
    """Raised when validated findings cannot be scored safely."""


@dataclass(frozen=True)
class ScoringFinding:
    category: str
    severity: str
    confidence: float
    source_section_id: str
    evidence_text: str
    risk_type: str


@dataclass(frozen=True)
class CategoryScore:
    category: RiskCategory
    weight: float
    assessed: bool
    score: int | None
    contribution: float | None
    finding_count: int
    explanation: str


@dataclass(frozen=True)
class RiskAssessment:
    score: int | None
    risk_band: RiskBand | None
    score_version: str
    coverage_status: CoverageStatus
    category_scores: tuple[CategoryScore, ...]
    dominant_contributions: tuple[str, ...]
    explanation: str


def risk_band_for_score(score: int) -> RiskBand:
    if not 0 <= score <= 100:
        raise RiskInputError("Risk score must be between 0 and 100")
    if score <= 25:
        return "low"
    if score <= 50:
        return "moderate"
    if score <= 75:
        return "high"
    return "very_high"


def _validate_finding(finding: ScoringFinding) -> None:
    if finding.category not in CATEGORY_WEIGHTS:
        raise RiskInputError(f"Unsupported risk category: {finding.category}")
    if finding.severity not in SEVERITY_SCORES:
        raise RiskInputError(f"Unsupported severity: {finding.severity}")
    if not math.isfinite(finding.confidence) or not 0 <= finding.confidence <= 1:
        raise RiskInputError("Finding confidence must be between 0 and 1")
    if not finding.source_section_id.strip():
        raise RiskInputError("Finding source section ID cannot be empty")
    if not finding.evidence_text.strip():
        raise RiskInputError("Finding evidence cannot be empty")
    if not finding.risk_type.strip():
        raise RiskInputError("Finding risk type cannot be empty")


def _clause_key(finding: ScoringFinding) -> tuple[str, str]:
    normalized_evidence = " ".join(finding.evidence_text.lower().split())
    return finding.source_section_id, normalized_evidence


def score_findings(findings: Sequence[ScoringFinding]) -> RiskAssessment:
    """Score high-confidence findings while excluding unknown categories from the total."""

    selected_by_clause: dict[tuple[str, str], ScoringFinding] = {}
    low_confidence_by_category: dict[str, int] = {}

    for finding in findings:
        _validate_finding(finding)
        if finding.confidence < MIN_CONFIDENCE:
            low_confidence_by_category[finding.category] = (
                low_confidence_by_category.get(finding.category, 0) + 1
            )
            continue

        clause_key = _clause_key(finding)
        previous = selected_by_clause.get(clause_key)
        if previous is None:
            selected_by_clause[clause_key] = finding
            continue

        current_impact = SEVERITY_SCORES[finding.severity] * CATEGORY_WEIGHTS[finding.category]
        previous_impact = SEVERITY_SCORES[previous.severity] * CATEGORY_WEIGHTS[previous.category]
        if current_impact > previous_impact or (
            current_impact == previous_impact
            and (finding.category, finding.risk_type) < (previous.category, previous.risk_type)
        ):
            selected_by_clause[clause_key] = finding

    findings_by_category: dict[RiskCategory, list[ScoringFinding]] = {
        category: [] for category in CATEGORY_WEIGHTS
    }
    for finding in selected_by_clause.values():
        findings_by_category[finding.category].append(finding)  # type: ignore[index]

    assessed_categories = [
        category
        for category, category_findings in findings_by_category.items()
        if category_findings
    ]
    assessed_weight = sum(CATEGORY_WEIGHTS[category] for category in assessed_categories)
    category_scores: list[CategoryScore] = []

    for category, weight in CATEGORY_WEIGHTS.items():
        category_findings = findings_by_category[category]
        if not category_findings:
            explanation = (
                "Not assessed: evidence confidence was below the minimum."
                if low_confidence_by_category.get(category)
                else "Not assessed: no validated evidence was provided."
            )
            category_scores.append(
                CategoryScore(
                    category=category,
                    weight=weight,
                    assessed=False,
                    score=None,
                    contribution=None,
                    finding_count=0,
                    explanation=explanation,
                )
            )
            continue

        category_score = max(SEVERITY_SCORES[finding.severity] for finding in category_findings)
        contribution = category_score * weight / assessed_weight
        category_scores.append(
            CategoryScore(
                category=category,
                weight=weight,
                assessed=True,
                score=category_score,
                contribution=contribution,
                finding_count=len(category_findings),
                explanation=(
                    f"Highest validated severity is {category_score}/100 from "
                    f"{len(category_findings)} finding(s)."
                ),
            )
        )

    if not assessed_categories:
        return RiskAssessment(
            score=None,
            risk_band=None,
            score_version=RISK_SCORE_VERSION,
            coverage_status="insufficient",
            category_scores=tuple(category_scores),
            dominant_contributions=(),
            explanation=(
                "Score unavailable: no high-confidence category evidence was assessed. "
                "Unknown categories were not treated as zero risk."
            ),
        )

    score = int(round(sum(item.contribution or 0 for item in category_scores)))
    score = max(0, min(100, score))
    coverage_status: CoverageStatus = (
        "complete" if len(assessed_categories) == len(CATEGORY_WEIGHTS) else "partial"
    )
    assessed_items = [item for item in category_scores if item.assessed]
    dominant_items = sorted(
        assessed_items,
        key=lambda item: (item.contribution or 0, item.category),
        reverse=True,
    )[:3]
    dominant_contributions = tuple(
        f"{item.category}: {item.score}/100 contributes {item.contribution:.1f} points"
        for item in dominant_items
    )
    explanation = (
        f"{coverage_status.title()} score based on {len(assessed_categories)} of "
        f"{len(CATEGORY_WEIGHTS)} categories. Unknown categories were excluded rather "
        "than treated as zero risk."
    )
    return RiskAssessment(
        score=score,
        risk_band=risk_band_for_score(score),
        score_version=RISK_SCORE_VERSION,
        coverage_status=coverage_status,
        category_scores=tuple(category_scores),
        dominant_contributions=dominant_contributions,
        explanation=explanation,
    )
