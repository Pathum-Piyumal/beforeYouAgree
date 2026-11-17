from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

from app.ai.contracts import ExtractedFinding, ExtractionReviewFlag, StructuredExtraction
from app.ai.prompting import prompt_injection_markers
from app.schemas.analysis import AnalysisSection


def _flag(
    code: str,
    message: str,
    source_section_id: str | None = None,
) -> ExtractionReviewFlag:
    return ExtractionReviewFlag(
        code=code,  # type: ignore[arg-type]
        message=message,
        source_section_id=source_section_id,
    )


def validate_extraction(
    extraction: StructuredExtraction,
    sections: list[AnalysisSection],
) -> StructuredExtraction:
    """Keep only findings whose evidence points to submitted source content."""

    sections_by_id = {section.section_id: section for section in sections}
    review_flags = list(extraction.review_flags)
    validated_findings: list[ExtractedFinding] = []
    findings_by_risk_type: dict[str, ExtractedFinding] = {}

    for section in sections:
        if prompt_injection_markers(section.text):
            if not any(
                flag.code == "prompt_injection_detected"
                and flag.source_section_id == section.section_id
                for flag in review_flags
            ):
                review_flags.append(
                    _flag(
                        "prompt_injection_detected",
                        "Page text contains instruction-like content; it was treated as data.",
                        section.section_id,
                    )
                )

    seen = set()
    for original in extraction.findings:
        finding = original.model_copy(deep=True)
        section = sections_by_id.get(finding.source_section_id)
        if section is None:
            review_flags.append(
                _flag(
                    "source_section_not_found",
                    "Finding references a section that was not submitted.",
                    finding.source_section_id,
                )
            )
            continue
        if str(finding.source_url) != str(section.source_url):
            review_flags.append(
                _flag(
                    "source_url_mismatch",
                    "Finding source URL does not match the cited section.",
                    finding.source_section_id,
                )
            )
            continue
        if finding.evidence_text not in section.text:
            review_flags.append(
                _flag(
                    "invalid_evidence",
                    "Finding evidence was not found exactly in the submitted section.",
                    finding.source_section_id,
                )
            )
            continue
        signature = (
            finding.category,
            finding.risk_type,
            finding.source_section_id,
            finding.evidence_text,
        )
        if signature in seen:
            continue
        seen.add(signature)
        unsupported = False
        attributes = finding.attributes
        if attributes.amount:
            try:
                amount = Decimal(attributes.amount)
                numbers = re.findall(r"\d+(?:\.\d+)?", section.text.replace(",", ""))
                supported = (
                    amount.is_finite()
                    and amount >= 0
                    and any(Decimal(value) == amount for value in numbers)
                )
            except (InvalidOperation, ValueError):
                supported = False
            if not supported:
                attributes.amount = None
                unsupported = True
        if attributes.currency:
            currencies = {"USD": "$", "EUR": "€", "GBP": "£"}
            if (
                attributes.currency not in section.text.upper()
                and currencies.get(attributes.currency, "UNSUPPORTED") not in section.text
            ):
                attributes.currency = None
                unsupported = True
        for field in ("duration_days", "notice_days"):
            value = getattr(attributes, field)
            if value is not None and not re.search(
                rf"\b{value}\s*[- ]?days?\b", section.text, re.IGNORECASE
            ):
                setattr(attributes, field, None)
                unsupported = True
        for field in ("start_date", "end_date"):
            value = getattr(attributes, field)
            if value is not None:
                named = f"{value.strftime('%B')} {value.day}, {value.year}"
                if (
                    value.isoformat() not in section.text
                    and named.lower() not in section.text.lower()
                ):
                    setattr(attributes, field, None)
                    unsupported = True
        if unsupported:
            review_flags.append(
                _flag(
                    "unsupported_claim",
                    "Unsupported amounts, dates, or durations were removed; "
                    "review the original clause.",
                    finding.source_section_id,
                )
            )
        if finding.confidence < 0.6:
            review_flags.append(
                _flag(
                    "ambiguous_claim",
                    "Finding confidence is low and requires user review.",
                    finding.source_section_id,
                )
            )
        previous_finding = findings_by_risk_type.get(finding.risk_type)
        if previous_finding and previous_finding.evidence_text != finding.evidence_text:
            review_flags.append(
                _flag(
                    "conflicting_claim",
                    "Multiple findings describe the same risk type with different evidence.",
                    finding.source_section_id,
                )
            )
        findings_by_risk_type.setdefault(finding.risk_type, finding)
        validated_findings.append(finding)

    return StructuredExtraction(
        findings=validated_findings,
        no_finding=not validated_findings,
        review_flags=review_flags[:50],
    )
