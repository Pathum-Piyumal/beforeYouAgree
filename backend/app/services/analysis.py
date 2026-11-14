from __future__ import annotations

import re

from app.schemas.analysis import (
    AnalysisRequest,
    AnalysisResponse,
    Coverage,
    Evidence,
    FindingResponse,
    TimelineItem,
)


class InsufficientContentError(ValueError):
    pass


def _find_evidence(section_text: str) -> str | None:
    for sentence in re.split(r"(?<=[.!?])\s+", section_text.strip()):
        normalized = sentence.strip()
        lowered = normalized.lower()
        if "automatically" in lowered or "renews" in lowered or "renewal" in lowered:
            return normalized
    return None


def _currency_symbol_to_code(symbol: str) -> str:
    return {"$": "USD", "€": "EUR", "£": "GBP"}.get(symbol, "USD")


def analyze_guest_request(request: AnalysisRequest) -> AnalysisResponse:
    sections = [section for section in request.sections if section.text.strip()]
    if not sections or sum(len(section.text.strip()) for section in sections) < 20:
        raise InsufficientContentError("Not enough relevant agreement text was provided.")

    findings: list[FindingResponse] = []
    timeline: list[TimelineItem] = []
    full_text = " ".join(section.text for section in sections)
    lowered_text = full_text.lower()

    evidence_section = next(
        ((section, _find_evidence(section.text)) for section in sections),
        None,
    )
    if evidence_section and evidence_section[1] is not None:
        section, quote = evidence_section
        findings.append(
            FindingResponse(
                category="subscription",
                risk_type="automatic_renewal",
                severity="high",
                consequence="A recurring charge may begin after the trial unless you cancel.",
                evidence=Evidence(
                    section_id=section.section_id,
                    quote=quote,
                    source_url=section.source_url,
                ),
            )
        )

    trial_match = re.search(r"(\d+)\s*[- ]?day(?:s)?\s+(?:free\s+)?trial", lowered_text)
    if trial_match:
        timeline.append(
            TimelineItem(
                kind="trial_ends",
                relative_to="trial_start",
                offset_days=int(trial_match.group(1)),
            )
        )

    amount_match = re.search(r"([$€£])\s*([0-9]+(?:\.[0-9]{1,2})?)", full_text)
    if amount_match and ("month" in lowered_text or "renew" in lowered_text):
        timeline.append(
            TimelineItem(
                kind="recurring_charge",
                amount=amount_match.group(2),
                currency=_currency_symbol_to_code(amount_match.group(1)),
                recurrence="monthly" if "month" in lowered_text else "recurring",
            )
        )

    warnings: list[str] = []
    if "cancel" not in lowered_text:
        warnings.append("Cancellation procedure not found")
    if not findings:
        warnings.append("No supported risk finding was identified by the mock analyzer")

    coverage_status = "complete" if not warnings else "partial"
    response_status = "complete" if findings else "insufficient_evidence"
    return AnalysisResponse(
        status=response_status,
        score=68 if findings else None,
        risk_band="high" if findings else None,
        score_version="mock-v1" if findings else None,
        coverage=Coverage(status=coverage_status, warnings=warnings),
        findings=findings,
        timeline=timeline,
    )
