from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Before You Agree API"
    app_environment: str = "development"
    api_prefix: str = "/api/v1"
    database_url: str = (
        "postgresql+psycopg2://before_you_agree:before_you_agree@localhost:5432/before_you_agree"
    )
    jwt_secret: str = "development-only-change-me"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=15, ge=1, le=60)
    refresh_token_expire_days: int = Field(default=30, ge=1, le=90)
    auth_rate_limit_per_minute: int = Field(default=20, ge=1)
    analysis_rate_limit_per_minute: int = Field(default=30, ge=1)
    llm_api_key: SecretStr | None = None
    llm_provider: Literal["mock", "openai"] = "mock"
    llm_model: str = ""
    llm_timeout_seconds: float = Field(default=30, gt=0, le=120)
    llm_max_retries: int = Field(default=2, ge=0, le=3)
    llm_max_cost_usd: float = Field(default=0.05, gt=0)
    llm_max_output_tokens: int = Field(default=4096, ge=256, le=16384)
    llm_input_cost_per_million: float = Field(default=0, ge=0)
    llm_output_cost_per_million: float = Field(default=0, ge=0)
    cors_origins: str = "http://localhost:5173"

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parents[2] / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
    )

    @model_validator(mode="after")
    def validate_auth_settings(self) -> Settings:
        if self.llm_provider == "openai" and (
            not self.llm_api_key
            or not self.llm_api_key.get_secret_value()
            or not self.llm_model
            or self.llm_input_cost_per_million <= 0
            or self.llm_output_cost_per_million <= 0
        ):
            raise ValueError(
                "Hosted AI requires an API key, model, and positive token price limits"
            )
        if self.jwt_algorithm != "HS256":
            raise ValueError("Only HS256 is supported for access tokens")
        if self.app_environment != "development" and (
            len(self.jwt_secret.encode()) < 32
            or self.jwt_secret
            in {"development-only-change-me", "replace-with-a-long-development-only-secret"}
        ):
            raise ValueError("Set a unique JWT_SECRET of at least 32 bytes outside development")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
