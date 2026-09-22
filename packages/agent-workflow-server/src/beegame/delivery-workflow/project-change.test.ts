import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createDeliveryWorkflowController } from './controller'
import { buildWorkerPrompt } from './worker-prompts'
import { runtimeEvidenceIsCurrent } from './runtime-acceptance'
import type { DeliveryWorkerPort } from './types'

test('retired follow-up dispatch cannot rebuild or reset the delivery run', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-retired-change-'))
  let starts = 0
  const port: DeliveryWorkerPort = {
    async start() { starts++; throw new Error('Must not start a worker') },
    async submit() {}, async stop() {}, async status() { throw new Error('unused') },
  }
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: port })
  const run = { ...createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' }),
    phase: 'DELIVERY' as const, status: 'completed' as const }
  try {
    await controller.store.save(run)
    const before = await controller.store.load()
    await expect(controller.requestChange(run, 'Fix the button')).rejects.toThrow('native project conversation')
    expect(starts).toBe(0)
    expect(await controller.store.load()).toEqual(before)
    expect(() => buildWorkerPrompt({ runId: run.runId, ownerId: 'owner', projectId: 'project',
      workspacePath, workerType: 'implementation-worker', phase: 'DELIVERY', revision: 'old',
      contract: { purpose: 'project-change', changeRequest: 'Fix the button' } })).toThrow('native project conversation')
  } finally { await controller.dispose(); await rm(workspacePath, { recursive: true, force: true }) }
})

test('a local request report cannot certify complete delivery', async () => {
  expect(await runtimeEvidenceIsCurrent('/unused', [{ scope: 'request', status: 'passed',
    summary: 'One button fixed', environment: 'Unit test', evidence: [] }])).toBe(false)
})

test('resource/content ownership makes TileSet preparation visible without forcing its use', () => {
  const base = { runId: 'run', ownerId: 'owner', projectId: 'project', workspacePath: '/project',
    revision: 'revision', contract: {} }
  expect(buildWorkerPrompt({ ...base, workerType: 'resource-planner', phase: 'RESOURCE_PREPARATION' })).toContain('TileSet metadata is a resource-stage output')
  expect(buildWorkerPrompt({ ...base, workerType: 'content-author', phase: 'GAME_CONTENT' })).toContain('No mandatory Tilemap quota')
})
