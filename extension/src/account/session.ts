export type UserProfile = { id: string; name: string; email: string }
export type AccountTokens = {
  access_token: string
  refresh_token: string
  user: UserProfile
}
export type SessionStore = {
  read: () => Promise<AccountTokens | null>
  write: (tokens: AccountTokens | null) => Promise<void>
}
export type Transport = (path: string, init?: RequestInit) => Promise<Response>
export type SessionLock = <T>(operation: () => Promise<T>) => Promise<T>

export class AccountHttpError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'AccountHttpError'
    this.status = status
  }
}

async function requireSuccess(response: Response): Promise<Response> {
  if (response.ok) return response
  const payload = await response.json().catch(() => null)
  throw new AccountHttpError(payload?.error?.message ?? 'The account request failed.', response.status)
}

function parseTokens(value: unknown): AccountTokens {
  const tokens = value as Partial<AccountTokens> | null
  if (!tokens || typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string'
    || typeof tokens.user?.id !== 'string' || typeof tokens.user.name !== 'string'
    || typeof tokens.user.email !== 'string') throw new Error('Invalid account response.')
  return tokens as AccountTokens
}

export class SessionManager {
  private readonly store: SessionStore
  private readonly transport: Transport
  private readonly lock: SessionLock

  constructor(store: SessionStore, transport: Transport, lock: SessionLock) {
    this.store = store
    this.transport = transport
    this.lock = lock
  }

  async user(): Promise<UserProfile | null> {
    return (await this.store.read())?.user ?? null
  }

  signIn(values: { email: string; password: string; name?: string }, register = false): Promise<UserProfile> {
    return this.lock(async () => {
      const response = await requireSuccess(await this.transport(`/auth/${register ? 'register' : 'login'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values),
      }))
      const tokens = parseTokens(await response.json())
      await this.store.write(tokens)
      return tokens.user
    })
  }

  signOut(): Promise<void> {
    return this.lock(async () => {
      const tokens = await this.store.read()
      try {
        if (tokens) await requireSuccess(await this.transport('/auth/logout', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: tokens.refresh_token }),
        }))
      } finally {
        await this.store.write(null)
      }
    })
  }

  request(path: string, init: RequestInit = {}): Promise<Response> {
    return this.lock(() => this.authenticatedRequest(path, init))
  }

  deleteAccount(password: string): Promise<void> {
    return this.lock(async () => {
      await this.authenticatedRequest('/users/me', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      await this.store.write(null)
    })
  }

  updateName(name: string): Promise<UserProfile> {
    return this.lock(async () => {
      const response = await this.authenticatedRequest('/users/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const profile = await response.json() as UserProfile | null
      const tokens = await this.store.read()
      if (!tokens) throw new AccountHttpError('Sign in to update your profile.', 401)
      if (!profile || profile.id !== tokens.user.id || profile.email !== tokens.user.email
        || typeof profile.name !== 'string' || !profile.name.trim()) {
        throw new Error('Invalid profile response.')
      }
      const user = { id: profile.id, name: profile.name, email: profile.email }
      await this.store.write({ ...tokens, user })
      return user
    })
  }

  private async authenticatedRequest(path: string, init: RequestInit): Promise<Response> {
    let tokens = await this.store.read()
    if (!tokens) throw new AccountHttpError('Sign in to access your saved analyses.', 401)
    const send = () => {
      const headers = new Headers(init.headers)
      headers.set('Authorization', `Bearer ${tokens!.access_token}`)
      return this.transport(path, { ...init, headers })
    }
    let response = await send()
    if (response.status === 401) {
      const refreshed = await this.transport('/auth/refresh', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: tokens.refresh_token }),
      })
      if (refreshed.status === 401) await this.store.write(null)
      await requireSuccess(refreshed)
      tokens = parseTokens(await refreshed.json())
      await this.store.write(tokens)
      response = await send()
      if (response.status === 401) await this.store.write(null)
    }
    return requireSuccess(response)
  }
}
