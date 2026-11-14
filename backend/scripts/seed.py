from __future__ import annotations

from decimal import Decimal

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models import Analysis, Commitment, Finding, User


SEED_EMAIL = "demo@beforeyouagree.local"


def seed() -> None:
    with SessionLocal.begin() as session:
        user = session.scalar(select(User).where(User.email == SEED_EMAIL))
        if user is None:
            user = User(
                name="Synthetic Demo User",
                email=SEED_EMAIL,
                password_hash="synthetic-seed-only",
            )
            session.add(user)
            session.flush()

        existing_analysis = session.scalar(
            select(Analysis).where(
                Analysis.user_id == user.id,
                Analysis.domain == "demo.beforeyouagree.local",
            )
        )
        if existing_analysis is not None:
            return

        analysis = Analysis(
            user_id=user.id,
            domain="demo.beforeyouagree.local",
            source_url="https://demo.beforeyouagree.local/trial",
            score=68,
            risk_band="high",
            status="complete",
            score_version="v1",
        )
        finding = Finding(
            category="subscription",
            risk_type="automatic_renewal",
            severity="high",
            consequence="A recurring charge may begin after the synthetic trial unless cancelled.",
            evidence_excerpt="After the trial, a monthly charge begins automatically until cancellation.",
            source_url="https://demo.beforeyouagree.local/trial",
            source_locator="trial-terms",
            confidence=1.0,
        )
        commitment = Commitment(
            kind="recurring_charge",
            amount=Decimal("49.99"),
            currency="USD",
            relative_rule="monthly after trial end",
            timezone="UTC",
            status="upcoming",
            finding=finding,
        )
        analysis.findings.append(finding)
        analysis.commitments.append(commitment)
        session.add(analysis)


if __name__ == "__main__":
    seed()
