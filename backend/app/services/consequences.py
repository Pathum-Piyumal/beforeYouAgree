from __future__ import annotations

from app.ai.contracts import ExtractedFinding


def _charge_description(finding: ExtractedFinding) -> str:
    attributes = finding.attributes
    if attributes.amount and attributes.currency:
        recurrence = f" {attributes.recurrence}" if attributes.recurrence else ""
        return f"a recurring charge of {attributes.amount} {attributes.currency}{recurrence}"
    if attributes.recurrence:
        return f"a {attributes.recurrence} recurring charge"
    return "a recurring charge"


def generate_consequence(finding: ExtractedFinding) -> str:
    """Return neutral, deterministic wording for a validated finding."""

    if finding.risk_type == "automatic_renewal":
        charge = _charge_description(finding)
        if finding.attributes.duration_days is not None:
            return (
                f"After the {finding.attributes.duration_days}-day trial, {charge} may begin "
                "unless you cancel."
            )
        return f"The subscription may renew automatically and create {charge} unless you cancel."

    if finding.risk_type == "cancellation_deadline":
        if finding.attributes.notice_days is not None:
            return (
                f"Cancellation may require {finding.attributes.notice_days} days' notice before "
                "renewal or the next charge."
            )
        return "Cancellation may need to be completed by the stated deadline."

    return finding.consequence
