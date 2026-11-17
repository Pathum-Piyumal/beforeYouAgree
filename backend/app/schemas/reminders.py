from datetime import UTC, datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, field_validator, model_validator


class ReminderTimes(BaseModel):
    model_config = ConfigDict(extra="forbid")

    remind_at: AwareDatetime
    event_at: AwareDatetime
    timezone: str = Field(min_length=1, max_length=80)
    event_description: str = Field(min_length=1, max_length=280)
    confirmed: Literal[True]

    @field_validator("remind_at", "event_at", mode="after")
    @classmethod
    def normalize_utc(cls, value):
        return value.astimezone(UTC)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ValueError("Use a valid IANA timezone") from error
        return value

    @field_validator("event_description")
    @classmethod
    def valid_note(cls, value):
        if not value.strip():
            raise ValueError("Enter an event note")
        return value.strip()

    @model_validator(mode="after")
    def valid_times(self):
        if self.remind_at >= self.event_at:
            raise ValueError("Reminder time must precede the confirmed event time")
        return self


class ReminderCreate(ReminderTimes):
    commitment_id: UUID
    idempotency_key: UUID


class ReminderView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    commitment_id: UUID
    remind_at: datetime
    event_at: datetime | None
    timezone: str
    event_description: str
    status: Literal["scheduled", "due", "acknowledged", "cancelled"]
    sent_at: datetime | None

    @field_validator("remind_at", "event_at", "sent_at", mode="after")
    @classmethod
    def utc_time(cls, value):
        if value is None:
            return None
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


class ReminderPage(BaseModel):
    items: list[ReminderView]
    total: int
    offset: int
    limit: int


class CommitmentView(BaseModel):
    id: UUID
    analysis_id: UUID
    kind: str
    source_url: str
    amount: str | None
    currency: str | None


class CommitmentPage(BaseModel):
    items: list[CommitmentView]
    total: int
    offset: int
    limit: int
