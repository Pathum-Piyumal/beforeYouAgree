import { useEffect, useRef, useState } from 'react'

import { account, onAccountChange } from '../account/client'
import { AccountHttpError, type UserProfile } from '../account/session'
import { parseAnalysisResponse, type AnalysisResponse, type RiskBand } from '../api/types'
import { AnalysisReport } from '../popup/components/AnalysisReport'
import { ReminderForm, type ReminderTarget } from '../popup/components/ReminderForm'
import { ReminderList } from '../popup/components/ReminderList'
import { describeTimelineEvent, type TimelineEvent } from '../popup/components/timelineText'
import { createLocalReminder, deleteLocalReminder, listLocalReminders, updateLocalReminder } from '../reminders/client'
import type { LocalReminder } from '../reminders/types'
import { AccountDeletion } from './AccountDeletion'
import { ProfileForm } from './ProfileForm'
import { AccountReminders } from './AccountReminders'
import '../popup/App.css'
import './dashboard.css'

type HistoryItem = {
  id: string; domain: string; source_url: string; score: number | null
  risk_band: RiskBand | null; status: string; created_at: string; report_available: boolean
}
type HistoryPage = { items: HistoryItem[]; total: number; offset: number; limit: number }
type Summary = {
  analysis_count: number; finding_count: number; commitment_count: number
  average_score: number | null; risk_distribution: Record<string, number>
}
type Composer = {
  target: ReminderTarget; existing: LocalReminder | null; key: string
  sourceUrl: string; sourceTitle: string
}
const pageSize = 10
const riskNames: Record<string, string> = { low: 'Low', moderate: 'Moderate', high: 'High', very_high: 'Very high', unscored: 'Unscored' }
const messageFor = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'

function AuthForm({ onSignedIn }: { onSignedIn: (user: UserProfile) => void }) {
  const [register, setRegister] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = await account.signIn({ email, password, ...(register ? { name } : {}) }, register)
      setPassword('')
      onSignedIn(user)
    } catch (failure) { setError(messageFor(failure)) } finally { setBusy(false) }
  }

  return <section className="account-card" aria-labelledby="account-heading">
    <p className="eyebrow">YOUR ACCOUNT</p>
    <h2 id="account-heading">{register ? 'Create your account' : 'Welcome back'}</h2>
    <p className="muted-copy">Keep the agreements you choose to save in one place.</p>
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      {register && <label>Name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></label>}
      <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={320} required /></label>
      <label>Password<input type="password" autoComplete={register ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required /></label>
      <p className="field-hint">Use 12–128 characters. Your session ends when the browser restarts.</p>
      {error && <p className="error-message" role="alert">{error}</p>}
      <button className="primary-button" disabled={busy}>{busy ? 'Please wait…' : register ? 'Create account' : 'Sign in'}</button>
      <button className="text-button" type="button" disabled={busy} onClick={() => { setRegister(!register); setPassword(''); setError(null) }}>
        {register ? 'Already have an account? Sign in' : 'New here? Create an account'}
      </button>
    </form>
  </section>
}

