from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Protocol

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, ValidationError

from app.ai.contracts import StructuredExtraction
from app.ai.prompting import EXTRACTION_SCHEMA_VERSION, PROMPT_VERSION
from app.schemas.analysis import AnalysisSection


class ProviderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_url: AnyHttpUrl
    sections: list[AnalysisSection] = Field(min_length=1, max_length=50)
    prompt: str = Field(min_length=1, max_length=60_000)
    prompt_version: str = PROMPT_VERSION
    extraction_schema_version: str = EXTRACTION_SCHEMA_VERSION


class ProviderUsage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    input_characters: int = Field(ge=0)
    output_findings: int = Field(ge=0)
    estimated_cost_usd: float = Field(ge=0)


class ProviderResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")

    extraction: StructuredExtraction
    model_id: str = Field(min_length=1, max_length=100)
    prompt_version: str = Field(min_length=1, max_length=100)
    extraction_schema_version: str = Field(min_length=1, max_length=100)
    usage: ProviderUsage


class LLMProvider(Protocol):
    async def extract(self, request: ProviderRequest) -> ProviderResponse | dict[str, object]:
        """Return structured extraction without calculating a final risk score."""


class ProviderError(RuntimeError):
    code = "ANALYSIS_PROVIDER_ERROR"
    retryable = False


class ProviderTimeoutError(ProviderError):
    code = "ANALYSIS_PROVIDER_TIMEOUT"
    retryable = True


class ProviderUnavailableError(ProviderError):
    code = "ANALYSIS_PROVIDER_UNAVAILABLE"
    retryable = True


class ProviderResponseError(ProviderError):
    code = "ANALYSIS_PROVIDER_INVALID_RESPONSE"


class ProviderBudgetError(ProviderError):
    code = "ANALYSIS_PROVIDER_BUDGET_EXCEEDED"


@dataclass(frozen=True)
class ProviderCallResult:
    response: ProviderResponse
    attempts: int


async def call_provider_with_policy(
    provider: LLMProvider,
    request: ProviderRequest,
    *,
    timeout_seconds: float,
    max_retries: int,
    max_cost_usd: float,
) -> ProviderCallResult:
    """Apply timeout, bounded retry, response validation, and cost limits to a provider."""

    attempt_limit = max(1, max_retries + 1)
    for attempt in range(1, attempt_limit + 1):
        try:
            raw_response = await asyncio.wait_for(
                provider.extract(request),
                timeout=max(0.1, timeout_seconds),
            )
            try:
                response = ProviderResponse.model_validate(raw_response)
            except ValidationError as error:
                raise ProviderResponseError(
                    "Provider returned an invalid structured response"
                ) from error
            if response.usage.estimated_cost_usd > max_cost_usd:
                raise ProviderBudgetError("Provider usage exceeded the configured cost limit")
            return ProviderCallResult(response=response, attempts=attempt)
        except asyncio.TimeoutError as error:
            provider_error: ProviderError = ProviderTimeoutError(
                "The analysis provider did not respond before the timeout"
            )
            provider_error.__cause__ = error
        except ProviderError as error:
            provider_error = error

        if not provider_error.retryable or attempt == attempt_limit:
            raise provider_error
        await asyncio.sleep(min(0.5, 0.05 * (2 ** (attempt - 1))))

    raise ProviderUnavailableError("The analysis provider could not be reached")
