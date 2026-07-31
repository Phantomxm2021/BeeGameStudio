import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProcessIsolatedQueryEngineRunner,
} from '../beegame/query-engine-process-runner'
import {
  deserializeQueryEngineStartInput,
  serializeQueryEngineStartInput,
} from '../beegame/query-engine-process-input'

describe('process-isolated QueryEngine runner', () => {
  test('preserves workflow permission identity across process serialization', () => {
    const serialized = serializeQueryEngineStartInput({
      sessionId: 'resource-worker',
      deliveryEvidenceDataRoot: '/tmp/evidence',
      cwd: '/tmp/project',
      env: {},
      approvedOutboundTargets: {},
      workflowWorker: true,
      workflowWorkerType: 'resource-preparer',
      workflowResourceAttemptMode: 'repair',
    })

    expect(deserializeQueryEngineStartInput(serialized)).toMatchObject({
      sessionId: 'resource-worker',
      deliveryEvidenceDataRoot: '/tmp/evidence',
      workflowWorker: true,
      workflowWorkerType: 'resource-preparer',
      workflowResourceAttemptMode: 'repair',
    })
  })

  test('starts independent session workers without sharing the server process', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'beegame-runtime-worker-'))
    const firstWorkspace = join(cwd, 'user-a', 'project')
    const secondWorkspace = join(cwd, 'user-b', 'project')
    await Promise.all([
      mkdir(firstWorkspace, { recursive: true }),
      mkdir(secondWorkspace, { recursive: true }),
    ])
    const runner = createProcessIsolatedQueryEngineRunner()
    try {
      const [first, second] = await Promise.all([
        runner.start({
          sessionId: 'worker-session-a',
          cwd: firstWorkspace,
          env: { BEEGAME_CONFIG_DIR: join(cwd, 'config-a') },
          approvedOutboundTargets: {},
        }),
        runner.start({
          sessionId: 'worker-session-b',
          cwd: secondWorkspace,
          env: { BEEGAME_CONFIG_DIR: join(cwd, 'config-b') },
          approvedOutboundTargets: {},
        }),
      ])

      expect(first).not.toBe(second)
      const firstPid = (first as unknown as { child: { pid: number } }).child.pid
      const secondPid = (second as unknown as { child: { pid: number } }).child.pid
      expect(firstPid).not.toBe(process.pid)
      expect(secondPid).not.toBe(process.pid)
      expect(firstPid).not.toBe(secondPid)
      first.dispose?.()
      second.dispose?.()
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })
})
