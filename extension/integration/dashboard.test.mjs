import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import test from 'node:test'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const backend = resolve('../backend')
const localPython = resolve(process.platform === 'win32'
  ? '../.venv/Scripts/python.exe' : '../.venv/bin/python')
const python = process.env.PYTHON || (existsSync(localPython) ? localPython : 'python')

test('real API: registration, opt-in saving, report contract, ownership and deletion', { timeout: 90_000 }, async () => {
  const api = spawn(python, ['-u', '-m', 'tests.browser_server'], {
    cwd: backend, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let diagnostics = ''
  api.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-8000) })
  const lines = createInterface({ input: api.stdout })
  let vite
  let browser
  try {
    const apiUrl = await new Promise((resolveUrl, reject) => {
      const timer = setTimeout(() => reject(new Error(`API startup timed out: ${diagnostics}`)), 20_000)
      const finish = (error, url) => {
        clearTimeout(timer)
        api.off('error', failed)
        api.off('exit', exited)
        lines.off('line', line)
        if (error) reject(error)
        else resolveUrl(url)
      }
      const failed = (error) => finish(error)
      const exited = (code) => finish(new Error(`API exited (${code}): ${diagnostics}`))
      const line = (value) => {
        if (value.startsWith('BROWSER_API=')) finish(null, value.slice('BROWSER_API='.length))
      }
      api.once('error', failed)
      api.once('exit', exited)
      lines.on('line', line)
    })
    // The address is announced before Uvicorn starts accepting requests.
    await assert.doesNotReject(async () => {
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(1000) })
          if (response.ok) return
        } catch { /* Wait for startup, with a bounded deadline. */ }
        await new Promise((done) => setTimeout(done, 100))
      }
      throw new Error(`API not ready: ${diagnostics}`)
    })
    vite = await createServer({
      define: { 'import.meta.env.VITE_API_BASE_URL': JSON.stringify(`${apiUrl}/api/v1`) },
      server: { host: '127.0.0.1', port: 0, open: false },
    })
    await vite.listen()
    const dashboardUrl = `http://127.0.0.1:${vite.httpServer.address().port}/#dashboard`
    browser = await chromium.launch({ channel: 'chromium', headless: true })
    const page = await browser.newPage()
    page.setDefaultTimeout(10_000)
    await page.goto(dashboardUrl)
    await page.getByRole('button', { name: 'New here? Create an account' }).click()
    await page.getByLabel('Name', { exact: true }).fill('Browser Tester')
    await page.getByLabel('Email').fill('browser@example.com')
    await page.getByLabel('Password').fill('browser integration password')
    const registered = page.waitForResponse(`${apiUrl}/api/v1/auth/register`)
    await page.getByRole('button', { name: 'Create account', exact: true }).click()
    const registration = await registered
    assert.equal(registration.status(), 201, await registration.text())
    await page.getByText('Your library starts here').waitFor()

    const profile = page.getByRole('form', { name: 'Edit profile' })
    assert.equal(await profile.getByRole('button', { name: 'Save name' }).isDisabled(), true)
    await profile.getByLabel('Display name').fill('Temporary draft')
    await profile.getByRole('button', { name: 'Reset', exact: true }).click()
    assert.equal(await profile.getByLabel('Display name').inputValue(), 'Browser Tester')
    await profile.getByLabel('Display name').fill('   ')
    assert.equal(await profile.getByRole('button', { name: 'Save name' }).isDisabled(), true)
    await profile.getByLabel('Display name').fill('  Renée Browser  ')
    await profile.getByRole('button', { name: 'Save name' }).click()
    await page.getByText('Display name updated.', { exact: true }).waitFor()
    assert.equal(await profile.getByLabel('Display name').inputValue(), 'Renée Browser')
    await page.reload()
    await page.locator('.dashboard-account').getByText('Renée Browser', { exact: true }).waitFor()

    const popup = await browser.newPage({ viewport: { width: 440, height: 800 } })
    await popup.goto(dashboardUrl.replace('#dashboard', ''))
    await popup.getByText('Paste agreement text instead', { exact: true }).click()
    await popup.getByLabel('Agreement source URL').fill('https://example.test/trial')
    await popup.getByLabel('Agreement text', { exact: true }).fill('7-day free trial. After the trial, $49.99 per month will be charged automatically until cancellation.')
    await popup.getByRole('button', { name: 'Use this text', exact: true }).click()
    assert.equal(await popup.getByRole('button', { name: 'Analyze page', exact: true }).isDisabled(), true)
    await popup.getByLabel('I reviewed the text and want to send it for analysis.').check()
    await popup.getByRole('button', { name: 'Analyze page', exact: true }).click()
    await popup.getByRole('region', { name: 'Analysis results', exact: true }).waitFor()
    await mkdir(resolve('../release/screenshots'), { recursive: true })
    await popup.locator('.popup-shell').evaluate((element) => { element.scrollTop = 0 })
    await popup.locator('.popup-shell').screenshot({ path: resolve('../release/screenshots/popup.png') })
    await popup.close()

    // Use the same session and analysis client as the popup, without activeTab automation.
    const report = await page.evaluate(async () => {
      const { requestAnalysis } = await import('/src/api/client.ts')
      const context = {
        url: 'https://example.test/trial', title: 'Synthetic trial', sections: [{
          section_id: 'pricing-1', heading: 'Trial terms', source_url: 'https://example.test/trial',
          text: '7-day free trial. After the trial, $49.99 per month will be charged automatically until cancellation.',
        }],
      }
      const guest = await requestAnalysis(context)
      if (guest.analysis_id !== null) throw new Error('Guest report was persisted')
      const { account } = await import('/src/account/client.ts')
      const history = await (await account.request('/analyses')).json()
      if (history.total !== 0) throw new Error('History changed without save consent')
      return requestAnalysis(context, true)
    })
    assert.ok(report.analysis_id)
    assert.ok(report.findings.length > 0)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: 'View report' }).click()
    await page.getByRole('region', { name: 'Report for example.test' }).waitFor()
    // Opening the real saved snapshot exercises the runtime response parser.
    assert.equal(await page.getByRole('alert').count(), 0)
    await page.screenshot({ path: resolve('../release/screenshots/dashboard.png'), fullPage: true })

    await page.getByRole('button', { name: 'Set account reminder', exact: true }).first().click()
    const accountReminder = page.getByRole('form', { name: 'Account reminder', exact: true })
    const localFuture = async (days) => await page.evaluate((count) => {
      const date = new Date(Date.now() + count * 86400000)
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
    }, days)
    await accountReminder.getByLabel('Confirmed event time').fill(await localFuture(3))
    await accountReminder.getByLabel('Account reminder time').fill(await localFuture(2))
    await accountReminder.getByLabel('Account event note').fill('Review confirmed trial date')
    await accountReminder.getByRole('checkbox').check()
    await accountReminder.getByRole('button', { name: 'Save account reminder', exact: true }).click()
    await page.getByRole('button', { name: 'Edit account reminder', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Edit account reminder', exact: true }).click()
    await accountReminder.getByLabel('Account event note').fill('Updated account reminder note')
    await accountReminder.getByRole('checkbox').check()
    await accountReminder.getByRole('button', { name: 'Save account reminder', exact: true }).click()
    await page.getByText('Updated account reminder note', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Cancel account reminder', exact: true }).click()
    await page.locator('.account-event-list').getByText('cancelled', { exact: true }).waitFor()

    const otherAccount = await fetch(`${apiUrl}/api/v1/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Other', email: 'other@example.com', password: 'other integration password' }),
    })
    assert.equal(otherAccount.status, 201)
    const other = await otherAccount.json()
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(`${apiUrl}/api/v1/analyses/${report.analysis_id}`, {
        method, headers: { Authorization: `Bearer ${other.access_token}` },
      })
      assert.equal(response.status, 404)
    }
    await page.getByRole('button', { name: 'Delete', exact: true }).click()
    await page.getByRole('button', { name: 'Delete report', exact: true }).click()
    await page.getByText('Your library starts here').waitFor()
    const missingStatus = await page.evaluate(async (id) => {
      const { account } = await import('/src/account/client.ts')
      try { return (await account.request(`/analyses/${id}`)).status }
      catch (error) { return error.status }
    }, report.analysis_id)
    assert.equal(missingStatus, 404)
    await page.getByRole('button', { name: 'Sign out', exact: true }).click()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await page.getByLabel('Email').fill('browser@example.com')
    await page.getByLabel('Password').fill('browser integration password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByText('Your library starts here').waitFor()

    const tokensBeforeDeletion = await page.evaluate(() => JSON.parse(sessionStorage.getItem('before-you-agree:account-session')))
    await page.getByRole('button', { name: 'Delete account', exact: true }).click()
    const deletion = page.getByRole('form', { name: 'Confirm account deletion' })
    assert.equal(await deletion.getByLabel('Current password').evaluate((input) => input === document.activeElement), true)
    assert.equal(await deletion.getByRole('button', { name: 'Permanently delete account' }).isDisabled(), true)
    await deletion.getByRole('button', { name: 'Keep my account' }).click()
    assert.equal(await page.getByRole('form', { name: 'Confirm account deletion' }).count(), 0)
    await page.getByRole('button', { name: 'Delete account', exact: true }).click()
    await deletion.getByLabel('Current password').fill('incorrect password')
    await deletion.getByRole('checkbox').check()
    await deletion.getByRole('button', { name: 'Permanently delete account' }).click()
    await deletion.getByRole('alert').getByText('Current password is incorrect.').waitFor()
    assert.equal(await deletion.getByLabel('Current password').inputValue(), '')
    assert.equal(await page.getByRole('button', { name: 'Sign out', exact: true }).count(), 1)
    // Retain a report to verify deletion removes the library, rather than only an empty account.
    const retained = await page.evaluate(async () => {
      const { requestAnalysis } = await import('/src/api/client.ts')
      return requestAnalysis({
        url: 'https://example.test/trial', title: 'Trial', sections: [{
          section_id: 'trial-1', source_url: 'https://example.test/trial',
          text: '7-day free trial. After the trial, $49.99 per month will be charged automatically until cancellation.',
        }],
      }, true)
    })
    assert.ok(retained.analysis_id)
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await page.getByRole('button', { name: 'View report' }).waitFor()
    await deletion.getByLabel('Current password').fill('browser integration password')
    await deletion.getByRole('button', { name: 'Permanently delete account' }).click()
    await page.getByText('Your account and saved data were deleted. Browser reminders remain on this device.').waitFor()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    assert.equal(await page.getByRole('button', { name: 'View report' }).count(), 0)
    assert.equal(await page.evaluate(() => sessionStorage.getItem('before-you-agree:account-session')), null)
    assert.equal((await fetch(`${apiUrl}/api/v1/users/me`, {
      headers: { Authorization: `Bearer ${tokensBeforeDeletion.access_token}` },
    })).status, 401)
    await page.reload()
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    await page.getByLabel('Email').fill('browser@example.com')
    await page.getByLabel('Password').fill('browser integration password')
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await page.getByRole('alert').getByText('Invalid or expired credentials').waitFor()
  } finally {
    await browser?.close()
    await vite?.close()
    lines.close()
    if (api.exitCode === null && api.signalCode === null) {
      const exited = once(api, 'exit')
      const timer = setTimeout(() => api.kill(), 5000)
      api.stdin.end()
      try { await exited } finally { clearTimeout(timer) }
    }
  }
})
