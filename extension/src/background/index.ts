import type {
  BackgroundToPopupResponse,
  ContentRequestMessage,
  ContentResponse,
  ExtensionError,
  PopupToBackgroundMessage,
  ReminderListResponse,
  ReminderResponse,
} from '../messaging/protocol'
import type { LocalReminder, ReminderDraft, ReminderUpdate } from '../reminders/types'

const reminderStorageKey = 'before-you-agree:local-reminders'
const alarmPrefix = 'before-you-agree:reminder:'

// Storage updates are read/modify/write operations. Keep them in order, including
// alarm callbacks, so overlapping popup requests cannot overwrite each other.
let reminderQueue: Promise<unknown> = Promise.resolve()
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = reminderQueue.then(operation)
  reminderQueue = result.catch(() => undefined)
  return result
}

function isPopupMessage(message: unknown): message is PopupToBackgroundMessage {
  if (!message || typeof message !== 'object') return false
  const type = (message as { type?: unknown }).type
  return [
    'GET_ACTIVE_PAGE_CONTEXT',
    'CREATE_LOCAL_REMINDER',
    'LIST_LOCAL_REMINDERS',
    'UPDATE_LOCAL_REMINDER',
    'DELETE_LOCAL_REMINDER',
  ].includes(type as string)
}

function error(code: ExtensionError['code'], message: string): { ok: false; error: ExtensionError } {
  return { ok: false, error: { code, message } }
}

function unsupportedPageMessage(url: string | undefined): string | null {
  if (!url) return 'The active tab does not expose a page URL.'

  try {
    const pageUrl = new URL(url)
    if (pageUrl.protocol !== 'http:' && pageUrl.protocol !== 'https:') {
      return 'This page type cannot be inspected. Try a normal website instead.'
    }
  } catch {
    return 'The active tab URL is unavailable.'
  }

  return null
}

function sendToContentScript(
  tabId: number,
  request: ContentRequestMessage,
): Promise<ContentResponse> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, request, (response: ContentResponse | undefined) => {
      if (chrome.runtime.lastError) {
        resolve(error('CONTENT_SCRIPT_UNAVAILABLE', 'The page is not ready. Reload the page and try again.'))
        return
      }

      resolve(response ?? error('EXTENSION_RUNTIME_ERROR', 'The page did not return its context.'))
    })
  })
}

async function getActivePageContext(requestId: string): Promise<BackgroundToPopupResponse> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

  if (!tab?.id) return error('NO_ACTIVE_TAB', 'No active tab is available.')

  const unsupportedMessage = unsupportedPageMessage(tab.url)
  if (unsupportedMessage) return error('UNSUPPORTED_PAGE', unsupportedMessage)

  return sendToContentScript(tab.id, { type: 'GET_PAGE_CONTEXT', requestId })
}

function isStoredReminder(value: unknown): value is LocalReminder {
  if (!value || typeof value !== 'object') return false
  const reminder = value as Partial<LocalReminder>
  return typeof reminder.id === 'string'
    && typeof reminder.sourceUrl === 'string'
    && typeof reminder.remindAt === 'string'
    && typeof reminder.timezone === 'string'
    && typeof reminder.idempotencyKey === 'string'
    && typeof reminder.sourceTitle === 'string'
    && typeof reminder.eventKind === 'string'
    && typeof reminder.eventDescription === 'string'
    && (reminder.sourceSectionId === null || typeof reminder.sourceSectionId === 'string')
    && Number.isFinite(Date.parse(reminder.remindAt))
    && typeof reminder.createdAt === 'string'
    && typeof reminder.updatedAt === 'string'
    && ['scheduled', 'due', 'cancelled'].includes(reminder.status ?? '')
}

async function loadReminders(): Promise<LocalReminder[]> {
  const stored = await chrome.storage.local.get(reminderStorageKey)
  const value = stored[reminderStorageKey]
  return Array.isArray(value) ? value.filter(isStoredReminder) : []
}

async function saveReminders(reminders: LocalReminder[]): Promise<void> {
  await chrome.storage.local.set({ [reminderStorageKey]: reminders })
}

function alarmName(reminderId: string): string {
  return `${alarmPrefix}${reminderId}`
}

function validFutureTimestamp(remindAt: string): number | null {
  const timestamp = Date.parse(remindAt)
  return Number.isFinite(timestamp) && timestamp > Date.now() ? timestamp : null
}

async function schedule(reminder: LocalReminder): Promise<void> {
  const when = validFutureTimestamp(reminder.remindAt)
  if (when === null) throw new Error('Reminder time must be a future UTC timestamp.')
  await chrome.alarms.create(alarmName(reminder.id), { when })
}

async function reconcileReminders(): Promise<void> {
  const reminders = await loadReminders()
  let changed = false
  for (const reminder of reminders) {
    if (reminder.status !== 'scheduled') continue
    if (Date.parse(reminder.remindAt) <= Date.now()) {
      reminder.status = 'due'
      reminder.updatedAt = new Date().toISOString()
      await chrome.alarms.clear(alarmName(reminder.id))
      changed = true
    } else {
      // Chrome may clear alarms on restart. Recreate missing or stale alarms.
      const alarm = await chrome.alarms.get(alarmName(reminder.id))
      if (!alarm || alarm.scheduledTime !== Date.parse(reminder.remindAt)) await schedule(reminder)
    }
  }
  if (changed) await saveReminders(reminders)
}

