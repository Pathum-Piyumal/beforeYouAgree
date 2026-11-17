import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { stripTypeScriptTypes } from 'node:module'
import test from 'node:test'
import vm from 'node:vm'

const source = stripTypeScriptTypes(readFileSync(new URL('../src/account/session.ts', import.meta.url), 'utf8'))
  .replace(/^export /gm, '')
const context = vm.createContext({ Headers })
vm.runInContext(`${source}\nglobalThis.Manager = SessionManager`, context)
const Manager = context.Manager
const user = { id: 'user-1', name: 'User', email: 'user@example.com' }
const oldTokens = { access_token: 'old-access', refresh_token: 'old-refresh', user }
const nextTokens = { access_token: 'new-access', refresh_token: 'new-refresh', user }
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

function setup(transport, initial = oldTokens) {
  let tokens = initial && structuredClone(initial)
  let queue = Promise.resolve()
  const store = { read: async () => tokens, write: async (value) => { tokens = value } }
  const lock = (operation) => {
    const result = queue.then(operation)
    queue = result.catch(() => undefined)
    return result
  }
  return { manager: new Manager(store, transport, lock), tokens: () => tokens, store, lock }
}

test('refresh is shared across concurrent extension pages and replaces both tokens', async () => {
  let refreshes = 0
  const transport = async (path, init) => {
    if (path === '/auth/refresh') {
      refreshes++
      assert.equal(JSON.parse(init.body).refresh_token, 'old-refresh')
      return json(nextTokens)
    }
    return init.headers.get('Authorization') === 'Bearer new-access'
      ? json({ ok: true }) : json({ error: { message: 'Expired' } }, 401)
  }
  const app = setup(transport)
  const otherPage = new Manager(app.store, transport, app.lock)
  const results = await Promise.all([app.manager.request('/users/me'), otherPage.request('/analyses')])
  assert.ok(results.every((response) => response.ok))
  assert.equal(refreshes, 1)
  assert.equal(app.tokens().refresh_token, 'new-refresh')
})

test('revoked refresh clears credentials and requires sign-in', async () => {
  const app = setup(async () => json({ error: { message: 'Expired' } }, 401))
  await assert.rejects(app.manager.request('/users/me'), { status: 401 })
  assert.equal(app.tokens(), null)
  await assert.rejects(app.manager.request('/users/me'), { status: 401 })
})

test('network failures preserve the session and do not loop', async () => {
  let calls = 0
  const app = setup(async () => { calls++; throw new Error('Offline') })
  await assert.rejects(app.manager.request('/users/me'), /Offline/)
  assert.equal(calls, 1)
  assert.equal(app.tokens().refresh_token, 'old-refresh')
})

test('logout clears local credentials even if the server cannot be reached', async () => {
  const app = setup(async () => { throw new Error('Offline') })
  await assert.rejects(app.manager.signOut(), /Offline/)
  assert.equal(app.tokens(), null)
})

test('login and registration store returned credentials without storing the password', async () => {
  const paths = []
  const app = setup(async (path, init) => {
    paths.push(path)
    assert.equal(JSON.parse(init.body).password, 'a secret password')
    return json(nextTokens)
  }, null)
  await app.manager.signIn({ email: user.email, password: 'a secret password' })
  await app.manager.signIn({ email: user.email, password: 'a secret password', name: user.name }, true)
  assert.deepEqual(paths, ['/auth/login', '/auth/register'])
  assert.equal(app.tokens().password, undefined)
  assert.equal((await app.manager.user()).id, user.id)
})

test('failed login preserves an existing session and malformed replies are rejected', async () => {
  const denied = setup(async () => json({ error: { message: 'Invalid credentials' } }, 401))
  await assert.rejects(denied.manager.signIn({ email: user.email, password: 'wrong password' }), /Invalid credentials/)
  assert.equal(denied.tokens().access_token, 'old-access')
  const malformed = setup(async () => json({ access_token: 'incomplete' }), null)
  await assert.rejects(malformed.manager.signIn({ email: user.email, password: 'a secret password' }), /Invalid account response/)
  assert.equal(malformed.tokens(), null)
})

