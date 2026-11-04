from __future__ import annotations

import pytest

from app.risk.engine import (
    RiskInputError,
    ScoringFinding,
    risk_band_for_score,
    score_findings,
)


@pytest.mark.parametrize(
    ("score", "band"),
    [
        (0, "low"),
        (25, "low"),
        (26, "moderate"),
        (50, "moderate"),
        (51, "high"),
        (75, "high"),
        (76, "very_high"),
        (100, "very_high"),
    ],
)
def test_risk_band_boundaries(score: int, band: str) -> None:
    assert risk_band_for_score(score) == band


def test_unknown_categories_are_excluded_and_score_is_qualified() -> None:
    assessment = score_findings(
        [
            ScoringFinding(
                category="subscription",
                severity="high",
                confidence=0.98,
                source_section_id="terms-1",
                evidence_text="The subscription renews automatically.",
                risk_type="automatic_renewal",
            )
        ]
    )

    assert assessment.score == 75
    assert assessment.coverage_status == "partial"
    assert assessment.score_version == "risk-v1"
    assert assessment.category_scores[0].assessed is False
    subscription = next(
        item for item in assessment.category_scores if item.category == "subscription"
    )
    assert subscription.score == 75
    assert "excluded" in assessment.explanation


def test_same_clause_is_not_counted_in_two_categories() -> None:
    assessment = score_findings(
        [
            ScoringFinding(
                category="financial",
                severity="high",
                confidence=0.9,
                source_section_id="terms-1",
                evidence_text="You will be charged $49.99 monthly.",
                risk_type="recurring_charge",
            ),
            ScoringFinding(
                category="subscription",
                severity="high",
                confidence=0.9,
                source_section_id="terms-1",
                evidence_text="You will be charged $49.99 monthly.",
                risk_type="automatic_renewal",
            ),
        ]
    )

    assessed = [item for item in assessment.category_scores if item.assessed]
    assert len(assessed) == 1
    assert assessed[0].category == "financial"


def test_low_confidence_evidence_is_not_scored() -> None:
    assessment = score_findings(
        [
            ScoringFinding(
                category="privacy",
                severity="critical",
                confidence=0.59,
                source_section_id="privacy-1",
                evidence_text="Data may be shared with partners.",
                risk_type="data_sharing",
            )
        ]
    )

    assert assessment.score is None
    assert assessment.coverage_status == "insufficient"
    privacy = next(item for item in assessment.category_scores if item.category == "privacy")
    assert privacy.assessed is False
    assert "confidence" in privacy.explanation


@pytest.mark.parametrize(
    "finding",
    [
        ScoringFinding(
            category="unknown",
            severity="high",
            confidence=0.9,
            source_section_id="terms-1",
            evidence_text="Evidence",
            risk_type="unknown",
        ),
        ScoringFinding(
            category="financial",
            severity="extreme",
            confidence=0.9,
            source_section_id="terms-1",
            evidence_text="Evidence",
            risk_type="unknown",
        ),
        ScoringFinding(
            category="financial",
            severity="high",
            confidence=1.1,
            source_section_id="terms-1",
            evidence_text="Evidence",
            risk_type="unknown",
        ),
    ],
)
def test_invalid_scoring_input_is_rejected(finding: ScoringFinding) -> None:
    with pytest.raises(RiskInputError):
        score_findings([finding])
