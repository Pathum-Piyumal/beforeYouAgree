export type ReminderStatus = 'scheduled' | 'due' | 'cancelled'

export type ReminderDraft = {
  sourceUrl: string
  sourceTitle: string
  eventKind: string
  eventDescription: string
  sourceSectionId: string | null
  remindAt: string
  timezone: string
  idempotencyKey: string
}

export type LocalReminder = ReminderDraft & {
  id: string
  status: ReminderStatus
  createdAt: string
  updatedAt: string
}

export type ReminderUpdate = {
  remindAt: string
  timezone: string
  eventDescription: string
}
