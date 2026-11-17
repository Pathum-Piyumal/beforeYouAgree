import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { resolve } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

test('unpacked extension extracts a fixture and handles a popup without activeTab access', { timeout: 60_000 }, async () => {
  const fixtures = Object.fromEntries(await Promise.all(['free-trial', 'subscription', 'refund', 'privacy', 'irrelevant'].map(async (name) => [name, await readFile(new URL(`../tests/fixtures/${name}.html`, import.meta.url))])))
  const server = createServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(fixtures[request.url.slice(1)] ?? fixtures['free-trial'])
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let context
  try {
    const extensionPath = resolve('dist')
    context = await chromium.launchPersistentContext('', {
      channel: 'chromium', headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    })
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
    const extensionId = new URL(worker.url()).hostname
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${server.address().port}/trial`)
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extensionId}/index.html`)
    await popup.getByRole('button', { name: 'Inspect page' }).waitFor({ state: 'visible' })
    await popup.waitForFunction(() => !document.querySelector('button.secondary-button')?.disabled)
    await page.bringToFront()
    await popup.getByRole('button', { name: 'Inspect page' }).evaluate((button) => button.click())
    await popup.getByText('The active tab does not expose a page URL.').waitFor({ timeout: 10_000 })
    const result = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT', requestId: 'e2e' })
    })
    assert.equal(result.ok, true)
    assert.ok(result.data.sections.some((section) => section.text.includes('$49.99')))
    assert.ok(result.data.sections.every((section) => !section.text.includes('Home Pricing Support')))
    for (const [name, word] of [['subscription', 'membership'], ['refund', 'refund'], ['privacy', 'information'], ['irrelevant', 'pancake']]) {
      await page.goto(`http://127.0.0.1:${server.address().port}/${name}`)
      await page.bringToFront()
      const extracted = await worker.evaluate(async () => {
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
        return chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT', requestId: 'fixture' })
      })
      assert.ok(extracted.data.sections.some((section) => section.text.toLowerCase().includes(word)), name)
    }
    await page.evaluate(() => {
      document.body.innerHTML = '<main><h1>Privacy fixture</h1><div hidden><p>HIDDEN_SECRET_TOKEN</p></div><form><p>FORM_SECRET_TOKEN</p></form><div contenteditable><p>EDITABLE_SECRET_TOKEN</p></div><div class="advertisement"><p>ADVERTISEMENT_SECRET_TOKEN</p></div><p>Public terms apply to this agreement and may include future charges.</p></main><footer><h2>Cancellation policy</h2><p>Cancel at least 3 days before renewal by contacting support.</p></footer><a href="/privacy">Privacy policy</a>'
    })
    const privateFixture = await worker.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true })
      return chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_CONTEXT', requestId: 'privacy' })
    })
    assert.ok(privateFixture.data.sections.every((section) => !section.text.includes('SECRET_TOKEN')))
    assert.ok(privateFixture.data.sections.some((section) => section.text.includes('3 days before renewal')))
    assert.equal(privateFixture.data.policyLinks.length, 1)
  } finally {
    if (context) await context.close()
    await new Promise((resolveClose) => server.close(resolveClose))
  }
})
