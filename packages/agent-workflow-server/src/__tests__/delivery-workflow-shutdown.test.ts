import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDeliveryWorkflowController } from '../beegame/delivery-workflow/controller'
import type { DeliveryRun, DispatchRecord } from '../beegame/delivery-workflow/types'
import { createTestDeliveryRun } from './delivery-workflow-test-helpers'

test('shutdown persists an interrupted implementation before closing its transport', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-workflow-shutdown-'))
  const dispatch: DispatchRecord = { dispatchId: 'implementation', workerType: 'implementation-worker',
    phase: 'IMPLEMENTATION', taskId: 'DIRECT_IMPLEMENTATION', revision: 'revision', status: 'running', startedAt: new Date().toISOString() }
  const run: DeliveryRun = { ...createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' }),
    phase: 'IMPLEMENTATION', status: 'running', activeDispatch: dispatch }
  let stoppedReason: string | undefined
  let snapshotAtStop: DeliveryRun | null | undefined
  const controller = createDeliveryWorkflowController({ workspacePath, ownerId: 'owner', workerPort: {
    async start() { throw new Error('No model calls allowed') }, async submit() { throw new Error('No model calls allowed') },
    async status() { return dispatch }, async stop(_id, reason) {
      snapshotAtStop = await controller.store.load()
      stoppedReason = reason
    },
  } })
  try {
    await controller.store.commit(run, { runId: run.runId, type: 'run.created', phase: run.phase, status: run.status, revision: run.revision })
    await controller.dispose()
    const saved = await controller.store.load()
    expect(saved).toMatchObject({ status: 'stopped', activeDispatch: { status: 'interrupted', failureReason: 'service_shutdown' } })
    for (let i = 0; i < 200 && !stoppedReason; i++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(stoppedReason).toBe('service_shutdown')
    expect(snapshotAtStop?.activeDispatch?.status).toBe('interrupted')
    await controller.dispose()
    expect(await controller.store.load()).toEqual(saved)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
