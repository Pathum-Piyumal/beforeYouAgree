import type { LocalReminder } from '../../reminders/types'

type ReminderListProps = {
  reminders: LocalReminder[]
  onEdit: (reminder: LocalReminder) => void
  onCancel: (reminder: LocalReminder) => void
}

function formatReminderTime(reminder: LocalReminder): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: reminder.timezone,
    }).format(new Date(reminder.remindAt))
  } catch {
    return new Date(reminder.remindAt).toLocaleString()
  }
}

export function ReminderList({ reminders, onEdit, onCancel }: ReminderListProps) {
  const activeReminders = reminders.filter((reminder) => reminder.status !== 'cancelled')
  if (activeReminders.length === 0) return null

  return (
    <section className="result-section" aria-labelledby="reminders-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">REMINDERS</p>
          <h2 id="reminders-heading">Saved in this browser</h2>
        </div>
      </div>
      <ul className="reminder-list">
        {activeReminders.map((reminder) => (
          <li className="reminder-item" key={reminder.id}>
            <div>
              <strong>{reminder.eventKind.replaceAll('_', ' ')}</strong>
              <p>{reminder.eventDescription}</p>
              <p>{formatReminderTime(reminder)} · {reminder.status}</p>
            </div>
            {reminder.status !== 'cancelled' && (
              <div className="reminder-actions">
                <button className="text-button" type="button" onClick={() => onEdit(reminder)}>Edit</button>
                <button className="text-button" type="button" onClick={() => onCancel(reminder)}>Cancel</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
