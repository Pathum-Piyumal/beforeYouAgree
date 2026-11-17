import { useEffect, useState } from 'react'

import { account } from '../account/client'

type Commitment = { id: string; kind: string; source_url: string; amount: string | null; currency: string | null }
type AccountReminder = {
  id: string; commitment_id: string; event_description: string; remind_at: string
  event_at: string | null; timezone: string; status: 'scheduled' | 'due' | 'acknowledged' | 'cancelled'
}
type Page<T> = { items: T[]; total: number; offset: number; limit: number }
const pageSize = 10
const message = (error: unknown) => error instanceof Error ? error.message : 'The request could not be completed.'
function localTime(value: string) {
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
}

export function AccountReminders({ revision }: { revision: number }) {
  const [commitments, setCommitments] = useState<Page<Commitment> | null>(null)
  const [reminders, setReminders] = useState<Page<AccountReminder> | null>(null)
  const [commitmentOffset, setCommitmentOffset] = useState(0)
  const [reminderOffset, setReminderOffset] = useState(0)
  const [refresh, setRefresh] = useState(0)
  const [composer, setComposer] = useState<{ commitment: Commitment; existing: AccountReminder | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const timer = window.setInterval(() => setRefresh((value) => value + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const [events, saved] = await Promise.all([
          account.request(`/commitments?limit=${pageSize}&offset=${commitmentOffset}`),
          account.request(`/reminders?limit=${pageSize}&offset=${reminderOffset}`),
        ])
        const [nextEvents, nextSaved] = await Promise.all([events.json(), saved.json()])
        if (active) { setCommitments(nextEvents); setReminders(nextSaved); setError(null) }
      } catch (failure) { if (active) setError(message(failure)) }
    })()
    return () => { active = false }
  }, [revision, refresh, commitmentOffset, reminderOffset])

  async function act(path: string, method: string) {
    setBusy(true); setError(null)
    try {
      await account.request(path, { method })
      setRefresh((value) => value + 1)
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }

  return <section className="account-reminders" aria-labelledby="account-reminders-heading">
    <div className="section-heading"><h2 id="account-reminders-heading">Account commitments and reminders</h2><button className="text-button" onClick={() => setRefresh((value) => value + 1)}>Refresh reminders</button></div>
    <p className="muted-copy">Saved commitments stay relative until you confirm an event date. Account reminders appear here when due; open this dashboard to review them. They do not send email or desktop notifications.</p>
    {error && <p role="alert" className="error-message">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!commitments && !error && <p role="status">Loading account commitments…</p>}
    {commitments && <>
      <h3>Saved commitments</h3>
      {commitments.items.length === 0 ? <p>No saved commitments on this page. Save an analysis with a timeline to get started.</p> : <ul className="account-event-list">{commitments.items.map((item) => <li key={item.id}>
        <div><strong>{item.kind.replaceAll('_', ' ')}</strong><p>{new URL(item.source_url).hostname}{item.amount && ` · ${item.currency ?? ''} ${item.amount}`}</p><a href={item.source_url} target="_blank" rel="noreferrer">Review source agreement</a></div>
        <button className="secondary-button" onClick={() => setComposer({ commitment: item, existing: null })}>Set account reminder</button>
      </li>)}</ul>}
      <Pagination label="Commitment pages" page={commitments} onChange={setCommitmentOffset} />
    </>}
    {reminders && <>
      <h3>Account reminders</h3>
      {reminders.items.length === 0 ? <p>No account reminders yet.</p> : <ul className="account-event-list">{reminders.items.map((item) => <li key={item.id}>
        <div><strong>{item.event_description || 'Saved commitment'}</strong><p><span className={item.status === 'due' ? 'due-label' : ''}>{item.status}</span> · {new Date(item.remind_at).toLocaleString(undefined, { timeZone: item.timezone })} ({item.timezone})</p>{item.event_at && <p>Confirmed event: {new Date(item.event_at).toLocaleString(undefined, { timeZone: item.timezone })}</p>}</div>
        <div className="deletion-actions">
          {item.status === 'due' && <button className="primary-button" disabled={busy} onClick={() => void act(`/reminders/${item.id}/acknowledge`, 'POST')}>Mark reviewed</button>}
          {item.status !== 'cancelled' && <><button className="secondary-button" disabled={busy} onClick={() => setComposer({ commitment: { id: item.commitment_id, kind: 'saved commitment', source_url: '', amount: null, currency: null }, existing: item })}>Edit account reminder</button><button className="text-button" disabled={busy} onClick={() => void act(`/reminders/${item.id}`, 'DELETE')}>Cancel account reminder</button></>}
        </div>
      </li>)}</ul>}
      <Pagination label="Account reminder pages" page={reminders} onChange={setReminderOffset} />
    </>}
    {composer && <AccountReminderForm key={composer.existing?.id ?? composer.commitment.id} commitment={composer.commitment} existing={composer.existing} onCancel={() => setComposer(null)} onSaved={() => { setComposer(null); setNotice('Account reminder saved.'); setRefresh((value) => value + 1) }} />}
  </section>
}

