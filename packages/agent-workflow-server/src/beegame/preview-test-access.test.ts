import { expect, test } from 'bun:test'
import { openPreviewTestAccess } from './preview-test-access'
import { PREVIEW_IFRAME_SANDBOX } from '@bee-game-studio/agent-workflow/preview-environment'

test('preview capability exposes only its owned preview and revokes browser access on close', async () => {
  let started = 0, stopped = 0, browserClosed = 0
  let snapshot = { status: 'idle', url: '' }
  const access = openPreviewTestAccess({
    start: async mode => { started++; snapshot = { status: 'running', url: `http://127.0.0.1:62174/previews/owned/?mode=${mode}&token=test` }; return snapshot },
    status: () => snapshot,
    stop: () => { stopped++ },
    browser: { start: async () => ({ endpoint: 'ws://127.0.0.1:1234/owned' }),
      status: () => ({ status: 'not-running' }), close: async () => { browserClosed++ } },
  })
  try {
    expect((await fetch(access.baseUrl + '/host')).status).toBe(503)
    expect((await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
      targetId: 'target', label: 'test', conditions: '', outputRoot: '/outside',
    }) })).status).toBe(400)
    expect((await fetch(access.baseUrl + '/recordings', { method: 'POST', body: JSON.stringify({
      targetId: 'target', label: 'test', conditions: '',
    }) })).status).toBe(409)
    expect((await fetch(access.baseUrl + '/recordings/00000000-0000-0000-0000-000000000000')).status).toBe(404)
    expect((await fetch(access.baseUrl + '/status', { headers: { origin: 'https://evil.test' } })).status).toBe(404)
    expect((await fetch(access.baseUrl + '/preview', { method: 'POST', body: JSON.stringify({ mode: 'production', workspacePath: '/other' }) })).status).toBe(400)
    const response = await fetch(access.baseUrl + '/preview', { method: 'POST', body: JSON.stringify({ mode: 'production' }) })
    const result = await response.json() as any
    expect(result.frameSelector).toBe('#beegame-preview')
    expect(result.environment.origin).toBe('opaque')
    const refreshed = await (await fetch(access.baseUrl + '/status')).json() as any
    expect(refreshed.hostUrl).toBe(result.hostUrl)
    expect(refreshed.environment.sandbox).toBe(PREVIEW_IFRAME_SANDBOX)
    expect(access.instruction).toContain('Read hostUrl/endpoint from JSON')
    const html = await (await fetch(result.hostUrl)).text()
    expect(html).toContain(`sandbox="${PREVIEW_IFRAME_SANDBOX}"`)
    expect(html).not.toContain('allow-same-origin')
    expect(html).toContain('/previews/owned/')
    expect(html).toContain('&amp;token=test')
    const browser = await fetch(access.baseUrl + '/browser', { method: 'POST' })
    expect(browser.status).toBe(200)
    expect((await browser.json() as any).playwrightRuntime).toBe('node')
    expect(started).toBe(1)
  } finally { await access.close() }
  expect(stopped).toBe(1)
  expect(browserClosed).toBe(1)
  await expect(fetch(access.baseUrl + '/status')).rejects.toThrow()
})

test('browser startup failure is not reported as a ready test environment', async () => {
  const access = openPreviewTestAccess({ start: async () => ({ status: 'failed' }), status: () => ({ status: 'idle' }), stop() {},
    browser: { start: async () => { throw new Error('MachPort denied') }, status: () => ({ status: 'not-running' }), close: async () => {} } })
  try {
    const result = await fetch(access.baseUrl + '/browser', { method: 'POST' })
    expect(result.status).toBe(503)
    expect(await result.json()).toEqual({ error: 'MachPort denied' })
  } finally { await access.close() }
})
