from app.db.base import Base
from app.models import Analysis, Commitment, Finding, RefreshSession, Reminder, User


def test_initial_schema_contains_all_persistence_entities() -> None:
    assert set(Base.metadata.tables) == {
        "users",
        "analyses",
        "findings",
        "commitments",
        "reminders",
        "refresh_sessions",
    }
    assert Analysis.__tablename__ == "analyses"
    assert Finding.__tablename__ == "findings"
    assert Commitment.__tablename__ == "commitments"
    assert Reminder.__tablename__ == "reminders"
    assert RefreshSession.__tablename__ == "refresh_sessions"
    assert User.__tablename__ == "users"
