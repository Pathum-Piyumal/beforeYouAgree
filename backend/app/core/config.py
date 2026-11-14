from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Before You Agree API"
    app_environment: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = (
        "postgresql+psycopg2://before_you_agree:before_you_agree@localhost:5432/"
        "before_you_agree"
    )
    jwt_secret: str = "development-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    llm_api_key: str | None = None
    llm_timeout_seconds: float = 30.0
    cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
