import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { retryRun } from './recovery'
import { computeWorkspaceRevision } from './revision'
import { createRunStore } from './run-store'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

test('acceptance retry rebinds a legacy revision mismatch to the current stable workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-acceptance-retry-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/game.ts'), 'export const game = true\n')
  const currentRevision = await computeWorkspaceRevision(workspace)
  const initial = createTestDeliveryRun({
    runId: 'acceptance-retry-run',
    projectId: 'acceptance-retry-project',
    ownerId: 'owner-1',
  })
  const store = createRunStore(workspace, 'owner-1')
  await store.save({
    ...initial,
    phase: 'ACCEPTANCE',
    status: 'needs_action',
    blockedReason: 'acceptance evidence does not match the workspace',
    revision: {
      ...initial.revision,
      workspace: 'legacy-workspace-revision',
      implementation: 'legacy-workspace-revision',
    },
    tasks: [
      {
        id: 'DIRECT_IMPLEMENTATION',
        title: 'Implement the game',
        checklistIds: [],
        resourceIds: [],
        contentIds: [],
        allowedPaths: ['./'],
        status: 'completed',
        attempt: 1,
        completedRevision: 'legacy-workspace-revision',
        evidenceRefs: ['.beegame/workflow/evidence/implementation.json'],
      },
    ],
    activeDispatch: {
      dispatchId: 'legacy-acceptance-dispatch',
      workerType: 'acceptance-validator',
      phase: 'ACCEPTANCE',
      revision: 'legacy-workspace-revision',
      status: 'failed',
      failureReason: 'acceptance evidence does not match the workspace',
      startedAt: '2026-09-17T00:00:00.000Z',
      finishedAt: '2026-09-17T00:01:00.000Z',
    },
  })

  const retried = await retryRun({
    store,
    runId: initial.runId,
    workspacePath: workspace,
  })

  expect(retried.status).toBe('running')
  expect(retried.activeDispatch).toBeUndefined()
  expect(retried.revision.workspace).toBe(currentRevision)
  expect(retried.revision.implementation).toBe(currentRevision)
})
