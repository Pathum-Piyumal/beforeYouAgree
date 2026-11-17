import { useRef, useState } from 'react'

import { account } from '../account/client'

export function AccountDeletion({ email, onDeleted }: { email: string; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)

  return <section className="account-deletion" aria-labelledby="account-deletion-heading">
    <p className="eyebrow">ACCOUNT SETTINGS</p>
    <h2 id="account-deletion-heading" ref={heading} tabIndex={-1}>Delete your account</h2>
    <p className="muted-copy">Permanently remove your account and everything you saved to it.</p>
    {expanded
      ? <DeletionForm email={email} onCancel={() => { setExpanded(false); heading.current?.focus() }} onDeleted={onDeleted} />
      : <button className="danger-button" aria-expanded={false} onClick={() => setExpanded(true)}>Delete account</button>}
  </section>
}

function DeletionForm({ email, onCancel, onDeleted }: {
  email: string; onCancel: () => void; onDeleted: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !confirmed) return
    setBusy(true)
    setError(null)
    try {
      await account.deleteAccount(password)
      onDeleted()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not confirm account deletion. Try again.')
    } finally { setPassword(''); setBusy(false) }
  }

  return <form className="account-form deletion-form" aria-label="Confirm account deletion" onSubmit={(event) => void submit(event)} aria-busy={busy}>
    <p id="deletion-effects">Deleting <strong>{email}</strong> permanently removes your profile, saved analyses, findings, commitments, and account reminders. It signs you out of all sessions. This cannot be undone.</p>
    <p id="deletion-local-reminders">Browser reminders stay on this device. You can manage them below, even after deleting your account.</p>
    <label>Current password<input type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} maxLength={128} required disabled={busy} /></label>
    <label className="deletion-consent"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} required disabled={busy} aria-describedby="deletion-effects deletion-local-reminders" />I understand this permanently deletes my account and saved data.</label>
    {error && <p className="error-message" role="alert">{error}</p>}
    <div className="deletion-actions">
      <button className="secondary-button" type="button" disabled={busy} onClick={onCancel}>Keep my account</button>
      <button className="danger-button" disabled={busy || !confirmed || password.length < 12}>{busy ? 'Deleting account…' : 'Permanently delete account'}</button>
    </div>
  </form>
}