test('account deletion clears the shared session before another page can send a request', async () => {
  const calls = []
  const app = setup(async (path, init) => {
    calls.push(path)
    assert.equal(init.method, 'DELETE')
    assert.equal(init.headers.get('Authorization'), 'Bearer old-access')
    assert.deepEqual(JSON.parse(init.body), { password: 'current secret password' })
    return new Response(null, { status: 204 })
  })
  const secondPage = new Manager(app.store, async () => { throw new Error('Must not send') }, app.lock)
  const results = await Promise.allSettled([
    app.manager.deleteAccount('current secret password'), secondPage.request('/analyses'),
  ])
  assert.equal(results[0].status, 'fulfilled')
  assert.equal(results[1].reason.status, 401)
  assert.deepEqual(calls, ['/users/me'])
  assert.equal(app.tokens(), null)
})

test('incorrect deletion password and network failure preserve the shared session', async () => {
  let calls = 0
  const denied = setup(async () => {
    calls++
    return json({ error: { message: 'Current password is incorrect.' } }, 403)
  })
  await assert.rejects(denied.manager.deleteAccount('incorrect password'), { status: 403 })
  assert.equal(calls, 1)
  assert.equal(denied.tokens().access_token, 'old-access')
  const offline = setup(async () => { throw new Error('Offline') })
  await assert.rejects(offline.manager.deleteAccount('current secret password'), /Offline/)
  assert.equal(offline.tokens().access_token, 'old-access')
})

test('account deletion refreshes expired credentials before deleting and clearing tokens', async () => {
  let deletions = 0
  const app = setup(async (path, init) => {
    if (path === '/auth/refresh') return json(nextTokens)
    deletions++
    assert.equal(init.method, 'DELETE')
    return init.headers.get('Authorization') === 'Bearer new-access'
      ? new Response(null, { status: 204 }) : json({ error: { message: 'Expired' } }, 401)
  })
  await app.manager.deleteAccount('current secret password')
  assert.equal(deletions, 2)
  assert.equal(app.tokens(), null)
})

test('name update refreshes expired tokens and preserves the replacement credentials', async () => {
  const profile = { ...user, name: 'Updated User' }
  const app = setup(async (path, init) => {
    if (path === '/auth/refresh') return json(nextTokens)
    assert.equal(path, '/users/me')
    assert.equal(init.method, 'PATCH')
    assert.deepEqual(JSON.parse(init.body), { name: profile.name })
    return init.headers.get('Authorization') === 'Bearer new-access'
      ? json(profile) : json({ error: { message: 'Expired' } }, 401)
  })
  assert.equal((await app.manager.updateName(profile.name)).name, profile.name)
  assert.equal(app.tokens().access_token, 'new-access')
  assert.equal(app.tokens().refresh_token, 'new-refresh')
  assert.equal(app.tokens().user.name, profile.name)
})

test('failed or malformed profile updates leave the cached profile intact', async () => {
  const invalid = [null, { ...user, id: 'other-user' }, { ...user, email: 'other@example.com' }, { ...user, name: null }]
  for (const body of invalid) {
    const app = setup(async () => json(body))
    await assert.rejects(app.manager.updateName('Updated'), /Invalid profile response/)
    assert.equal(app.tokens().user.name, user.name)
  }
  const rejected = setup(async () => json({ error: { message: 'Invalid name' } }, 422))
  await assert.rejects(rejected.manager.updateName(' '), { status: 422 })
  assert.equal(rejected.tokens().user.name, user.name)
  const offline = setup(async () => { throw new Error('Offline') })
  await assert.rejects(offline.manager.updateName('Updated'), /Offline/)
  assert.equal(offline.tokens().user.name, user.name)
})
