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
}

export type ExtensionErrorCode =
  | 'NO_ACTIVE_TAB'
  | 'UNSUPPORTED_PAGE'
  | 'CONTENT_SCRIPT_UNAVAILABLE'
  | 'EXTENSION_RUNTIME_ERROR'

export type ExtensionError = {
  code: ExtensionErrorCode
  message: string
}

export type PopupToBackgroundMessage = {
  type: 'GET_ACTIVE_PAGE_CONTEXT'
  requestId: string
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