function Pagination({ page, label, onChange }: { page: Page<unknown>; label: string; onChange: (offset: number) => void }) {
  return <nav className="history-pagination" aria-label={label}>
    <button className="secondary-button" disabled={page.offset === 0} onClick={() => onChange(Math.max(0, page.offset - pageSize))}>Previous</button><span>{page.total ? `${page.offset + 1}–${Math.min(page.offset + pageSize, page.total)} of ${page.total}` : '0 items'}</span><button className="secondary-button" disabled={page.offset + pageSize >= page.total} onClick={() => onChange(page.offset + pageSize)}>Next</button>
  </nav>
}

function AccountReminderForm({ commitment, existing, onCancel, onSaved }: {
  commitment: Commitment; existing: AccountReminder | null; onCancel: () => void; onSaved: () => void
}) {
  const [requestKey] = useState(() => crypto.randomUUID())
  const [eventAt, setEventAt] = useState(existing?.event_at ? localTime(existing.event_at) : '')
  const [remindAt, setRemindAt] = useState(existing ? localTime(existing.remind_at) : '')
  const [note, setNote] = useState(existing?.event_description || commitment.kind.replaceAll('_', ' '))
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !confirmed) return
    const reminder = new Date(remindAt), occurrence = new Date(eventAt)
    if (!Number.isFinite(reminder.getTime()) || !Number.isFinite(occurrence.getTime())
      || reminder.getTime() <= Date.now() || reminder >= occurrence || !note.trim()) {
      setError('Choose a future reminder before the confirmed event, and enter an event note.'); return
    }
    setBusy(true); setError(null)
    try {
      await account.request(existing ? `/reminders/${existing.id}` : '/reminders', {
        method: existing ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remind_at: reminder.toISOString(), event_at: occurrence.toISOString(),
          timezone, event_description: note.trim(), confirmed: true,
          ...(!existing ? { commitment_id: commitment.id, idempotency_key: requestKey } : {}) }),
      })
      onSaved()
    } catch (failure) { setError(message(failure)) } finally { setBusy(false) }
  }
  return <form className="account-form" aria-label="Account reminder" onSubmit={(event) => void submit(event)}>
    <h3>{existing ? 'Edit account reminder' : 'Confirm an account reminder'}</h3>
    <p>Review the agreement and confirm the event date yourself. Times use {timezone}.</p>
    <label>Confirmed event time<input type="datetime-local" value={eventAt} onChange={(event) => setEventAt(event.target.value)} required disabled={busy} /></label>
    <label>Account reminder time<input type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} required disabled={busy} /></label>
    <label>Account event note<input value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} required disabled={busy} /></label>
    <label className="confirmation-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy} />I confirm the event date and reminder time.</label>
    {error && <p role="alert" className="error-message">{error}</p>}
    <div className="deletion-actions"><button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Close account reminder</button><button className="primary-button" disabled={busy || !confirmed}>{busy ? 'Saving…' : 'Save account reminder'}</button></div>
  </form>
}
