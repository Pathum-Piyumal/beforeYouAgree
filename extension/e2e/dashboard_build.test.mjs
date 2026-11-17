import assert from 'node:assert/strict'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { resolve, extname, sep } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

test('standalone dashboard build opens directly at its root URL', { timeout: 30_000 }, async () => {
  const root = resolve('dashboard-dist')
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`)
    if (!path.startsWith(root + sep)) { response.writeHead(404).end(); return }
    try {
      const data = await readFile(path)
      response.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(path)] ?? 'application/octet-stream' })
      response.end(data)
    } catch { response.writeHead(404).end() }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  let browser
  try {
    browser = await chromium.launch({ channel: 'chromium', headless: true })
    const page = await browser.newPage()
    const failures = []
    page.on('pageerror', (error) => failures.push(error.message))
    await page.goto(`http://127.0.0.1:${server.address().port}/`)
    await page.getByRole('heading', { name: 'Welcome back' }).waitFor()
    assert.match(await page.title(), /Dashboard/)
    assert.deepEqual(failures, [])
  } finally {
    await browser?.close()
    await new Promise((done) => server.close(done))
  }
})