function validDetails(value: unknown): value is ReminderUpdate {
  if (!value || typeof value !== 'object') return false
  const details = value as Partial<ReminderUpdate>
  if (typeof details.remindAt !== 'string' || validFutureTimestamp(details.remindAt) === null
    || typeof details.timezone !== 'string' || !details.timezone
    || typeof details.eventDescription !== 'string' || !details.eventDescription.trim()
    || details.eventDescription.length > 280) return false
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: details.timezone })
    return true
  } catch {
    return false
  }
}

async function createReminder(draft: ReminderDraft): Promise<ReminderResponse> {
  if (!validDetails(draft)
    || typeof draft.sourceUrl !== 'string' || !/^https?:\/\//.test(draft.sourceUrl)
    || typeof draft.sourceTitle !== 'string' || typeof draft.eventKind !== 'string'
    || !draft.eventKind || typeof draft.idempotencyKey !== 'string' || !draft.idempotencyKey
    || (draft.sourceSectionId !== null && typeof draft.sourceSectionId !== 'string')) {
    return error('REMINDER_INVALID', 'Choose a future reminder time and confirm the event details.')
  }

  try {
    const reminders = await loadReminders()
    const existing = reminders.find((reminder) => reminder.idempotencyKey === draft.idempotencyKey)
    if (existing) {
      if (existing.status === 'scheduled') await schedule(existing)
      return { ok: true, data: existing }
    }

    const now = new Date().toISOString()
    const reminder: LocalReminder = {
      ...draft,
      id: crypto.randomUUID(),
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
    }
    await saveReminders([...reminders, reminder])
    await schedule(reminder)
    return { ok: true, data: reminder }
  } catch {
    return error('REMINDER_STORAGE_ERROR', 'The reminder could not be scheduled in this browser.')
  }
}

async function listReminders(sourceUrl?: string): Promise<ReminderListResponse> {
  try {
    await reconcileReminders()
    const reminders = await loadReminders()
    const filtered = sourceUrl ? reminders.filter((reminder) => reminder.sourceUrl === sourceUrl) : reminders
    return { ok: true, data: filtered.sort((left, right) => left.remindAt.localeCompare(right.remindAt)) }
  } catch {
    return error('REMINDER_STORAGE_ERROR', 'Saved reminders could not be read.')
  }
}

async function updateReminder(reminderId: string, update: ReminderUpdate): Promise<ReminderResponse> {
  if (!validDetails(update)) {
    return error('REMINDER_INVALID', 'Choose a future reminder time and confirm the event details.')
  }

  try {
    const reminders = await loadReminders()
    const index = reminders.findIndex((reminder) => reminder.id === reminderId)
    if (index === -1) return error('REMINDER_NOT_FOUND', 'This reminder no longer exists.')

    const updated: LocalReminder = {
      ...reminders[index],
      remindAt: update.remindAt,
      timezone: update.timezone,
      eventDescription: update.eventDescription,
      status: 'scheduled',
      updatedAt: new Date().toISOString(),
    }
    reminders[index] = updated
    await chrome.alarms.clear(alarmName(reminderId))
    await saveReminders(reminders)
    await schedule(updated)
    return { ok: true, data: updated }
  } catch {
    return error('REMINDER_STORAGE_ERROR', 'The reminder could not be updated.')
  }
}

async function deleteReminder(reminderId: string): Promise<ReminderResponse> {
  try {
    const reminders = await loadReminders()
    const index = reminders.findIndex((reminder) => reminder.id === reminderId)
    if (index === -1) return error('REMINDER_NOT_FOUND', 'This reminder no longer exists.')

    const cancelled: LocalReminder = {
      ...reminders[index],
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    }
    reminders[index] = cancelled
    await chrome.alarms.clear(alarmName(reminderId))
    await saveReminders(reminders)
    return { ok: true, data: cancelled }
  } catch {
    return error('REMINDER_STORAGE_ERROR', 'The reminder could not be cancelled.')
  }
}

// Reconcile each time the worker starts, including after browser restarts.
void enqueue(reconcileReminders).catch(() => undefined)

chrome.alarms.onAlarm.addListener((alarm) => {
  if (!alarm.name.startsWith(alarmPrefix)) return
  const reminderId = alarm.name.slice(alarmPrefix.length)
  void enqueue(async () => {
    const reminders = await loadReminders()
    const index = reminders.findIndex((reminder) => reminder.id === reminderId)
    if (index === -1 || reminders[index].status !== 'scheduled') return
    // A queued alarm for an earlier schedule must not fire an edited reminder.
    if (Date.parse(reminders[index].remindAt) > Date.now()) return

    reminders[index] = {
      ...reminders[index],
      status: 'due',
      updatedAt: new Date().toISOString(),
    }
    await saveReminders(reminders)
  }).catch(() => undefined)
})

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isPopupMessage(message)) return false

  switch (message.type) {
    case 'GET_ACTIVE_PAGE_CONTEXT':
      void getActivePageContext(message.requestId).then(sendResponse)
      return true
    case 'CREATE_LOCAL_REMINDER':
      void enqueue(() => createReminder(message.reminder)).then(sendResponse)
      return true
    case 'LIST_LOCAL_REMINDERS':
      void enqueue(() => listReminders(message.sourceUrl)).then(sendResponse)
      return true
    case 'UPDATE_LOCAL_REMINDER':
      void enqueue(() => updateReminder(message.reminderId, message.update)).then(sendResponse)
      return true
    case 'DELETE_LOCAL_REMINDER':
      void enqueue(() => deleteReminder(message.reminderId)).then(sendResponse)
      return true
  }
})
