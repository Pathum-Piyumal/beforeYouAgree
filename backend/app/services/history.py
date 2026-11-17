import json
from decimal import Decimal, InvalidOperation
from uuid import uuid4

from sqlalchemy.orm import Session

from app.models import Analysis, Commitment, Finding, User
from app.schemas.analysis import AnalysisRequest, AnalysisResponse


def normalized_amount(value: str | None) -> Decimal | None:
    # The report retains the provider's exact amount even when it cannot fit
    # the relational Numeric(12, 2) projection.
    if value is None:
        return None
    try:
        amount = Decimal(value)
        if amount.is_finite() and abs(amount) < Decimal("10000000000"):
            rounded = amount.quantize(Decimal("0.01"))
            return rounded if abs(rounded) < Decimal("10000000000") else None
    except InvalidOperation:
        pass
    return None


def save_analysis(
    db: Session,
    user: User,
    request: AnalysisRequest,
    report: AnalysisResponse,
) -> AnalysisResponse:
    analysis_id = uuid4()
    saved = report.model_copy(update={"analysis_id": str(analysis_id)})
    analysis = Analysis(
        id=analysis_id,
        user_id=user.id,
        domain=request.source_url.host,
        source_url=str(request.source_url),
        score=saved.score,
        risk_band=saved.risk_band,
        status=saved.status,
        score_version=saved.score_version,
        report=saved.model_dump(mode="json"),
    )
    findings = {}
    for item in saved.findings:
        finding = Finding(
            category=item.category,
            risk_type=item.risk_type,
            severity=item.severity,
            consequence=item.consequence,
            evidence_excerpt=item.evidence.quote,
            source_url=str(item.evidence.source_url),
            source_locator=item.evidence.section_id,
        )
        analysis.findings.append(finding)
        findings[(item.evidence.section_id, item.risk_type)] = finding
    for item in saved.timeline:
        finding = next(
            (
                findings[(item.source_section_id, risk_type)]
                for risk_type in item.source_risk_types
                if (item.source_section_id, risk_type) in findings
            ),
            None,
        )
        analysis.commitments.append(
            Commitment(
                kind=item.kind,
                amount=normalized_amount(item.amount),
                currency=item.currency,
                relative_rule=json.dumps(item.model_dump(mode="json")),
                timezone=item.timezone,
                status=item.status,
                finding=finding,
            )
        )
    db.add(analysis)
    db.commit()
    return saved
