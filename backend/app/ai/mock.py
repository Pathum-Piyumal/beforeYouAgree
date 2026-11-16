from __future__ import annotations

import re

from app.ai.contracts import (
    ExtractedFinding,
    ExtractionAttributes,
    ExtractionReviewFlag,
    StructuredExtraction,
)
from app.ai.prompting import EXTRACTION_SCHEMA_VERSION, PROMPT_VERSION, prompt_injection_markers
from app.ai.provider import ProviderRequest, ProviderResponse, ProviderUsage


def _find_evidence(section_text: str) -> str | None:
    for sentence in re.split(r"(?<=[.!?])\s+", section_text.strip()):
        normalized = sentence.strip()
        lowered = normalized.lower()
        if "automatically" in lowered or "renews" in lowered or "renewal" in lowered:
            return normalized
    return None


def _find_cancellation_evidence(section_text: str) -> str | None:
    for sentence in re.split(r"(?<=[.!?])\s+", section_text.strip()):
        normalized = sentence.strip()
        lowered = normalized.lower()
        if "cancel" not in lowered:
            continue
        if any(marker in lowered for marker in ("before", "notice", " by ", "deadline")):
            return normalized
        if re.search(r"\d{1,2}/\d{1,2}/\d{4}|\d{4}-\d{2}-\d{2}", normalized):
            return normalized
    return None


def _trial_days(section_text: str) -> int | None:
    match = re.search(r"(\d+)\s*[- ]?day(?:s)?\s+(?:free\s+)?trial", section_text, re.IGNORECASE)
    return int(match.group(1)) if match else None


def _notice_days(section_text: str) -> int | None:
    match = re.search(
        r"(?:at least|minimum(?:\s+of)?)\s+(\d+)\s+days?\s+"
        r"(?:in\s+)?(?:advance\s+)?(?:notice|before)|"
        r"(\d+)\s+days?\s+before\s+(?:the\s+)?(?:renewal|renewing|next\s+charge)",
        section_text,
        re.IGNORECASE,
    )
    if match is None:
        return None
    return int(match.group(1) or match.group(2))


def _currency_symbol_to_code(symbol: str) -> str:
    return {"$": "USD", "€": "EUR", "£": "GBP"}.get(symbol, "USD")


class MockLLMProvider:
    """Deterministic provider used until a real LLM adapter is selected."""

    model_id = "mock-rules-v1"

    async def extract(self, request: ProviderRequest) -> ProviderResponse:
        findings: list[ExtractedFinding] = []
        review_flags: list[ExtractionReviewFlag] = []

        for section in request.sections:
            if prompt_injection_markers(section.text):
                review_flags.append(
                    ExtractionReviewFlag(
                        code="prompt_injection_detected",
                        message="Page text contains instruction-like content; it was treated as data.",
                        source_section_id=section.section_id,
                    )
                )

            evidence = _find_evidence(section.text)
            if evidence is not None:
                lowered = section.text.lower()
                amount_match = re.search(r"([$€£])\s*([0-9]+(?:\.[0-9]{1,2})?)", section.text)
                findings.append(
                    ExtractedFinding(
                        category="subscription",
                        risk_type="automatic_renewal",
                        consequence="A recurring charge may begin after the trial unless you cancel.",
                        severity_candidate="high",
                        evidence_text=evidence,
                        source_section_id=section.section_id,
                        source_url=section.source_url,
                        attributes=ExtractionAttributes(
                            amount=amount_match.group(2) if amount_match else None,
                            currency=(
                                _currency_symbol_to_code(amount_match.group(1))
                                if amount_match
                                else None
                            ),
                            duration_days=_trial_days(section.text),
                            recurrence="monthly" if "month" in lowered else "recurring",
                        ),
                        confidence=0.98,
                    )
                )

            cancellation_evidence = _find_cancellation_evidence(section.text)
            if cancellation_evidence is not None:
                findings.append(
                    ExtractedFinding(
                        category="cancellation",
                        risk_type="cancellation_deadline",
                        consequence="Cancellation may need to be completed by the stated deadline.",
                        severity_candidate="moderate",
                        evidence_text=cancellation_evidence,
                        source_section_id=section.section_id,
                        source_url=section.source_url,
                        attributes=ExtractionAttributes(notice_days=_notice_days(section.text)),
                        confidence=0.95,
                    )
                )

        extraction = StructuredExtraction(
            findings=findings,
            no_finding=not findings,
            review_flags=review_flags,
        )
        input_characters = sum(len(section.text) for section in request.sections)
        return ProviderResponse(
            extraction=extraction,
            model_id=self.model_id,
            prompt_version=PROMPT_VERSION,
            extraction_schema_version=EXTRACTION_SCHEMA_VERSION,
            usage=ProviderUsage(
                input_characters=input_characters,
                output_findings=len(findings),
                estimated_cost_usd=0.0,
            ),
        )
