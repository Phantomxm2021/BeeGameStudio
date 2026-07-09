import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createBeeGameBillingServerApp } from '../index'

describe('BeeGame billing server package', () => {
  test('does not depend on the runtime host package', async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, '../../package.json'), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
    }
    expect(packageJson.dependencies).not.toHaveProperty(
      '@bee-game-studio/agent-workflow-server',
    )
  })

  test('exports a standalone billing app factory', async () => {
    const app = createBeeGameBillingServerApp({
      currentUser: {
        id: 'customer-a',
        role: 'developer',
      },
    })
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok', service: 'beegame-billing' })
  })
})
