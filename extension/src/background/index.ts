import type {
  BackgroundToPopupResponse,
  ContentRequestMessage,
  ContentResponse,
  PopupToBackgroundMessage,
} from '../messaging/protocol'

function isPopupMessage(message: unknown): message is PopupToBackgroundMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'GET_ACTIVE_PAGE_CONTEXT'
  )
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
        resolve({
          ok: false,
          error: {
            code: 'CONTENT_SCRIPT_UNAVAILABLE',
            message: 'The page is not ready. Reload the page and try again.',
          },
        })
        return
      }

      resolve(
        response ?? {
          ok: false,
          error: {
            code: 'EXTENSION_RUNTIME_ERROR',
            message: 'The page did not return its context.',
          },
        },
      )
    })
  })
}

async function getActivePageContext(requestId: string): Promise<BackgroundToPopupResponse> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })

  if (!tab?.id) {
    return {
      ok: false,
      error: { code: 'NO_ACTIVE_TAB', message: 'No active tab is available.' },
    }
  }

  const unsupportedMessage = unsupportedPageMessage(tab.url)
  if (unsupportedMessage) {
    return {
      ok: false,
      error: { code: 'UNSUPPORTED_PAGE', message: unsupportedMessage },
    }
  }

  return sendToContentScript(tab.id, {
    type: 'GET_PAGE_CONTEXT',
    requestId,
  })
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isPopupMessage(message)) return false

  void getActivePageContext(message.requestId).then(sendResponse)
  return true
})
