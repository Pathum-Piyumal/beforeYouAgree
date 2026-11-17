import type { PageContext } from '../messaging/protocol'
import { account } from '../account/client'
import {
  parseAnalysisResponse,
  type AnalysisRequest,
  type AnalysisResponse,
  type ApiErrorPayload,
} from './types'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '')
const configuredTimeout = Number(import.meta.env.VITE_ANALYSIS_TIMEOUT_MS || 120_000)
const analysisTimeout = Number.isFinite(configuredTimeout) && configuredTimeout >= 10_000
  && configuredTimeout <= 600_000 ? configuredTimeout : 120_000

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

export async function requestAnalysis(context: PageContext, saveToHistory = false): Promise<AnalysisResponse> {
  const body: AnalysisRequest = {
    source_url: context.url,
    save_to_history: saveToHistory,
    sections: context.sections.map((section) => ({
      section_id: section.section_id,
      heading: section.heading ?? context.title,
      text: section.text,
      source_url: section.source_url,
    })),
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), analysisTimeout)

  try {
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Request-ID': crypto.randomUUID(),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    }
    const response = saveToHistory
      ? await account.request('/analyses', options)
      : await fetch(`${apiBaseUrl}/analyses`, options)
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
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ApiRequestError('The analysis request timed out.', 'API_TIMEOUT')
    }
    throw new ApiRequestError(error instanceof Error ? error.message : 'The analysis service is unavailable.', 'API_UNAVAILABLE')
  } finally {
    window.clearTimeout(timeout)
  }
}
