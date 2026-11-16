import { useEffect, useState } from 'react'

import { requestAnalysis } from '../api/client'
import { parseAnalysisResponse, type AnalysisResponse } from '../api/types'
import type {
  BackgroundToPopupResponse,
  PageContext,
  PopupToBackgroundMessage,
} from '../messaging/protocol'
import { AnalysisReport } from './components/AnalysisReport'
import './App.css'

type PageView =
  | { status: 'loading'; context: PageContext | null }
  | { status: 'ready'; context: PageContext }
  | { status: 'error'; context: PageContext | null; message: string }

type AnalysisView =
  | { status: 'idle'; result: null; message: null }
  | { status: 'loading'; result: null; message: null }
  | { status: 'success' | 'partial' | 'empty'; result: AnalysisResponse; message: null }
  | { status: 'error'; result: null; message: string }

type CompletedAnalysisStatus = 'success' | 'partial' | 'empty'

const cacheTtlMilliseconds = 5 * 60 * 1000

function requestPageContext(): Promise<BackgroundToPopupResponse> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.resolve({
      ok: false,
      error: {
        code: 'EXTENSION_RUNTIME_ERROR',
        message: 'Open this page from the installed Chrome extension.',
      },
    })
  }

  const message: PopupToBackgroundMessage = {
    type: 'GET_ACTIVE_PAGE_CONTEXT',
    requestId: crypto.randomUUID(),
  }
  return chrome.runtime.sendMessage(message)
}

function cacheKey(url: string): string {
  return `before-you-agree:analysis:${url}`
}

function loadCachedAnalysis(url: string): AnalysisResponse | null {
  try {
    const cached = sessionStorage.getItem(cacheKey(url))
    if (!cached) return null
    const record = JSON.parse(cached) as { expiresAt?: unknown; result?: unknown }
    if (typeof record.expiresAt !== 'number' || record.expiresAt <= Date.now()) {
      sessionStorage.removeItem(cacheKey(url))
      return null
    }
    return parseAnalysisResponse(record.result)
  } catch {
    sessionStorage.removeItem(cacheKey(url))
    return null
  }
}

function saveCachedAnalysis(url: string, result: AnalysisResponse): void {
  try {
    sessionStorage.setItem(
      cacheKey(url),
      JSON.stringify({ expiresAt: Date.now() + cacheTtlMilliseconds, result }),
    )
  } catch {
    return
  }
}

function resultState(result: AnalysisResponse): CompletedAnalysisStatus {
  if (result.status === 'insufficient_evidence' || result.findings.length === 0) return 'empty'
  return result.status === 'partial' || result.score_coverage !== 'complete' ? 'partial' : 'success'
}

export default function App() {
  const [pageView, setPageView] = useState<PageView>({ status: 'loading', context: null })
  const [analysisView, setAnalysisView] = useState<AnalysisView>({
    status: 'idle',
    result: null,
    message: null,
  })

  const inspectPage = async () => {
    setPageView((current) => ({ status: 'loading', context: current.context }))

    try {
      const response = await requestPageContext()
      if (response.ok) {
        setPageView({ status: 'ready', context: response.data })
        setAnalysisView({ status: 'idle', result: null, message: null })
      } else {
        setPageView((current) => ({
          status: 'error',
          context: current.context,
          message: response.error.message,
        }))
      }
    } catch {
      setPageView((current) => ({
        status: 'error',
        context: current.context,
        message: 'The extension could not reach the active page.',
      }))
    }
  }

  const analyzePage = async (forceRefresh = false) => {
    const context = pageView.context
    if (!context || analysisView.status === 'loading') return

    if (!forceRefresh) {
      const cached = loadCachedAnalysis(context.url)
      if (cached) {
        setAnalysisView({ status: resultState(cached), result: cached, message: null })
        return
      }
    }

    setAnalysisView({ status: 'loading', result: null, message: null })
    try {
      const result = await requestAnalysis(context)
      saveCachedAnalysis(context.url, result)
      setAnalysisView({ status: resultState(result), result, message: null })
    } catch (error) {
      setAnalysisView({
        status: 'error',
        result: null,
        message: error instanceof Error ? error.message : 'The analysis service is unavailable.',
      })
    }
  }

  useEffect(() => {
    let active = true

    const loadPageContext = async () => {
      try {
        const response = await requestPageContext()
        if (!active) return
        if (response.ok) {
          setPageView({ status: 'ready', context: response.data })
        } else {
          setPageView({ status: 'error', context: null, message: response.error.message })
        }
      } catch {
        if (active) {
          setPageView({
            status: 'error',
            context: null,
            message: 'The extension could not reach the active page.',
          })
        }
      }
    }

    void loadPageContext()
    return () => { active = false }
  }, [])

  const context = pageView.context
  const result = analysisView.status === 'success' || analysisView.status === 'partial' || analysisView.status === 'empty'
    ? analysisView.result
    : null

  return (
    <main className="popup-shell" aria-busy={pageView.status === 'loading' || analysisView.status === 'loading'}>
      <header className="popup-header">
        <div className="brand-mark" aria-hidden="true">✓</div>
        <div>
          <p className="eyebrow">BEFORE YOU AGREE</p>
          <h1>Understand this page</h1>
        </div>
      </header>

      <section className="page-card" aria-live="polite">
        <p className="eyebrow">ACTIVE PAGE</p>
        <h2>{context?.domain ?? 'Checking active tab...'}</h2>
        <p className="page-title">{context?.title ?? 'Waiting for the page context'}</p>
        {context && <p className="page-meta">{context.textLength.toLocaleString()} visible characters ready to review</p>}
      </section>

      {pageView.status === 'error' && <p className="error-message" role="alert">{pageView.message}</p>}

      <div className="action-row">
        <button className="secondary-button" type="button" onClick={inspectPage} disabled={pageView.status === 'loading'}>
          {pageView.status === 'loading' ? 'Inspecting...' : 'Inspect page'}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => void analyzePage(analysisView.status !== 'idle')}
          disabled={!context || pageView.status === 'loading' || analysisView.status === 'loading'}
        >
          {analysisView.status === 'loading' ? 'Analyzing...' : result ? 'Analyze again' : 'Analyze page'}
        </button>
      </div>

      {analysisView.status === 'loading' && (
        <section className="loading-state" role="status">
          <span className="loading-dot" aria-hidden="true" />
          <div><strong>Analyzing page terms</strong><p>Looking for supported consequences and commitments.</p></div>
        </section>
      )}

      {analysisView.status === 'error' && (
        <section className="error-state" role="alert">
          <strong>Analysis could not be completed</strong>
          <p>{analysisView.message}</p>
          <button className="secondary-button" type="button" onClick={() => void analyzePage(true)} disabled={!context}>Retry analysis</button>
        </section>
      )}

      {result && <AnalysisReport result={result} />}

      <p className="disclaimer">
        This is an informational aid, not legal advice. It can miss clauses or misunderstand incomplete page text.
      </p>
    </main>
  )
}
