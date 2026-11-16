import type { PageContext } from '../messaging/protocol'
import {
  parseAnalysisResponse,
  type AnalysisRequest,
  type AnalysisResponse,
  type ApiErrorPayload,
} from './types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '')

export class ApiRequestError extends Error {
  readonly code: string
  readonly requestId: string | undefined

  constructor(message: string, code: string, requestId?: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.code = code
    this.requestId = requestId
  }
}

export async function requestAnalysis(context: PageContext): Promise<AnalysisResponse> {
  const body: AnalysisRequest = {
    source_url: context.url,
    save_to_history: false,
    sections: context.sections.map((section) => ({
      section_id: section.section_id,
      heading: section.heading ?? context.title,
      text: section.text,
      source_url: section.source_url,
    })),
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 10_000)

  try {
    const response = await fetch(`${apiBaseUrl}/analyses`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = (await response.json()) as AnalysisResponse | ApiErrorPayload

    if (!response.ok) {
      const errorPayload = payload as ApiErrorPayload
      throw new ApiRequestError(
        errorPayload.error?.message ?? 'The analysis request failed.',
        errorPayload.error?.code ?? 'API_ERROR',
        errorPayload.error?.request_id,
      )
    }

    try {
      return parseAnalysisResponse(payload)
    } catch {
      throw new ApiRequestError(
        'The analysis service returned an invalid response.',
        'INVALID_API_RESPONSE',
      )
    }
  } catch (error) {
    if (error instanceof ApiRequestError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiRequestError('The analysis request timed out.', 'API_TIMEOUT')
    }
    throw new ApiRequestError('The analysis service is unavailable.', 'API_UNAVAILABLE')
  } finally {
    window.clearTimeout(timeout)
  }
}
