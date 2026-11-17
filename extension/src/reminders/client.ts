import type {
  PopupToBackgroundMessage,
  ReminderListResponse,
  ReminderResponse,
} from '../messaging/protocol'
import type { ReminderDraft, ReminderUpdate } from './types'

function sendMessage<T>(message: PopupToBackgroundMessage): Promise<T> {
  if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
    return Promise.reject(new Error('Reminder actions require the installed Chrome extension.'))
  }
  return chrome.runtime.sendMessage(message) as Promise<T>
}

export function createLocalReminder(reminder: ReminderDraft): Promise<ReminderResponse> {
  return sendMessage({ type: 'CREATE_LOCAL_REMINDER', requestId: crypto.randomUUID(), reminder })
}

export function listLocalReminders(sourceUrl?: string): Promise<ReminderListResponse> {
  return sendMessage({ type: 'LIST_LOCAL_REMINDERS', requestId: crypto.randomUUID(), sourceUrl })
}

export function updateLocalReminder(
  reminderId: string,
  update: ReminderUpdate,
): Promise<ReminderResponse> {
  return sendMessage({ type: 'UPDATE_LOCAL_REMINDER', requestId: crypto.randomUUID(), reminderId, update })
}

export function deleteLocalReminder(reminderId: string): Promise<ReminderResponse> {
  return sendMessage({ type: 'DELETE_LOCAL_REMINDER', requestId: crypto.randomUUID(), reminderId })
}
