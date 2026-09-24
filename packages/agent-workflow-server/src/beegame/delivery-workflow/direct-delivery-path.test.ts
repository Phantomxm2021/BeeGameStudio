import { expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { parseDeliveryRun } from './schema'

test('delivery controller has one direct implementation path', async () => {
  const controller = await readFile(
    new URL('./controller.ts', import.meta.url),
    'utf8',
  )
  const prompts = await readFile(
    new URL('./worker-prompts.ts', import.meta.url),
    'utf8',
  )

  expect(controller).not.toContain("workerType: 'atomic-task-planner'")
  expect(controller).not.toContain("workerType: 'implementation-auditor'")
  expect(controller).not.toContain("run.phase === 'ATOMIC_TASK_PLANNING'")
  expect(controller).not.toContain("run.phase === 'IMPLEMENTATION_AUDIT'")
  expect(controller).toContain('tasks: [directImplementationTask(facts)]')
  expect(controller).toContain("phase: 'IMPLEMENTATION'")
  expect(controller).not.toContain('resource.preparation.reconciled')
  expect(controller).toContain("'resource.preparation.ready'")
  expect(controller).toContain('enterAcceptance(next)')
  expect(controller).toContain('startAcceptance(')
  expect(controller).toContain('confirmAcceptanceFromValidator(')
  expect(controller).toContain("implementation.evidence.acceptance?.status !== 'passed'")
  expect(prompts).toContain("case 'acceptance-validator':")
  expect(prompts).not.toContain('Runtime acceptance is a separate phase')
  expect(prompts).not.toContain('validationCommand once')
  expect(prompts).not.toContain('resource-validation-cli')
  expect(prompts).not.toContain('Use contract.validationCommand when it helps validate the delivery')
})

test('current snapshots reject both retired delivery phases', () => {
  const run = createTestDeliveryRun({ projectId: 'retired-phases', ownerId: 'owner' })
  for (const phase of ['ATOMIC_TASK_PLANNING', 'IMPLEMENTATION_AUDIT'])
    expect(() => parseDeliveryRun({ ...run, phase })).toThrow()
})
