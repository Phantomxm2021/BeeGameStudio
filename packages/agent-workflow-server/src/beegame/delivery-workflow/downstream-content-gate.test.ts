import { expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { startNextImplementationTask } from './implementation-stage'
import { enterAcceptance } from './validation-stage'

function implementationRun() {
  const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
  return {
    ...base,
    phase: 'IMPLEMENTATION' as const,
    tasks: [{
      id: 'DIRECT_IMPLEMENTATION', title: 'Implement', checklistIds: [],
      resourceIds: [], contentIds: ['scene.main'], allowedPaths: ['./'],
      status: 'pending' as const, attempt: 0, evidenceRefs: [],
    }],
  }
}

test('implementation cannot bypass the accepted Scene/UI package', async () => {
  const run = implementationRun()
  await expect(startNextImplementationTask({
    run,
    workspacePath: '/unused',
    revision: run.revision.workspace,
    dispatcher: { async dispatch() { throw new Error('must not dispatch') } },
  })).rejects.toThrow('exact accepted Scene/UI content package')
})

test('acceptance cannot bypass the accepted Scene/UI package', () => {
  const run = implementationRun()
  const completed = {
    ...run,
    tasks: run.tasks.map(task => ({
      ...task,
      status: 'completed' as const,
      completedRevision: run.revision.workspace,
      evidenceRefs: ['evidence.json'],
    })),
  }
  expect(() => enterAcceptance(completed)).toThrow('accepted Scene/UI content package')
})
