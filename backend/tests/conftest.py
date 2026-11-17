import os
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.db.base import Base
from app.db.session import get_db
from app.dependencies.auth import analysis_limiter, auth_limiter
from app.main import app


@pytest.fixture
def auth_client(monkeypatch, tmp_path):
    test_url = os.environ.get("TEST_DATABASE_URL")
    admin_engine = None
    schema = None
    if test_url:
        url = make_url(test_url)
        if url.get_backend_name() != "postgresql" or not (url.database or "").endswith("_test"):
            raise ValueError(
                "TEST_DATABASE_URL must point to a PostgreSQL database ending in _test"
            )
        schema = f"test_{uuid4().hex}"
        admin_engine = create_engine(url)
        with admin_engine.begin() as connection:
            connection.execute(text(f'CREATE SCHEMA "{schema}"'))
        engine = admin_engine.execution_options(schema_translate_map={None: schema})
    else:
        engine = create_engine(
            f"sqlite:///{(tmp_path / 'auth.db').as_posix()}",
            connect_args={"check_same_thread": False},
        )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_db():
        with factory() as session:
            yield session

    monkeypatch.setattr(settings, "jwt_secret", "test-secret-with-at-least-thirty-two-bytes" * 2)
    monkeypatch.setattr(settings, "auth_rate_limit_per_minute", 1000)
    auth_limiter.attempts.clear()
    analysis_limiter.attempts.clear()
    monkeypatch.setattr(settings, "analysis_rate_limit_per_minute", 1000)
    app.dependency_overrides[get_db] = override_db
    try:
        with TestClient(app) as client:
            yield client, factory
    finally:
        app.dependency_overrides.pop(get_db, None)
        auth_limiter.attempts.clear()
        engine.dispose()
        if admin_engine is not None:
            with admin_engine.begin() as connection:
                connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
            admin_engine.dispose()