export default function Dashboard() {
  const [user, setUser] = useState<UserProfile | null>(null)
  const [restoring, setRestoring] = useState(true)
  const [history, setHistory] = useState<HistoryPage | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [risk, setRisk] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [offset, setOffset] = useState(0)
  const [revision, setRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ item: HistoryItem; report: AnalysisResponse } | null>(null)
  const [detailLoading, setDetailLoading] = useState<string | null>(null)
  const detailRequest = useRef(0)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [reminders, setReminders] = useState<LocalReminder[]>([])
  const [composer, setComposer] = useState<Composer | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => onAccountChange((profile, previous) => {
    if (profile && profile.id === previous?.id) { setUser(profile); return }
    ++detailRequest.current
    setUser(profile); setHistory(null); setSummary(null); setSelected(null)
    setDeleteId(null); setComposer(null); setDetailLoading(null); setOffset(0)
  }), [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        if (await account.user()) {
          const response = await account.request('/users/me')
          const profile = await response.json() as UserProfile
          if (active) setUser(profile)
        }
      } catch (failure) {
        if (active) setError(messageFor(failure))
      } finally { if (active) setRestoring(false) }
    })()
    return () => { active = false }
  }, [])

  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let active = true
    const params = new URLSearchParams({ offset: String(offset), limit: String(pageSize) })
    if (risk) params.set('risk_band', risk)
    if (dateFrom) params.set('date_from', dateFrom)
    if (dateTo) params.set('date_to', dateTo)
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [historyResponse, summaryResponse] = await Promise.all([
          account.request(`/analyses?${params}`), account.request('/dashboard/summary'),
        ])
        const [nextHistory, nextSummary] = await Promise.all([historyResponse.json(), summaryResponse.json()])
        if (active) { setHistory(nextHistory as HistoryPage); setSummary(nextSummary as Summary) }
      } catch (failure) {
        if (active) {
          setError(messageFor(failure))
          if (failure instanceof AccountHttpError && failure.status === 401) {
            setUser(null); setHistory(null); setSummary(null); setSelected(null)
          }
        }
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false }
  }, [userId, offset, risk, dateFrom, dateTo, revision])

  useEffect(() => {
    let active = true
    void listLocalReminders().then((response) => {
      if (!active) return
      if (response.ok) setReminders(response.data)
      else setNotice(response.error.message)
    }).catch(() => { if (active) setNotice('Browser reminders are available in the installed extension.') })
    return () => { active = false }
  }, [revision])

  async function openReport(item: HistoryItem) {
    const request = ++detailRequest.current
    setDetailLoading(item.id)
    setError(null)
    setComposer(null)
    try {
      const response = await account.request(`/analyses/${item.id}`)
      const report = parseAnalysisResponse(await response.json())
      if (request === detailRequest.current) setSelected({ item, report })
    } catch (failure) { if (request === detailRequest.current) setError(messageFor(failure)) }
    finally { if (request === detailRequest.current) setDetailLoading(null) }
  }

  async function removeReport(id: string) {
    setDeleting(true)
    setError(null)
    try {
      await account.request(`/analyses/${id}`, { method: 'DELETE' })
      ++detailRequest.current
      setDetailLoading(null)
      if (selected?.item.id === id) { setSelected(null); setComposer(null) }
      setDeleteId(null)
      if (history?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - pageSize))
      else setRevision((value) => value + 1)
    } catch (failure) { setError(messageFor(failure)) } finally { setDeleting(false) }
  }

  async function signOut() {
    setSigningOut(true)
    try { await account.signOut() }
    catch { setNotice('Signed out in this browser. Server revocation could not be confirmed; the session will expire automatically.') }
    finally {
      ++detailRequest.current
      setUser(null); setHistory(null); setSummary(null); setSelected(null); setComposer(null)
      setDeleteId(null); setDetailLoading(null); setSigningOut(false)
    }
  }

  function compose(event: TimelineEvent) {
    if (!selected) return
    setComposer({
      target: { kind: event.kind, description: describeTimelineEvent(event), sourceSectionId: event.source_section_id },
      existing: null, key: crypto.randomUUID(), sourceUrl: selected.item.source_url, sourceTitle: selected.item.domain,
    })
  }

  async function saveReminder(values: { remindAt: string; timezone: string; eventDescription: string }) {
    if (!composer) return
    const response = composer.existing
      ? await updateLocalReminder(composer.existing.id, values)
      : await createLocalReminder({
        ...values, sourceUrl: composer.sourceUrl, sourceTitle: composer.sourceTitle,
        eventKind: composer.target.kind, sourceSectionId: composer.target.sourceSectionId,
        idempotencyKey: composer.key,
      })
    if (!response.ok) throw new Error(response.error.message)
    setComposer(null)
    setNotice('Reminder saved in this browser.')
    setRevision((value) => value + 1)
  }

  async function cancelReminder(reminder: LocalReminder) {
    try {
      const response = await deleteLocalReminder(reminder.id)
      if (!response.ok) throw new Error(response.error.message)
      setRevision((value) => value + 1)
      setNotice('Reminder cancelled.')
    } catch (failure) { setNotice(messageFor(failure)) }
  }

  return <main className="dashboard-shell">
    <header className="dashboard-header">
      <a className="dashboard-brand" href="#dashboard"><span className="brand-mark" aria-hidden="true">✓</span><span>BEFORE YOU AGREE</span></a>
      <div className="dashboard-account">{user && <><span>{user.name}</span><button className="secondary-button" disabled={signingOut} onClick={() => void signOut()}>Sign out</button></>}</div>
    </header>
    <div className="dashboard-intro"><p className="eyebrow">YOUR AGREEMENT LIBRARY</p><h1>A little clarity.<br />A better decision.</h1><p>Review what you’ve saved, revisit the evidence, and keep track of future commitments.</p></div>
    {error && <div className="error-state" role="alert"><p>{error}</p>{user && <button className="secondary-button" onClick={() => setRevision((value) => value + 1)}>Try again</button>}</div>}
    {notice && <p className="dashboard-notice" role="status">{notice}</p>}
    {restoring ? <p role="status">Checking your session…</p> : !user ? <AuthForm onSignedIn={(profile) => { setError(null); setUser(profile); setOffset(0) }} /> : <>
      <section className="summary-grid" aria-label="Account summary" aria-busy={loading}>
        {[
          ['Saved analyses', summary?.analysis_count], ['Supported findings', summary?.finding_count],
          ['Commitments', summary?.commitment_count], ['Average risk score', summary?.average_score],
        ].map(([label, value]) => <article className="summary-card" key={label}><p>{label}</p><strong>{value ?? '—'}</strong>{label === 'Average risk score' && <small>Of scored saved analyses · out of 100</small>}</article>)}
      </section>
      {summary && <section className="risk-distribution" aria-label="Risk distribution">{Object.entries(summary.risk_distribution).map(([band, count]) => <span key={band}>{riskNames[band] ?? band}<strong>{count}</strong></span>)}</section>}
      <section className="history-section" aria-labelledby="history-heading">
        <div className="section-heading"><div><p className="eyebrow">SAVED BY YOU</p><h2 id="history-heading">Analysis history</h2></div><button className="text-button" disabled={loading} onClick={() => setRevision((value) => value + 1)}>Refresh</button></div>
        <p className="muted-copy">In the extension popup, select “Save this analysis to my account” before analyzing. Raw page text is not saved.</p>
        <div className="history-filters">
          <label>Risk level<select value={risk} onChange={(event) => { setRisk(event.target.value); setOffset(0) }}><option value="">All levels</option>{Object.entries(riskNames).filter(([band]) => band !== 'unscored').map(([band, label]) => <option value={band} key={band}>{label}</option>)}</select></label>
          <label>From (UTC)<input type="date" value={dateFrom} onChange={(event) => { setDateFrom(event.target.value); setOffset(0) }} /></label>
          <label>To (UTC)<input type="date" value={dateTo} onChange={(event) => { setDateTo(event.target.value); setOffset(0) }} /></label>
        </div>
        {loading ? <p role="status">Loading your saved analyses…</p> : history && <>
          {history.items.length === 0 ? <div className="history-empty"><h3>{history.total === 0 && !risk && !dateFrom && !dateTo ? 'Your library starts here' : 'No matching analyses'}</h3><p>Saved analyses will appear here with their score, evidence, and commitments.</p></div> : <ul className="history-list">{history.items.map((item) => <li className="history-row" key={item.id}>
            <div className="history-domain"><strong>{item.domain}</strong><a href={item.source_url} target="_blank" rel="noreferrer">Visit source ↗</a><small>{new Date(item.created_at.endsWith('Z') || /[+-]\d\d:\d\d$/.test(item.created_at) ? item.created_at : `${item.created_at}Z`).toLocaleDateString()}</small></div>
            <span className={`history-risk history-risk--${item.risk_band ?? 'unscored'}`}>{riskNames[item.risk_band ?? 'unscored']}<strong>{item.score ?? '—'}<small>/100</small></strong></span>
            <div className="history-row-actions"><button className="secondary-button" disabled={!item.report_available || detailLoading !== null} onClick={() => void openReport(item)}>{detailLoading === item.id ? 'Opening…' : item.report_available ? 'View report' : 'Report unavailable'}</button><button className="text-button" onClick={() => setDeleteId(item.id)} disabled={deleting}>Delete</button></div>
            {deleteId === item.id && <div className="delete-confirmation"><p>Delete this saved report and its account commitments? Browser reminders stay on this device.</p><button className="secondary-button" disabled={deleting} onClick={() => setDeleteId(null)}>Keep report</button><button className="danger-button" disabled={deleting} onClick={() => void removeReport(item.id)}>{deleting ? 'Deleting…' : 'Delete report'}</button></div>}
          </li>)}</ul>}
          <nav className="history-pagination" aria-label="History pages"><button className="secondary-button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button><span>{history.total ? `${offset + 1}–${Math.min(offset + pageSize, history.total)} of ${history.total}` : '0 saved'}</span><button className="secondary-button" disabled={offset + pageSize >= history.total} onClick={() => setOffset(offset + pageSize)}>Next</button></nav>
        </>}
      </section>
      {selected && <section className="saved-report" aria-label={`Report for ${selected.item.domain}`}><div className="section-heading"><h2>{selected.item.domain}</h2><button className="text-button" onClick={() => { ++detailRequest.current; setSelected(null); setComposer(null); setDetailLoading(null) }}>Close report</button></div><AnalysisReport result={selected.report} onSetReminder={compose} /></section>}
      <AccountReminders key={`reminders:${user.id}`} revision={revision} />
      <ProfileForm key={`${user.id}:${user.name}`} user={user} onUpdated={(profile) => {
        setUser(profile); setNotice('Display name updated.')
      }} />
      <AccountDeletion key={`delete:${user.id}`} email={user.email} onDeleted={() => {
        ++detailRequest.current
        setUser(null); setHistory(null); setSummary(null); setSelected(null); setComposer(null)
        setDeleteId(null); setDetailLoading(null); setOffset(0); setError(null)
        setNotice('Your account and saved data were deleted. Browser reminders remain on this device.')
      }} />
    </>}
    {composer && <ReminderForm key={composer.key} target={composer.target} existingReminder={composer.existing} onCancel={() => setComposer(null)} onSubmit={saveReminder} />}
    <aside className="browser-reminders"><p className="eyebrow">ON THIS DEVICE</p><h2>Browser reminders</h2><p className="muted-copy">These reminders belong to this browser, independently of the signed-in account. They do not sync or send desktop notifications.</p><ReminderList reminders={reminders} onEdit={(reminder) => setComposer({ target: { kind: reminder.eventKind, description: reminder.eventDescription, sourceSectionId: reminder.sourceSectionId }, existing: reminder, key: crypto.randomUUID(), sourceUrl: reminder.sourceUrl, sourceTitle: reminder.sourceTitle })} onCancel={(reminder) => void cancelReminder(reminder)} />{reminders.every((reminder) => reminder.status === 'cancelled') && <p className="muted-copy">No active reminders in this browser.</p>}</aside>
    <footer className="dashboard-footer">Decision support, not legal advice. Review the original agreement before acting. <a href="./privacy.html" target="_blank" rel="noreferrer">Privacy and limitations</a></footer>
  </main>
}
