import { useState } from 'react'

import type { LocalReminder } from '../../reminders/types'

export type ReminderTarget = {
  kind: string
  description: string
  sourceSectionId: string | null
}

type ReminderFormProps = {
  target: ReminderTarget
  existingReminder: LocalReminder | null
  onCancel: () => void
  onSubmit: (values: { remindAt: string; timezone: string; eventDescription: string }) => Promise<void>
}

function localDateTimeValue(isoTimestamp: string): string {
  const date = new Date(isoTimestamp)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

function defaultDateTime(): string {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  tomorrow.setHours(9, 0, 0, 0)
  return localDateTimeValue(tomorrow.toISOString())
}

export function ReminderForm({ target, existingReminder, onCancel, onSubmit }: ReminderFormProps) {
  const [remindAt, setRemindAt] = useState(
    existingReminder ? localDateTimeValue(existingReminder.remindAt) : defaultDateTime(),
  )
  const [description, setDescription] = useState(existingReminder?.eventDescription ?? target.description)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const selectedDate = new Date(remindAt)
    if (Number.isNaN(selectedDate.getTime()) || selectedDate.getTime() <= Date.now()) {
      setError('Choose a reminder time in the future.')
      return
    }
    if (!description.trim()) {
      setError('Enter an event note before saving.')
      return
    }
    if (!confirmed) {
      setError('Confirm the estimated event date and reminder time before saving.')
      return
    }

    setSaving(true)
    setError(null)
    try {
      await onSubmit({
        remindAt: selectedDate.toISOString(),
        timezone,
        eventDescription: description.trim(),
      })
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'Reminder could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="reminder-form" aria-labelledby="reminder-form-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">REMINDER</p>
          <h2 id="reminder-form-heading">{existingReminder ? 'Edit reminder' : 'Set reminder'}</h2>
        </div>
        <button className="text-button" type="button" onClick={onCancel}>Close</button>
      </div>
      <p className="muted-copy">{target.kind.replaceAll('_', ' ')}: {target.description}</p>
      <form onSubmit={(event) => void save(event)}>
        <label>
          Reminder time
          <input type="datetime-local" value={remindAt} onChange={(event) => setRemindAt(event.target.value)} required />
        </label>
        <p className="field-hint">Stored as UTC; displayed using your current timezone: {timezone}.</p>
        <label>
          Event note
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={280} required />
        </label>
        <label className="confirmation-check">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          I confirm this estimated event date and reminder time.
        </label>
        {error && <p className="error-message" role="alert">{error}</p>}
        <div className="action-row">
          <button className="secondary-button" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-button" type="submit" disabled={saving || !confirmed}>
            {saving ? 'Saving...' : existingReminder ? 'Update reminder' : 'Save reminder'}
          </button>
        </div>
      </form>
    </section>
  )
}
