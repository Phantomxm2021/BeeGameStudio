import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createAgentWorkflowApp } from '../app'

describe('realtime billing routes', () => {
  test('exposes the realtime usage wallet', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'beegame-realtime-routes-'))
    try {
      const app = createAgentWorkflowApp({
        dashboardDataRoot: dataRoot,
        currentUser: { id: 'realtime-user', role: 'owner' },
        modelConfigStore: false,
        skillsConfig: false,
      })

      const walletResponse = await app.request('/api/usage-wallet')
      expect(walletResponse.status).toBe(200)
      expect(await walletResponse.json()).toEqual({
        userId: 'realtime-user',
        includedCreditsMicro: 300_000_000,
        consumedCreditsMicro: 0,
        balanceCreditsMicro: 300_000_000,
      })
    } finally {
      await rm(dataRoot, { recursive: true, force: true })
    }
  })
})
