from datetime import UTC, datetime
from uuid import uuid4

from sqlalchemy import func, select

from app.models import Analysis, Commitment, Finding, Reminder
from app.schemas.analysis import AnalysisResponse
from tests.test_auth import ACCOUNT, bearer, register


def request_body(save=False):
    return {
        "source_url": "https://example.test/trial",
        "save_to_history": save,
        "sections": [
            {
                "section_id": "pricing-1",
                "heading": "Trial terms",
                "text": "7-day free trial. After the trial, $49.99 per month will be charged "
                "automatically until cancellation. PRIVATE_UNRELATED_PAGE_TEXT.",
                "source_url": "https://example.test/trial",
            }
        ],
    }


def save(client, tokens):
    response = client.post("/api/v1/analyses", json=request_body(True), headers=bearer(tokens))
    assert response.status_code == 200, response.text
    assert response.json()["analysis_id"]
    return response.json()


def test_only_explicit_authenticated_save_persists(auth_client):
    client, factory = auth_client
    assert client.post("/api/v1/analyses", json=request_body(True)).status_code == 401
    tokens = register(client)
    for headers in [{}, bearer(tokens)]:
        guest = client.post("/api/v1/analyses", json=request_body(), headers=headers)
        assert guest.status_code == 200
        assert guest.json()["analysis_id"] is None
    with factory() as db:
        assert db.scalar(select(func.count()).select_from(Analysis)) == 0
    report = save(client, tokens)
    with factory() as db:
        stored = db.scalar(select(Analysis))
        assert str(stored.user_id) == tokens["user"]["id"]
        assert stored.report == report
        assert "PRIVATE_UNRELATED_PAGE_TEXT" not in str(stored.report)
        assert len(stored.findings) == len(report["findings"])
        assert len(stored.commitments) == len(report["timeline"])
    detail = client.get(f"/api/v1/analyses/{report['analysis_id']}", headers=bearer(tokens))
    assert detail.status_code == 200
    assert detail.json() == report
    assert detail.headers["Cache-Control"] == "no-store"


def test_history_and_summary_are_owner_scoped(auth_client):
    client, _ = auth_client
    first = register(client)
    report = save(client, first)
    second_response = client.post(
        "/api/v1/auth/register",
        json={
            **ACCOUNT,
            "email": "other@example.com",
            "name": "Other",
        },
    )
    second = second_response.json()
    path = f"/api/v1/analyses/{report['analysis_id']}"
    for method in [client.get, client.delete]:
        assert method(path, headers=bearer(second)).status_code == 404
        assert method(f"/api/v1/analyses/{uuid4()}", headers=bearer(second)).status_code == 404
    assert client.get("/api/v1/analyses", headers=bearer(second)).json()["total"] == 0
    empty = client.get("/api/v1/dashboard/summary", headers=bearer(second)).json()
    assert empty["analysis_count"] == empty["finding_count"] == empty["commitment_count"] == 0
    assert empty["average_score"] is None
    summary = client.get("/api/v1/dashboard/summary", headers=bearer(first))
    assert summary.status_code == 200
    assert summary.json()["analysis_count"] == 1
    assert summary.json()["finding_count"] == len(report["findings"])
    assert summary.json()["commitment_count"] == len(report["timeline"])
    assert summary.json()["average_score"] == report["score"]
    assert summary.json()["risk_distribution"][report["risk_band"]] == 1
    for endpoint in ["/api/v1/analyses", path, "/api/v1/dashboard/summary"]:
        assert client.get(endpoint).status_code == 401


def test_pagination_risk_and_date_filters(auth_client):
    client, factory = auth_client
    tokens = register(client)
    report = save(client, tokens)
    with factory.begin() as db:
        stored = db.scalar(select(Analysis))
        stored.created_at = datetime(2025, 1, 15, 12, tzinfo=UTC)
        db.add(
            Analysis(
                user_id=stored.user_id,
                domain="older.test",
                source_url="https://older.test/",
                score=None,
                risk_band=None,
                status="partial",
                created_at=datetime(2024, 1, 15, tzinfo=UTC),
            )
        )
    page = client.get("/api/v1/analyses?limit=1", headers=bearer(tokens)).json()
    assert page["total"] == 2
    assert len(page["items"]) == 1
    assert page["items"][0]["id"] == report["analysis_id"]
    older = client.get("/api/v1/analyses?offset=1&limit=1", headers=bearer(tokens)).json()
    assert older["items"][0]["domain"] == "older.test"
    assert older["items"][0]["report_available"] is False
    filtered = client.get(
        f"/api/v1/analyses?risk_band={report['risk_band']}", headers=bearer(tokens)
    )
    assert filtered.json()["total"] == 1
    dated = client.get(
        "/api/v1/analyses?date_from=2025-01-15&date_to=2025-01-15", headers=bearer(tokens)
    )
    assert dated.json()["total"] == 1
    assert (
        client.get("/api/v1/analyses?date_to=2023-01-01", headers=bearer(tokens)).json()["total"]
        == 0
    )
    for query in [
        "limit=101",
        "offset=-1",
        "risk_band=invalid",
        "date_from=2026-01-01&date_to=2025-01-01",
    ]:
        assert client.get(f"/api/v1/analyses?{query}", headers=bearer(tokens)).status_code == 422
    summary = client.get("/api/v1/dashboard/summary", headers=bearer(tokens)).json()
    assert summary["average_score"] == report["score"]
    assert summary["risk_distribution"]["unscored"] == 1


def test_deletion_removes_related_records(auth_client):
    client, factory = auth_client
    tokens = register(client)
    report = save(client, tokens)
    with factory.begin() as db:
        analysis = db.scalar(select(Analysis))
        db.add(
            Reminder(
                user_id=analysis.user_id,
                commitment_id=analysis.commitments[0].id,
                remind_at=datetime(2030, 1, 1, tzinfo=UTC),
            )
        )
    path = f"/api/v1/analyses/{report['analysis_id']}"
    assert client.delete(path, headers=bearer(tokens)).status_code == 204
    assert client.get(path, headers=bearer(tokens)).status_code == 404
    for model in [Analysis, Finding, Commitment, Reminder]:
        with factory() as db:
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_large_amount_preserves_report_without_overflowing_relational_amount(
    auth_client, monkeypatch
):
    client, factory = auth_client
    tokens = register(client)
    report = AnalysisResponse.model_validate(
        client.post("/api/v1/analyses", json=request_body()).json(),
    )
    event = next(item for item in report.timeline if item.timing == "recurring")
    event.amount = "10000000000.00"

    async def analyze(_request):
        return report

    monkeypatch.setattr("app.api.v1.analyses.analyze_guest_request", analyze)
    saved = save(client, tokens)
    assert (
        next(item for item in saved["timeline"] if item["timing"] == "recurring")["amount"]
        == event.amount
    )
    with factory() as db:
        commitment = db.scalar(select(Commitment).where(Commitment.kind == event.kind))
        assert commitment.amount is None
