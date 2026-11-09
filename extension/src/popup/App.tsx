import { useEffect, useState } from 'react'

import { requestAnalysis } from '../api/client'
import type { AnalysisResponse } from '../api/types'
import type {
  BackgroundToPopupResponse,
  PageContext,
  PopupToBackgroundMessage,
} from '../messaging/protocol'
import './App.css'

type ViewState =
  | { status: 'idle'; context: PageContext | null }
  | { status: 'loading'; context: PageContext | null }
  | { status: 'ready'; context: PageContext }
  | { status: 'error'; context: PageContext | null; message: string }

type AnalysisView =
  | { status: 'idle'; result: null; message: null }
  | { status: 'loading'; result: null; message: null }
  | { status: 'ready'; result: AnalysisResponse; message: null }
  | { status: 'error'; result: null; message: string }

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

export default function App() {
  const [view, setView] = useState<ViewState>({ status: 'loading', context: null })
  const [analysis, setAnalysis] = useState<AnalysisView>({ status: 'idle', result: null, message: null })

  const inspectPage = async () => {
    setView((current) => ({ status: 'loading', context: current.context }))

    try {
      const response = await requestPageContext()
      if (response.ok) {
        setView({ status: 'ready', context: response.data })
      } else {
        setView((current) => ({ status: 'error', context: current.context, message: response.error.message }))
      }
    } catch {
      setView((current) => ({
        status: 'error',
        context: current.context,
        message: 'The extension could not reach the active page.',
      }))
    }
  }

  const analyzePage = async () => {
    if (!view.context) return

    setAnalysis({ status: 'loading', result: null, message: null })
    try {
      const result = await requestAnalysis(view.context)
      setAnalysis({ status: 'ready', result, message: null })
    } catch (error) {
      setAnalysis({
        status: 'error',
        result: null,
        message: error instanceof Error ? error.message : 'The analysis service is unavailable.',
      })
    }
  }

  useEffect(() => {
    let mounted = true

    const loadPageContext = async () => {
      try {
        const response = await requestPageContext()
        if (!mounted) return

        if (response.ok) {
          setView({ status: 'ready', context: response.data })
        } else {
          setView({ status: 'error', context: null, message: response.error.message })
        }
      } catch {
        if (mounted) {
          setView({
            status: 'error',
            context: null,
            message: 'The extension could not reach the active page.',
          })
        }
      }
    }

    void loadPageContext()

    return () => {
      mounted = false
    }
  }, [])

  const context = view.context

  return (
    <main className="popup-shell">
      <header className="popup-header">
        <div className="brand-mark" aria-hidden="true">✓</div>
        <div>
          <p className="eyebrow">BEFORE YOU AGREE</p>
          <h1>Page check</h1>
        </div>
      </header>

      <section className="page-card" aria-live="polite">
        <p className="eyebrow">ACTIVE PAGE</p>
        <h2>{context?.domain ?? 'Checking active tab…'}</h2>
        <p className="page-title">{context?.title ?? 'Waiting for the page context'}</p>
        {context && <p className="page-meta">{context.textLength.toLocaleString()} visible characters</p>}
      </section>

      {view.status === 'error' && <p className="error-message" role="alert">{view.message}</p>}
      {view.status === 'ready' && <p className="success-message">Page context received from the content script.</p>}

      <button className="primary-button" onClick={inspectPage} disabled={view.status === 'loading'}>
        {view.status === 'loading' ? 'Inspecting…' : 'Inspect page'}
      </button>

      <button
        className="secondary-button"
        onClick={analyzePage}
        disabled={!context || view.status === 'loading' || analysis.status === 'loading'}
      >
        {analysis.status === 'loading' ? 'Analyzing…' : 'Analyze preview'}
      </button>

      {analysis.status === 'error' && <p className="error-message" role="alert">{analysis.message}</p>}
      {analysis.status === 'ready' && (
        <section className="analysis-card" aria-live="polite">
          <div className="analysis-heading">
            <div>
              <p className="eyebrow">MOCK ANALYSIS</p>
              <h2>{analysis.result.score ?? '—'}/100</h2>
            </div>
            <span className="risk-badge">{analysis.result.risk_band ?? 'Not assessed'}</span>
          </div>
          {analysis.result.findings.map((finding) => (
            <article className="finding" key={`${finding.evidence.section_id}-${finding.risk_type}`}>
              <strong>{finding.risk_type.replaceAll('_', ' ')}</strong>
              <p>{finding.consequence}</p>
              <blockquote>{finding.evidence.quote}</blockquote>
            </article>
          ))}
          {analysis.result.coverage.warnings.map((warning) => (
            <p className="coverage-warning" key={warning}>{warning}</p>
          ))}
        </section>
      )}

      <p className="disclaimer">
        Analysis is informational support, not legal advice. This chunk uses a deterministic mock response.
      </p>
    </main>
  )
}
