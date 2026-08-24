import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryWorkflowController } from './controller'
import { createRunStore } from './run-store'
import type { DeliveryRun } from './types'

function runWithEightCommittedDocs(): DeliveryRun {
  const paths = [
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
    'docs/ASSET_PLAN.md',
  ] as const
  return {
    schemaVersion: 28,
    runId: 'run-cutover',
    projectId: 'project-cutover',
    ownerId: 'owner-cutover',
    confirmedBriefDigest: 'a'.repeat(64),
    confirmedBriefContext: 'confirmed brief',
    phase: 'DOCUMENT_DRAFTING',
    status: 'running',
    revision: { document: 'b'.repeat(64), workspace: 'c'.repeat(64) },
    tasks: [],
    evidence: {},
    foundationDraftState: {
      completedPaths: [...paths],
      documents: paths.map(path => ({ path, status: 'committed' as const })),
    },
    resourceProductionState: { currentTask: 'RESOURCE_PLAN' },
    createdAt: '2026-08-24T00:00:00.000Z',
    updatedAt: '2026-08-24T00:00:00.000Z',
  }
}

describe('foundation audit cutover', () => {
  test('does not dispatch a legacy reviewer after the eighth author receipt', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-cutover-'))
    const dispatches: unknown[] = []
    try {
      const run = runWithEightCommittedDocs()
      const store = createRunStore(workspacePath, run.ownerId)
      await store.save(run)
      const controller = createDeliveryWorkflowController({
        workspacePath,
        ownerId: run.ownerId,
        workerPort: {
          start: async request => {
            dispatches.push(request)
            throw new Error('legacy reviewer dispatch must not start')
          },
          submit: async () => undefined,
          stop: async () => undefined,
          status: async () => {
            throw new Error('no dispatch should exist')
          },
        },
      })
      await controller.resume(run)
      const saved = await store.load()

      expect(dispatches).toEqual([])
      expect(saved).toMatchObject({
        phase: 'DOCUMENT_REVIEW',
        status: 'needs_action',
        blockedReason: 'foundation audit implementation unavailable',
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
