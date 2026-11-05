from __future__ import annotations

import re
from datetime import datetime
from typing import Iterable

from app.ai.contracts import ExtractedFinding
from app.schemas.analysis import AnalysisSection, TimelineItem


_AMOUNT_PATTERN = re.compile(r"([$€£])\s*([0-9]+(?:\.[0-9]{1,2})?)")
_TRIAL_PATTERN = re.compile(r"(\d+)\s*[- ]?day(?:s)?\s+(?:free\s+)?trial", re.IGNORECASE)
_NOTICE_PATTERNS = (
    re.compile(
        r"(?:at least|minimum(?:\s+of)?)\s+(\d+)\s+days?\s+"
        r"(?:in\s+)?(?:advance\s+)?(?:notice|before)",
        re.IGNORECASE,
    ),
    re.compile(
        r"(\d+)\s+days?\s+before\s+(?:the\s+)?"
        r"(?:renewal|renewing|next\s+charge)",
        re.IGNORECASE,
    ),
)
_ISO_DATE_PATTERN = re.compile(r"\b\d{4}-\d{2}-\d{2}\b")
_AMBIGUOUS_DATE_PATTERN = re.compile(r"\b\d{1,2}/\d{1,2}/\d{4}\b")
_NAMED_DATE_PATTERN = re.compile(
    r"\b(?:January|February|March|April|May|June|July|August|September|October|"
    r"November|December)\s+\d{1,2},\s+\d{4}\b",
    re.IGNORECASE,
)
_TIMEZONE_PATTERN = re.compile(r"\b(?:UTC|GMT|[A-Za-z]+/[A-Za-z_]+)\b")


def _currency_symbol_to_code(symbol: str) -> str:
    return {"$": "USD", "€": "EUR", "£": "GBP"}.get(symbol, "USD")


def _recurrence(text: str, fallback: str | None) -> str | None:
    if fallback:
        return fallback
    lowered = text.lower()
    if "month" in lowered:
        return "monthly"
    if "week" in lowered:
        return "weekly"
    if "year" in lowered or "annual" in lowered:
        return "yearly"
    if "renew" in lowered:
        return "recurring"
    return None


def _notice_match(text: str) -> re.Match[str] | None:
    for pattern in _NOTICE_PATTERNS:
        match = pattern.search(text)
        if match:
            return match
    return None


def _absolute_cancellation_date(text: str) -> tuple[datetime.date | None, str | None, str | None]:
    """Return a date, its exact source text, or an unresolved reason."""

    if "cancel" not in text.lower():
        return None, None, None

    ambiguous = _AMBIGUOUS_DATE_PATTERN.search(text)
    if ambiguous:
        return None, ambiguous.group(0), "Cancellation date format is ambiguous and needs review."

    iso_date = _ISO_DATE_PATTERN.search(text)
    if iso_date:
        try:
            return datetime.strptime(iso_date.group(0), "%Y-%m-%d").date(), iso_date.group(0), None
        except ValueError:
            return None, iso_date.group(0), "Cancellation date is invalid and needs review."

    named_date = _NAMED_DATE_PATTERN.search(text)
    if named_date:
        try:
            return datetime.strptime(named_date.group(0).title(), "%B %d, %Y").date(), named_date.group(0), None
        except ValueError:
            return None, named_date.group(0), "Cancellation date is invalid and needs review."
    return None, None, None


def _timezone(text: str) -> str | None:
    match = _TIMEZONE_PATTERN.search(text)
    return match.group(0) if match else None


def _timeline_key(item: TimelineItem) -> tuple[object, ...]:
    return (
        item.kind,
        item.source_section_id,
        item.timing,
        item.date,
        item.offset_days,
        item.recurrence,
    )


def build_timeline(
    findings: Iterable[ExtractedFinding],
    sections: Iterable[AnalysisSection],
) -> list[TimelineItem]:
    """Build source-linked timeline items without inferring unsupported calendar dates."""

    sections_by_id = {section.section_id: section for section in sections}
    timeline: list[TimelineItem] = []
    emitted: set[tuple[object, ...]] = set()

    def add(item: TimelineItem) -> None:
        key = _timeline_key(item)
        if key not in emitted:
            emitted.add(key)
            timeline.append(item)

    for finding in findings:
        section = sections_by_id.get(finding.source_section_id)
        if section is None:
            continue

        text = section.text
        timezone = _timezone(text)
        source_details = {
            "source_section_id": section.section_id,
            "source_risk_types": [finding.risk_type],
            "source_url": section.source_url,
        }
        trial_match = _TRIAL_PATTERN.search(text)
        if trial_match and finding.risk_type == "automatic_renewal":
            add(
                TimelineItem(
                    kind="trial_ends",
                    timing="relative",
                    relative_to="signup",
                    offset_direction="after",
                    offset_days=int(trial_match.group(1)),
                    timezone=timezone,
                    evidence_quote=trial_match.group(0),
                    assumptions=[
                        "The start date is not stated, so this event remains relative to signup."
                    ],
                    **source_details,
                )
            )

        recurrence = _recurrence(text, finding.attributes.recurrence)
        amount_match = _AMOUNT_PATTERN.search(text)
        amount = finding.attributes.amount or (amount_match.group(2) if amount_match else None)
        currency = finding.attributes.currency or (
            _currency_symbol_to_code(amount_match.group(1)) if amount_match else None
        )
        if finding.risk_type == "automatic_renewal" and recurrence:
            add(
                TimelineItem(
                    kind="recurring_charge",
                    timing="recurring",
                    relative_to="trial_end" if trial_match else "renewal",
                    amount=amount,
                    currency=currency,
                    recurrence=recurrence,
                    timezone=timezone,
                    evidence_quote=finding.evidence_text,
                    assumptions=[
                        "No calendar charge date was inferred because the agreement provides no start date."
                    ],
                    **source_details,
                )
            )

        if finding.risk_type != "cancellation_deadline":
            continue

        absolute_date, date_quote, unresolved_reason = _absolute_cancellation_date(text)
        if unresolved_reason:
            add(
                TimelineItem(
                    kind="cancellation_deadline",
                    timing="unresolved",
                    status="unresolved",
                    timezone=timezone,
                    evidence_quote=date_quote or finding.evidence_text,
                    unresolved_reason=unresolved_reason,
                    **source_details,
                )
            )
            continue
        if absolute_date:
            add(
                TimelineItem(
                    kind="cancellation_deadline",
                    timing="absolute",
                    date=absolute_date,
                    timezone=timezone,
                    evidence_quote=date_quote or finding.evidence_text,
                    **source_details,
                )
            )
            continue

        notice_match = _notice_match(text)
        notice_days = finding.attributes.notice_days or (
            int(notice_match.group(1)) if notice_match else None
        )
        if notice_days is not None:
            add(
                TimelineItem(
                    kind="cancellation_deadline",
                    timing="relative",
                    relative_to="renewal",
                    offset_direction="before",
                    offset_days=notice_days,
                    timezone=timezone,
                    evidence_quote=(notice_match.group(0) if notice_match else finding.evidence_text),
                    assumptions=[
                        "The renewal date is not stated, so this deadline remains relative to renewal."
                    ],
                    **source_details,
                )
            )

    return timeline
