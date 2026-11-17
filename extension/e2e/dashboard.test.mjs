import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

test('dashboard account, report, deletion and cross-tab logout', { timeout: 60_000 }, async () => {
  const extensionPath = resolve('dist')
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let saved = true
  let logoutCalls = 0
  let deletionCalls = 0
  const user = { id: 'user-1', name: 'Test User', email: 'user@example.com' }
  const item = {
    id: 'analysis-1', domain: 'example.test', source_url: 'https://example.test/terms',
    score: 75, risk_band: 'high', status: 'partial', created_at: '2025-01-15T12:00:00Z',
    report_available: true,
  }
  const report = {
    analysis_id: item.id, status: 'partial', score: 75, risk_band: 'high', score_version: 'risk-v1',
    coverage: { status: 'partial', warnings: [] }, review_flags: [], metadata: null,
    score_coverage: 'partial', category_scores: [], dominant_contributions: [],
    score_explanation: 'Some categories were not assessed.', findings: [], timeline: [],
  }
  try {
    await context.route('http://localhost:8000/api/v1/**', async (route) => {
      const request = route.request()
      const path = new URL(request.url()).pathname
      let status = 200
      let body
      if (request.method() === 'OPTIONS') {
        status = 204
      } else if (path === '/api/v1/auth/register') {
        const input = request.postDataJSON()
        assert.equal(input.email, user.email)
        body = { access_token: 'access', refresh_token: 'refresh', user }
      } else if (path === '/api/v1/auth/login') {
        status = 401
        body = { error: { message: 'Invalid or expired credentials' } }
      } else if (path === '/api/v1/auth/logout') {
        logoutCalls++
        status = 204
      } else if (path === '/api/v1/users/me' && request.method() === 'DELETE') {
        assert.equal(request.postDataJSON().password, 'a secure test password')
        deletionCalls++
        status = 204
      } else if (path === '/api/v1/users/me' && request.method() === 'PATCH') {
        user.name = request.postDataJSON().name.trim()
        body = user
      } else if (path === '/api/v1/users/me') {
        body = user
      } else if (path === '/api/v1/dashboard/summary') {
        body = { analysis_count: Number(saved), finding_count: 0, commitment_count: 0,
          average_score: saved ? 75 : null,
          risk_distribution: { low: 0, moderate: 0, high: Number(saved), very_high: 0, unscored: 0 } }
      } else if (path === '/api/v1/commitments' || path === '/api/v1/reminders') {
        body = { items: [], total: 0, offset: 0, limit: 10 }
      } else if (path === '/api/v1/analyses' && request.method() === 'GET') {
        const risk = new URL(request.url()).searchParams.get('risk_band')
        const visible = saved && (!risk || risk === 'high')
        body = { items: visible ? [item] : [], total: Number(visible), offset: 0, limit: 10 }
      } else if (path === `/api/v1/analyses/${item.id}` && request.method() === 'GET') {
        body = report
      } else if (path === `/api/v1/analyses/${item.id}` && request.method() === 'DELETE') {
        saved = false
        status = 204
      } else {
        status = 404
        body = { error: { message: `Unexpected endpoint ${path}` } }
      }
      await route.fulfill({ status, headers: {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
        'Content-Type': 'application/json',
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const url = `chrome-extension://${new URL(worker.url()).hostname}/index.html#dashboard`
    const page = await context.newPage()
    await page.goto(url)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill('incorrect password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('alert').getByText('Invalid or expired credentials').waitFor()
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Name', { exact: true }).fill(user.name)
    await page.getByLabel('Password').fill('a secure test password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByText('example.test', { exact: true }).waitFor()
    await page.getByLabel('Risk level').selectOption('low')
    await page.getByText('No matching analyses').waitFor()
    await page.getByLabel('Risk level').selectOption('high')
    await page.getByRole('button', { name: 'View report' }).click()
    await page.getByText('Some categories were not assessed.').waitFor()
    await page.getByRole('button', { name: 'Close report' }).click()
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Keep report' }).click()
    assert.equal(saved, true)
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete report' }).click()
    await page.getByText('No matching analyses').waitFor()
    assert.equal(saved, false)
    const second = await context.newPage()
    await second.goto(url)
    await second.getByRole('button', { name: 'Sign out' }).waitFor()
    const profile = page.getByRole('form', { name: 'Edit profile' })
    await profile.getByLabel('Display name').fill('Updated Tester')
    await profile.getByRole('button', { name: 'Save name' }).click()
    await second.locator('.dashboard-account').getByText('Updated Tester', { exact: true }).waitFor()
    assert.equal(await second.getByLabel('Display name').inputValue(), 'Updated Tester')
    assert.equal(await page.getByLabel('Risk level').inputValue(), 'high')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await second.getByRole('heading', { name: 'Welcome back' }).waitFor()
    assert.equal(logoutCalls, 1)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Name', { exact: true }).fill(user.name)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password').fill('a secure test password')
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    await page.getByRole('button', { name: 'Delete account', exact: true }).click()
    await second.reload()
    await second.getByRole('button', { name: 'Sign out' }).waitFor()
    const deletion = page.getByRole('form', { name: 'Confirm account deletion' })
    await deletion.getByLabel('Current password').fill('a secure test password')
    await deletion.getByRole('checkbox').check()
    await deletion.getByRole('button', { name: 'Permanently delete account' }).click()
    await page.getByText('Your account and saved data were deleted. Browser reminders remain on this device.').waitFor()
    await second.getByRole('heading', { name: 'Welcome back' }).waitFor()
    assert.equal(deletionCalls, 1)
    assert.equal(logoutCalls, 1)
    assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get('before-you-agree:account-session'))['before-you-agree:account-session'] ?? null), null)
  } finally {
    await context.close()
  }
})
