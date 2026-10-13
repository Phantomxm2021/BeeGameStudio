import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { registerV3DebugPage } from './debug-page'
import { createAgentWorkflowApp } from '../../app'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

test('debug page is absent by default and cannot expose a shell on public hosts', async () => {
  const closed = new Hono(); registerV3DebugPage(closed)
  expect((await closed.request('http://localhost/debug/workflow-v3')).status).toBe(404)
  const enabled = new Hono(); registerV3DebugPage(enabled, true)
  for (const host of ['public.example', '127.0.0.1.evil.example']) {
    expect((await enabled.request('https://' + host + '/debug/workflow-v3')).status).toBe(404)
    expect((await enabled.request('https://' + host + '/debug/workflow-v3/client.js')).status).toBe(404)
  }
  const response = await enabled.request('http://localhost/debug/workflow-v3')
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('content-security-policy')).toContain("connect-src 'self'")
  expect(await response.text()).toContain('仅当前页内存')
  const page=await (await enabled.request('http://localhost/debug/workflow-v3')).text()
  expect(page).toContain('修复现有需求请选择“按现有目标检查／修复，不变更需求”')
  expect(page).toContain('只有改变用户目标或承诺才选择')
  expect(page).not.toContain('需要修复时自行选择“明确变更需求并修改”')
  // Serving an inert shell adds no API, credentials or execution authority.
  expect((await enabled.request('http://localhost/api/projects/p/workflow-v3')).status).toBe(404)
  expect((await enabled.request('http://localhost/debug/workflow-v3', { method: 'POST' })).status).toBe(404)
  const script = await (await enabled.request('http://localhost/debug/workflow-v3/client.js')).text()
  expect(script).not.toContain('localStorage')
  expect(script).not.toContain('sessionStorage')
  expect(script).not.toContain('setInterval')
  expect(script).not.toContain('innerHTML')
  expect(page).toContain('<dialog id="action-confirm"')
  expect(script).toContain('await confirmAction(')
  expect(script).not.toMatch(/\b(?:alert|confirm|prompt)\(/)
  expect(script).not.toContain("'candidate-preview'")
  expect(script).toContain("{ decision: 'deny', scope: 'once', message }")
})

test('actual BGS app opt-in debug shell leaves normal API authentication intact', async () => {
  const prior = process.env.BEEGAME_WORKFLOW_V3_DEBUG
  const root = await mkdtemp(join(tmpdir(), 'bgs-v3-debug-auth-'))
  const cleanups: (() => void | Promise<void>)[] = []
  let starts = 0
  try {
    process.env.BEEGAME_WORKFLOW_V3_DEBUG = '1'
    const app = createAgentWorkflowApp({ dashboardDataRoot: root, workflowV3Store: false,
      modelConfigStore: false, skillsConfig: false, currentUserResolver: () => undefined,
      registerCleanup: fn => cleanups.push(fn),
      sessionRunner: { async start() { starts++; throw Error('No native call permitted') } } })
    expect((await app.request('http://localhost/debug/workflow-v3')).status).toBe(200)
    expect((await app.request('http://localhost/debug/workflow-v3/client.js')).status).toBe(200)
    expect((await app.request('http://localhost/api/projects/p/workflow-v3')).status).toBe(401)
    expect((await app.request('http://localhost/api/projects/p/workflow-v3/tasks/game/execute', {method:'POST'})).status).toBe(401)
    expect((await app.request('https://public.example/debug/workflow-v3')).status).toBe(404)
    expect(starts).toBe(0)
  } finally {
    if (prior === undefined) delete process.env.BEEGAME_WORKFLOW_V3_DEBUG
    else process.env.BEEGAME_WORKFLOW_V3_DEBUG = prior
    await Promise.all(cleanups.map(fn => fn()))
    await rm(root, { recursive: true, force: true })
  }
})
