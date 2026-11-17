import { SessionManager, type AccountTokens, type SessionStore, type UserProfile } from './session'

const apiBaseUrl = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1').replace(/\/$/, '')
const storageKey = 'before-you-agree:account-session'
const store: SessionStore = {
  async read() {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const stored = await chrome.storage.session.get(storageKey)
      return (stored[storageKey] as AccountTokens | undefined) ?? null
    }
    const value = sessionStorage.getItem(storageKey)
    try { return value ? JSON.parse(value) as AccountTokens : null } catch { return null }
  },
  async write(tokens) {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      if (tokens) await chrome.storage.session.set({ [storageKey]: tokens })
      else await chrome.storage.session.remove(storageKey)
    } else if (tokens) sessionStorage.setItem(storageKey, JSON.stringify(tokens))
    else sessionStorage.removeItem(storageKey)
  },
}

// Shared across extension pages, including the popup and full-page dashboard.
// Never expose session storage to content scripts or persist tokens in local storage.
export const account = new SessionManager(store, async (path, init) => {
  try {
    return await fetch(`${apiBaseUrl}${path}`, {
      ...init, cache: 'no-store',
      signal: init?.signal ?? AbortSignal.timeout(30_000),
    })
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw error
    }
    throw new Error('The account service is unavailable. Check the connection and try again.')
  }
}, async (operation) => await navigator.locks.request('before-you-agree:account', operation))

export function dashboardUrl(): string {
  return typeof chrome !== 'undefined' && chrome.runtime?.getURL
    ? chrome.runtime.getURL('index.html#dashboard')
    : `${window.location.pathname}#dashboard`
}

export function onAccountChange(listener: (user: UserProfile | null, previous: UserProfile | null) => void): () => void {
  if (typeof chrome === 'undefined' || !chrome.storage?.onChanged) return () => undefined
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    const change = changes[storageKey]
    if (area !== 'session' || !change) return
    const previous = change.oldValue as AccountTokens | undefined
    const next = change.newValue as AccountTokens | undefined
    if (previous?.user.id !== next?.user.id || previous?.user.name !== next?.user.name
      || previous?.user.email !== next?.user.email) listener(next?.user ?? null, previous?.user ?? null)
  }
  chrome.storage.onChanged.addListener(changed)
  return () => chrome.storage.onChanged.removeListener(changed)
}
