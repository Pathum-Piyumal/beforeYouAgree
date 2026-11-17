from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models import Reminder


def promote_due(db: Session, user_id: UUID | None = None, now: datetime | None = None) -> int:
    """Atomic, retry-safe in-app delivery; acknowledgement remains a separate user action."""
    conditions = [Reminder.status == "scheduled", Reminder.remind_at <= (now or datetime.now(UTC))]
    if user_id is not None:
        conditions.append(Reminder.user_id == user_id)
    result = db.execute(update(Reminder).where(*conditions).values(status="due"))
    db.commit()
    return result.rowcount


def utc(value: datetime) -> datetime:
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
