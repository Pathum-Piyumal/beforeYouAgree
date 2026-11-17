from datetime import UTC, datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Response
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.dependencies.auth import CurrentUser, Database
from app.models import Analysis, Commitment, Reminder
from app.schemas.reminders import (
    CommitmentPage,
    CommitmentView,
    ReminderCreate,
    ReminderPage,
    ReminderTimes,
    ReminderView,
)
from app.services.reminders import promote_due, utc

router = APIRouter(tags=["reminders"])


def own_reminder(db, user, reminder_id):
    item = db.scalar(
        select(Reminder)
        .where(Reminder.id == reminder_id, Reminder.user_id == user.id)
        .with_for_update()
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Account reminder not found")
    return item


@router.get("/commitments", response_model=CommitmentPage)
def commitments(
    db: Database,
    user: CurrentUser,
    response: Response,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    response.headers["Cache-Control"] = "no-store"
    condition = Analysis.user_id == user.id
    count = db.scalar(select(func.count()).select_from(Commitment).join(Analysis).where(condition))
    rows = db.execute(
        select(Commitment, Analysis.source_url)
        .join(Analysis)
        .where(condition)
        .order_by(Commitment.created_at.desc(), Commitment.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return CommitmentPage(
        items=[
            CommitmentView(
                id=item.id,
                analysis_id=item.analysis_id,
                kind=item.kind,
                source_url=url,
                amount=str(item.amount) if item.amount is not None else None,
                currency=item.currency,
            )
            for item, url in rows
        ],
        total=count or 0,
        offset=offset,
        limit=limit,
    )


@router.get("/reminders", response_model=ReminderPage)
def reminders(
    db: Database,
    user: CurrentUser,
    response: Response,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    response.headers["Cache-Control"] = "no-store"
    promote_due(db, user.id)
    condition = Reminder.user_id == user.id
    count = db.scalar(select(func.count()).select_from(Reminder).where(condition))
    items = db.scalars(
        select(Reminder)
        .where(condition)
        .order_by(Reminder.remind_at, Reminder.id)
        .offset(offset)
        .limit(limit)
    ).all()
    return ReminderPage(items=items, total=count or 0, offset=offset, limit=limit)


def replay(existing, request):
    if (
        existing.commitment_id != request.commitment_id
        or utc(existing.remind_at) != utc(request.remind_at)
        or existing.event_at is None
        or utc(existing.event_at) != utc(request.event_at)
        or existing.timezone != request.timezone
        or existing.event_description != request.event_description
        or existing.status == "cancelled"
    ):
        raise HTTPException(status_code=409, detail="Reminder request key was already used")
    return existing


@router.post("/reminders", response_model=ReminderView, status_code=201)
def create_reminder(request: ReminderCreate, db: Database, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    key = str(request.idempotency_key)
    existing = db.scalar(
        select(Reminder).where(Reminder.user_id == user.id, Reminder.idempotency_key == key)
    )
    if existing:
        return replay(existing, request)
    commitment = db.scalar(
        select(Commitment)
        .join(Analysis)
        .where(Commitment.id == request.commitment_id, Analysis.user_id == user.id)
    )
    if commitment is None:
        raise HTTPException(status_code=404, detail="Commitment not found")
    if request.remind_at <= datetime.now(UTC):
        raise HTTPException(status_code=422, detail="Choose a future reminder time")
    item = Reminder(
        user_id=user.id,
        commitment_id=commitment.id,
        idempotency_key=key,
        **request.model_dump(exclude={"confirmed", "commitment_id", "idempotency_key"}),
    )
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        existing = db.scalar(
            select(Reminder).where(Reminder.user_id == user.id, Reminder.idempotency_key == key)
        )
        if existing:
            return replay(existing, request)
        raise HTTPException(status_code=409, detail="Commitment changed; refresh and try again")
    return item


@router.patch("/reminders/{reminder_id}", response_model=ReminderView)
def edit_reminder(
    reminder_id: UUID, request: ReminderTimes, db: Database, user: CurrentUser, response: Response
):
    response.headers["Cache-Control"] = "no-store"
    item = own_reminder(db, user, reminder_id)
    if item.status == "cancelled":
        raise HTTPException(status_code=409, detail="Cancelled reminders cannot be edited")
    if request.remind_at <= datetime.now(UTC):
        raise HTTPException(status_code=422, detail="Choose a future reminder time")
    for key, value in request.model_dump(exclude={"confirmed"}).items():
        setattr(item, key, value)
    item.status = "scheduled"
    item.sent_at = None
    db.commit()
    return item


@router.post("/reminders/{reminder_id}/acknowledge", response_model=ReminderView)
def acknowledge(reminder_id: UUID, db: Database, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    promote_due(db, user.id)
    item = own_reminder(db, user, reminder_id)
    if item.status not in {"due", "acknowledged"}:
        raise HTTPException(status_code=409, detail="Only due reminders can be acknowledged")
    if item.status == "due":
        item.status = "acknowledged"
        item.sent_at = datetime.now(UTC)
        db.commit()
    return item


@router.delete("/reminders/{reminder_id}", status_code=204)
def cancel_reminder(reminder_id: UUID, db: Database, user: CurrentUser, response: Response):
    response.headers["Cache-Control"] = "no-store"
    item = own_reminder(db, user, reminder_id)
    item.status = "cancelled"
    db.commit()
