export type PageSection = {
  section_id: string
  heading: string | null
  text: string
  source_url: string
}

export type PageContext = {
  url: string
  domain: string
  title: string
  textPreview: string
  textLength: number
  sections: PageSection[]
  policyLinks?: { label: string; url: string }[]
}

export type ExtensionErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'UNSUPPORTED_PAGE'
  | 'CONTENT_SCRIPT_UNAVAILABLE'
  | 'EXTENSION_RUNTIME_ERROR'
  | 'REMINDER_INVALID'
  | 'REMINDER_NOT_FOUND'
  | 'REMINDER_STORAGE_ERROR'

export type ExtensionError = {
  code: ExtensionErrorCode
  message: string
}

export type PopupToBackgroundMessage =
  | {
      type: 'GET_ACTIVE_PAGE_CONTEXT'
      requestId: string
    }
  | {
      type: 'CREATE_LOCAL_REMINDER'
      requestId: string
      reminder: ReminderDraft
    }
  | {
      type: 'LIST_LOCAL_REMINDERS'
      requestId: string
      sourceUrl?: string
    }
  | {
      type: 'UPDATE_LOCAL_REMINDER'
      requestId: string
      reminderId: string
      update: ReminderUpdate
    }
  | {
      type: 'DELETE_LOCAL_REMINDER'
      requestId: string
      reminderId: string
    }

export type ContentRequestMessage = {
  type: 'GET_PAGE_CONTEXT'
  requestId: string
}

export type ContentResponse =
  | { ok: true; data: PageContext }
  | { ok: false; error: ExtensionError }

export type BackgroundToPopupResponse =
  | { ok: true; data: PageContext }
  | { ok: false; error: ExtensionError }
import type { LocalReminder, ReminderDraft, ReminderUpdate } from '../reminders/types'


export type ReminderResponse =
  | { ok: true; data: LocalReminder }
  | { ok: false; error: ExtensionError }

export type ReminderListResponse =
  | { ok: true; data: LocalReminder[] }
  | { ok: false; error: ExtensionError }
