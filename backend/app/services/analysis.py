from __future__ import annotations

from app.ai.mock import MockLLMProvider
from app.ai.prompting import build_extraction_prompt
from app.ai.provider import (
    LLMProvider,
    ProviderError,
    ProviderRequest,
    call_provider_with_policy,
)
from app.ai.validation import validate_extraction
from app.core.config import settings
from app.risk.engine import ScoringFinding, score_findings
from app.schemas.analysis import (
    AnalysisMetadata,
    AnalysisRequest,
    AnalysisResponse,
    AnalysisReviewFlag,
    CategoryScoreResponse,
    Coverage,
    Evidence,
    FindingResponse,
)
from app.services.consequences import generate_consequence
from app.services.timeline import build_timeline


class InsufficientContentError(ValueError):
    pass


class AnalysisProviderError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


async def analyze_guest_request(
    request: AnalysisRequest,
    provider: LLMProvider | None = None,
) -> AnalysisResponse:
    sections = [section for section in request.sections if section.text.strip()]
    if not sections or sum(len(section.text.strip()) for section in sections) < 20:
        raise InsufficientContentError("Not enough relevant agreement text was provided.")

    selected_provider = provider or MockLLMProvider()
    provider_request = ProviderRequest(
        source_url=request.source_url,
        sections=sections,
        prompt=build_extraction_prompt(str(request.source_url), sections),
    )
    try:
        provider_call = await call_provider_with_policy(
            selected_provider,
            provider_request,
            timeout_seconds=settings.llm_timeout_seconds,
            max_retries=settings.llm_max_retries,
            max_cost_usd=settings.llm_max_cost_usd,
        )
    except ProviderError as error:
        raise AnalysisProviderError(error.code, str(error)) from error

    extraction = validate_extraction(provider_call.response.extraction, sections)
    findings = [
        FindingResponse(
            category=finding.category,
            risk_type=finding.risk_type,
            severity=finding.severity_candidate,
            consequence=generate_consequence(finding),
            evidence=Evidence(
                section_id=finding.source_section_id,
                quote=finding.evidence_text,
                source_url=finding.source_url,
            ),
        )
        for finding in extraction.findings
    ]
    risk_assessment = score_findings(
        [
            ScoringFinding(
                category=finding.category,
                severity=finding.severity_candidate,
                confidence=finding.confidence,
                source_section_id=finding.source_section_id,
                evidence_text=finding.evidence_text,
                risk_type=finding.risk_type,
            )
            for finding in extraction.findings
        ]
    )
    timeline = build_timeline(extraction.findings, sections)

    full_text = " ".join(section.text for section in sections)
    lowered_text = full_text.lower()
    review_flags = [
        AnalysisReviewFlag(
            code=flag.code,
            message=flag.message,
            source_section_id=flag.source_section_id,
        )
        for flag in extraction.review_flags
        if flag.user_visible
    ]
    warnings = [flag.message for flag in review_flags]
    if "cancel" not in lowered_text:
        warnings.append("Cancellation procedure not found")
    if not findings:
        warnings.append("No supported consequence was identified by the provider")
    if risk_assessment.coverage_status != "complete":
        warnings.append(
            "Risk score is qualified because some risk categories were not assessed"
        )

    coverage_status = (
        "insufficient"
        if not findings
        else "complete"
        if not warnings
        else "partial"
    )
    response_status = (
        "complete"
        if findings
        and risk_assessment.score is not None
        and risk_assessment.coverage_status == "complete"
        and not review_flags
        else "partial"
        if findings
        else "insufficient_evidence"
    )
    return AnalysisResponse(
        status=response_status,
        score=risk_assessment.score,
        risk_band=risk_assessment.risk_band,
        score_version=risk_assessment.score_version,
        coverage=Coverage(status=coverage_status, warnings=warnings),
        review_flags=review_flags,
        metadata=AnalysisMetadata(
            model_id=provider_call.response.model_id,
            prompt_version=provider_call.response.prompt_version,
            extraction_schema_version=provider_call.response.extraction_schema_version,
            provider_attempts=provider_call.attempts,
            estimated_cost_usd=provider_call.response.usage.estimated_cost_usd,
        ),
        score_coverage=risk_assessment.coverage_status,
        category_scores=[
            CategoryScoreResponse(
                category=item.category,
                weight=item.weight,
                assessed=item.assessed,
                score=item.score,
                contribution=item.contribution,
                finding_count=item.finding_count,
                explanation=item.explanation,
            )
            for item in risk_assessment.category_scores
        ],
        dominant_contributions=list(risk_assessment.dominant_contributions),
        score_explanation=risk_assessment.explanation,
        findings=findings,
        timeline=timeline,
    )
