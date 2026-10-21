import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'

test('capability API returns defaults and round-trips both states under existing permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-capability-api-'))
  const cleanups: Array<() => void> = []
  const app = createAgentWorkflowApp({
    dashboardDataRoot: root, modelConfigStore: false, skillsConfig: false,
    currentUserResolver: async () => ({ id: 'fixture-owner', role: 'owner' }),
    registerCleanup: cleanup => cleanups.push(cleanup),
  })
  const fields = ['resourceLibraryEnabled']
  try {
    const defaults = Object.fromEntries(fields.map(key => [key, true]))
    expect(await (await app.request('/api/runtime-settings')).json()).toMatchObject(defaults)
    for (const enabled of [true, false]) {
      const config = Object.fromEntries(fields.map(key => [key, enabled]))
      const response = await app.request('/api/runtime-settings', {
        method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(config),
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject(config)
      expect(await (await app.request('/api/runtime-settings')).json()).toMatchObject(config)
    }
  } finally {
    cleanups.forEach(cleanup => cleanup())
    await rm(root, { recursive: true, force: true })
  }
})
