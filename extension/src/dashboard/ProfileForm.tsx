import { useState } from 'react'

import { account } from '../account/client'
import type { UserProfile } from '../account/session'

export function ProfileForm({ user, onUpdated }: { user: UserProfile; onUpdated: (profile: UserProfile) => void }) {
  const [name, setName] = useState(user.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const changed = name.trim() !== user.name

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !changed || !name.trim()) return
    setBusy(true)
    setError(null)
    try { onUpdated(await account.updateName(name)) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Your profile could not be updated.') }
    finally { setBusy(false) }
  }

  return <section className="profile-settings" aria-labelledby="profile-heading">
    <p className="eyebrow">ACCOUNT SETTINGS</p>
    <h2 id="profile-heading">Your profile</h2>
    <p className="muted-copy">Sign-in email: {user.email}</p>
    <form className="account-form profile-form" aria-label="Edit profile" aria-busy={busy} onSubmit={(event) => void submit(event)}>
      <label>Display name<input autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={busy} /></label>
      {error && <p className="error-message" role="alert">{error}</p>}
      <div className="deletion-actions">
        <button className="primary-button" disabled={busy || !changed || !name.trim()}>{busy ? 'Saving…' : 'Save name'}</button>
        <button className="secondary-button" type="button" disabled={busy || name === user.name} onClick={() => { setName(user.name); setError(null) }}>Reset</button>
      </div>
    </form>
  </section>
}
