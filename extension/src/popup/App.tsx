import { useEffect, useRef, useState } from 'react'
import { account, dashboardUrl, onAccountChange } from '../account/client'
import type { UserProfile } from '../account/session'

import { requestAnalysis } from '../api/client'
import { parseAnalysisResponse, type AnalysisResponse } from '../api/types'
import type {
  BackgroundToPopupResponse,
  PageContext,
  PopupToBackgroundMessage,
} from '../messaging/protocol'
import {
  createLocalReminder,
  deleteLocalReminder,
  listLocalReminders,
  updateLocalReminder,
} from '../reminders/client'
import type { LocalReminder } from '../reminders/types'
import { AnalysisReport } from './components/AnalysisReport'
import { ReminderForm, type ReminderTarget } from './components/ReminderForm'
import { ReminderList } from './components/ReminderList'
import { ManualInput } from './components/ManualInput'
import { describeTimelineEvent as timelineEventDescription, type TimelineEvent } from './components/timelineText'
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
type ReminderComposer = { target: ReminderTarget; existingReminder: LocalReminder | null; idempotencyKey: string }

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

async function cacheKey(context: PageContext): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([context.url, context.sections]))
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  return `before-you-agree:analysis:${Array.from(new Uint8Array(hash)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function loadCachedAnalysis(url: string): AnalysisResponse | null {
  try {
    const cached = sessionStorage.getItem(url)
    if (!cached) return null
    const record = JSON.parse(cached) as { expiresAt?: unknown; result?: unknown }
    if (typeof record.expiresAt !== 'number' || record.expiresAt <= Date.now()) {
      sessionStorage.removeItem(url)
      return null
    }
    return parseAnalysisResponse(record.result)
  } catch {
    sessionStorage.removeItem(url)
    return null
  }
}

function saveCachedAnalysis(url: string, result: AnalysisResponse): void {
  try {
    sessionStorage.setItem(
      url,
      JSON.stringify({ expiresAt: Date.now() + cacheTtlMilliseconds, result: { ...result, analysis_id: null } }),
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
  const [reminders, setReminders] = useState<LocalReminder[]>([])
  const [reminderComposer, setReminderComposer] = useState<ReminderComposer | null>(null)
  const [reminderNotice, setReminderNotice] = useState<string | null>(null)
  const [user, setUser] = useState<UserProfile | null>(null)
  const [saveToHistory, setSaveToHistory] = useState(false)
  const [consent, setConsent] = useState(false)
  const analysisRequest = useRef(0)
  const contextRequest = useRef(0)

  const inspectPage = async () => {
    const request = ++contextRequest.current
    ++analysisRequest.current
    setConsent(false)
    setPageView((current) => ({ status: 'loading', context: current.context }))

    try {
      const response = await requestPageContext()
      if (request !== contextRequest.current) return
      if (response.ok) {
        setPageView({ status: 'ready', context: response.data })
        setAnalysisView({ status: 'idle', result: null, message: null })
        setReminderComposer(null)
      } else {
        setPageView((current) => ({
          status: 'error',
          context: current.context,
          message: response.error.message,
        }))
      }
    } catch {
      if (request !== contextRequest.current) return
      setPageView((current) => ({
        status: 'error',
        context: current.context,
        message: 'The extension could not reach the active page.',
      }))
    }
  }

  const analyzePage = async (forceRefresh = false) => {
    const context = pageView.context
    if (!context || !consent || analysisView.status === 'loading') return
    const request = ++analysisRequest.current
    setAnalysisView({ status: 'loading', result: null, message: null })
    try {
      const key = await cacheKey(context)
      if (request !== analysisRequest.current) return
      if (!forceRefresh && !saveToHistory) {
        const cached = loadCachedAnalysis(key)
        if (cached) {
          setAnalysisView({ status: resultState(cached), result: cached, message: null })
          return
        }
      }
      const result = await requestAnalysis(context, saveToHistory)
      if (request !== analysisRequest.current) return
      saveCachedAnalysis(key, result)
      setAnalysisView({ status: resultState(result), result, message: null })
    } catch (error) {
      if (request !== analysisRequest.current) return
      setAnalysisView({
        status: 'error',
        result: null,
        message: error instanceof Error ? error.message : 'The analysis service is unavailable.',
      })
    }
  }

  const openReminderComposer = (event: TimelineEvent) => {
    setReminderNotice(null)
    setReminderComposer({
      target: {
        kind: event.kind,
        description: timelineEventDescription(event),
        sourceSectionId: event.source_section_id,
      },
      existingReminder: null,
      idempotencyKey: crypto.randomUUID(),
    })
  }

  const saveReminder = async (values: { remindAt: string; timezone: string; eventDescription: string }) => {
    const context = pageView.context
    if (!context || !reminderComposer) throw new Error('The active page is unavailable.')

    const response = reminderComposer.existingReminder
      ? await updateLocalReminder(reminderComposer.existingReminder.id, {
          remindAt: values.remindAt,
          timezone: values.timezone,
          eventDescription: values.eventDescription,
        })
      : await createLocalReminder({
          sourceUrl: context.url,
          sourceTitle: context.title,
          eventKind: reminderComposer.target.kind,
          eventDescription: values.eventDescription,
          sourceSectionId: reminderComposer.target.sourceSectionId,
          remindAt: values.remindAt,
          timezone: values.timezone,
          idempotencyKey: reminderComposer.idempotencyKey,
        })

    if (!response.ok) throw new Error(response.error.message)
    setReminders((current) => {
      const withoutUpdated = current.filter((reminder) => reminder.id !== response.data.id)
      return [...withoutUpdated, response.data].sort((left, right) => left.remindAt.localeCompare(right.remindAt))
    })
    setReminderComposer(null)
    setReminderNotice(reminderComposer.existingReminder ? 'Reminder updated in this browser.' : 'Reminder saved in this browser.')
  }

  const cancelReminder = async (reminder: LocalReminder) => {
    try {
      const response = await deleteLocalReminder(reminder.id)
      if (!response.ok) {
        setReminderNotice(response.error.message)
        return
      }
      setReminders((current) => current.map((item) => item.id === response.data.id ? response.data : item))
      setReminderNotice('Reminder cancelled.')
    } catch {
      setReminderNotice('The reminder could not be cancelled. Try again.')
    }
  }

  useEffect(() => {
    let active = true
    void account.user().then((profile) => { if (active) setUser(profile) }).catch(() => undefined)
    const unsubscribe = onAccountChange((profile, previous) => {
      setUser(profile)
      if (profile && profile.id === previous?.id) return
      ++analysisRequest.current
      setSaveToHistory(false)
      setAnalysisView({ status: 'idle', result: null, message: null })
    })
    return () => { active = false; unsubscribe() }
  }, [])

  useEffect(() => {
    let active = true
    const request = ++contextRequest.current
    const loadPageContext = async () => {
      try {
        const response = await requestPageContext()
        if (!active || request !== contextRequest.current) return
        if (response.ok) {
          setPageView({ status: 'ready', context: response.data })
        } else {
          setPageView({ status: 'error', context: null, message: response.error.message })
        }
      } catch {
        if (active && request === contextRequest.current) {
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

  useEffect(() => {
    const sourceUrl = pageView.context?.url
    if (!sourceUrl) return

    let active = true
    void listLocalReminders(sourceUrl).then((response) => {
      if (!active) return
      if (response.ok) {
        setReminders(response.data)
      } else {
        setReminderNotice(response.error.message)
      }
    }).catch(() => {
      if (active) setReminderNotice('Saved reminders could not be read.')
    })
    return () => { active = false }
  }, [pageView.context?.url])

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

      <div className="section-heading">
        <span className="muted-copy">{user ? `Signed in as ${user.name}` : 'Using guest mode'}</span>
        <a className="text-button" href={dashboardUrl()} target="_blank" rel="noreferrer">{user ? 'Open dashboard' : 'Sign in / dashboard'}</a>
      </div>

      <section className="page-card" aria-live="polite">
        <p className="eyebrow">ACTIVE PAGE</p>
        <h2>{context?.domain ?? 'Checking active tab...'}</h2>
        <p className="page-title">{context?.title ?? 'Waiting for the page context'}</p>
        {context && <p className="page-meta">{context.textLength.toLocaleString()} visible characters ready to review</p>}
      </section>

      {pageView.status === 'error' && <p className="error-message" role="alert">{pageView.message}</p>}

      <ManualInput key={context?.url ?? 'manual'} sourceUrl={context?.url ?? ''} onUse={(manual) => {
        ++contextRequest.current; ++analysisRequest.current
        setPageView({ status: 'ready', context: manual }); setConsent(false)
        setAnalysisView({ status: 'idle', result: null, message: null }); setReminderComposer(null)
      }} />
      {context && <details className="text-review"><summary>Review all text to be sent ({context.textLength.toLocaleString()} characters)</summary>
        {context.sections.map((section) => <div key={section.section_id}><h3>{section.heading ?? 'Agreement section'}</h3><p>{section.text}</p></div>)}
      </details>}
      {!!context?.policyLinks?.length && <details><summary>Linked policies — open and inspect separately</summary><ul>{context.policyLinks.map((link, index) => <li key={index}><a href={link.url} target="_blank" rel="noreferrer">{link.label}</a></li>)}</ul></details>}
      <label className="confirmation-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} disabled={!context || analysisView.status === 'loading'} />I reviewed the text and want to send it for analysis.</label>
      <p className="disclaimer">Analysis sends the reviewed sections and source URL to your configured backend. If hosted AI is enabled, it forwards them to OpenAI. Guest reports are not saved to your account. Remove personal details before sending.</p>

      {user && <label className="confirmation-check account-save-option">
        <input type="checkbox" checked={saveToHistory} disabled={analysisView.status === 'loading'} onChange={(event) => setSaveToHistory(event.target.checked)} />
        Save this analysis to my account. Includes evidence excerpts and commitments.
      </label>}

      <div className="action-row">
        <button className="secondary-button" type="button" onClick={inspectPage} disabled={pageView.status === 'loading'}>
          {pageView.status === 'loading' ? 'Inspecting...' : 'Inspect page'}
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={() => void analyzePage(analysisView.status !== 'idle')}
          disabled={!context || !consent || context.sections.length === 0 || pageView.status === 'loading' || analysisView.status === 'loading'}
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

      {result && <AnalysisReport result={result} onSetReminder={openReminderComposer} />}
      {result?.analysis_id && <p className="success-message" role="status">Saved to your account history.</p>}

      {reminderComposer && (
        <ReminderForm
          key={reminderComposer.idempotencyKey}
          target={reminderComposer.target}
          existingReminder={reminderComposer.existingReminder}
          onCancel={() => setReminderComposer(null)}
          onSubmit={saveReminder}
        />
      )}

      {reminderNotice && <p className="success-message" role="status">{reminderNotice}</p>}

      <ReminderList
        reminders={reminders}
        onEdit={(reminder) => {
          setReminderNotice(null)
          setReminderComposer({
            target: {
              kind: reminder.eventKind,
              description: reminder.eventDescription,
              sourceSectionId: reminder.sourceSectionId,
            },
            existingReminder: reminder,
            idempotencyKey: crypto.randomUUID(),
          })
        }}
        onCancel={(reminder) => void cancelReminder(reminder)}
      />

      <p className="disclaimer">
        Reminders are stored only in this browser and do not sync with your account.
        {' '}<a href="./privacy.html" target="_blank" rel="noreferrer">Privacy and limitations</a>
      </p>
    </main>
  )
}
