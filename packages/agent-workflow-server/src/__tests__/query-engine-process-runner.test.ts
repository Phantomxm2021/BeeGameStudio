import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProcessIsolatedQueryEngineRunner } from '../beegame/query-engine-process-runner'

describe('process-isolated QueryEngine runner', () => {
  test('starts independent session workers without sharing the server process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'beegame-runtime-worker-'))
    const runner = createProcessIsolatedQueryEngineRunner()
    try {
      const [first, second] = await Promise.all([
        runner.start({
          sessionId: 'worker-session-a',
          cwd,
          env: {},
          approvedOutboundTargets: {},
        }),
        runner.start({
          sessionId: 'worker-session-b',
          cwd,
          env: {},
          approvedOutboundTargets: {},
        }),
      ])

      expect(first).not.toBe(second)
      first.dispose?.()
      second.dispose?.()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
