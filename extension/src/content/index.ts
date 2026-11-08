import type { ContentRequestMessage } from '../messaging/protocol'
import { extractPageContext } from './extractor'

function isContentRequest(message: unknown): message is ContentRequestMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'GET_PAGE_CONTEXT'
  )
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isContentRequest(message)) return false

  sendResponse({ ok: true, data: extractPageContext(document) })
  return false
})
