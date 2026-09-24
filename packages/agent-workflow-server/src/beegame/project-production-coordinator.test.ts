import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createProjectProductionCoordinator, isIncompleteProjectProductionRun, isInterruptedProjectProductionRun, isPendingProjectProductionReview, projectProductionCheckpoint } from './project-production-coordinator'
import { createRunStore } from './delivery-workflow/run-store'
import { transitionDeliveryRun } from './delivery-workflow/transition'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './delivery-workflow/types'
import { FOUNDATION_AUTHOR_REVIEW_HANDOFF_REASON } from './delivery-workflow/foundation-authoring-link'
import { createTestDeliveryRun } from '../__tests__/delivery-workflow-test-helpers'

test('one persisted cursor projects all required stages without inventing accepted work', () => {
  const base = createTestDeliveryRun({ ownerId: 'owner', projectId: 'project' })
  expect(projectProductionCheckpoint({ ...base, phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING', status: 'stopped' })).toMatchObject({
    currentPhase: 'DOCUMENT_DRAFTING', nextRequiredStage: 'DOCUMENT_DRAFTING',
    currentStep: 'FOUNDATION_DRAFTING',
    recordedPriorStages: [],
    requiredStages: ['DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW', 'RESOURCE_PREPARATION',
      'GAME_CONTENT', 'IMPLEMENTATION', 'ACCEPTANCE'],
  })
  expect(projectProductionCheckpoint({ ...base, phase: 'RESOURCE_PREPARATION',
    documentStep: undefined, status: 'needs_action', blockedReason: 'Asset manifest missing' }))
    .toMatchObject({ currentPhase: 'RESOURCE_PREPARATION', nextRequiredStage: 'RESOURCE_PREPARATION',
      recordedPriorStages: ['DOCUMENT_DRAFTING', 'DOCUMENT_REVIEW'],
      blockedReason: 'Asset manifest missing' })
  expect(projectProductionCheckpoint({ ...base, phase: 'DELIVERY', status: 'completed' })
    .recordedPriorStages).toHaveLength(6)
})

test('starts the existing stage sequence at document authoring and is idempotent', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-coordinator-'))
  const starts: string[] = []
  const progresses: string[] = []
  const controller = {
    async start(run: { phase: string }) { starts.push(run.phase) },
    async resume(run: { phase: string }) { progresses.push(`resume:${run.phase}`) },
    async ensureProgress(run: { phase: string }) { progresses.push(`progress:${run.phase}`) },
    async stopFoundation(run: import('./delivery-workflow/types').DeliveryRun) { return run },
    async dispose() {},
  }
  const input = { workspacePath, ownerId: 'owner', projectId: 'project',
    confirmedBriefContext: '{"kind":"confirmed_build_brief"}', controller }
  try {
    const coordinator = createProjectProductionCoordinator(input)
    const first = await coordinator.start()
    const second = await coordinator.start()
    expect(starts).toEqual(['DOCUMENT_DRAFTING'])
    expect(first.phase).toBe('DOCUMENT_DRAFTING')
    expect(second.runId).toBe(first.runId)
    expect(progresses).toEqual(['progress:DOCUMENT_DRAFTING'])
    expect(await Bun.file(join(workspacePath, '.beegame/delivery/production/run.json')).exists()).toBe(true)
    expect(await Bun.file(join(workspacePath, '.beegame/workflow/run.json')).exists()).toBe(false)
    const resumed: string[] = []
    const afterRestart = createProjectProductionCoordinator({
      ...input,
      controller: {
        async start() {},
        async resume(run: { phase: string }) { resumed.push(run.phase) },
        async ensureProgress() {},
        async stopFoundation(run: import('./delivery-workflow/types').DeliveryRun) { return run },
        async dispose() {},
      },
    })
    const recovered = await afterRestart.resume()
    expect(recovered?.runId).toBe(first.runId)
    expect(resumed).toEqual(['DOCUMENT_DRAFTING'])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('refuses to resume a production run belonging to another project', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-coordinator-owner-'))
  const controller = { async start() {}, async resume() {}, async ensureProgress() {},
    async stopFoundation(run: import('./delivery-workflow/types').DeliveryRun) { return run },
    async dispose() {} }
  try {
    const coordinator = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
      projectId: 'project', confirmedBriefContext: '{"kind":"brief"}', controller })
    await coordinator.start()
    const otherProject = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
      projectId: 'other-project', confirmedBriefContext: '{"kind":"brief"}', controller })
    await expect(otherProject.resume()).resolves.toBeUndefined()
    await expect(otherProject.start()).rejects.toThrow('different production brief')
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('Stop persists the same run checkpoint and Continue resumes it', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-stop-resume-'))
  const store = createRunStore(workspacePath, 'owner', { stateDirectory: '.beegame/delivery/production' })
  const resumed: string[] = []
  const controller = {
    async start() {},
    async ensureProgress() {},
    async stopFoundation(run: import('./delivery-workflow/types').DeliveryRun, reason: string) {
      const stopped = transitionDeliveryRun(run, { type: 'stop', reason })
      return store.commit(stopped, { runId: stopped.runId, type: 'run.stopped',
        phase: stopped.phase, status: stopped.status, revision: stopped.revision, reason })
    },
    async resume(run: import('./delivery-workflow/types').DeliveryRun) {
      const current = await store.load()
      if (!current || current.status !== 'stopped') return
      const continued = { ...current, status: 'running' as const }
      await store.commit(continued, { runId: continued.runId, type: 'run.resumed',
        phase: continued.phase, status: continued.status, revision: continued.revision })
      resumed.push(run.runId)
    },
    async dispose() {},
  }
  try {
    const coordinator = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
      projectId: 'project', confirmedBriefContext: '{"kind":"brief"}', controller })
    const initial = await coordinator.start()
    const stopped = await coordinator.stop('user_stop')
    expect(stopped?.runId).toBe(initial.runId)
    expect((await store.load())?.status).toBe('stopped')
    const continued = await coordinator.resume()
    expect(continued?.runId).toBe(initial.runId)
    expect((await store.load())?.status).toBe('running')
    expect(resumed).toEqual([initial.runId])
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('Continue recognizes a public-stage Stop awaiting acknowledgment, but not unrelated needs_action', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-pending-stop-'))
  const store = createRunStore(workspacePath, 'owner', { stateDirectory: '.beegame/delivery/production' })
  const resumed: string[] = []
  const coordinator = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
    projectId: 'project', confirmedBriefContext: '{"kind":"brief"}',
    controller: { async start() {}, async ensureProgress() {}, async dispose() {},
      async stopFoundation(run: import('./delivery-workflow/types').DeliveryRun) { return run },
      async resume(run: import('./delivery-workflow/types').DeliveryRun) { resumed.push(run.runId) } },
  })
  try {
    const initial = await coordinator.start()
    const authorStage = { protocolVersion: 1 as const, requestId: 'author-request', inputDigest: 'a'.repeat(64),
      status: 'running' as const,
      handle: { protocolVersion: 1 as const, producer: 'foundation-authoring' as const,
        id: '550e8400-e29b-41d4-a716-446655440000' },
      control: { sequence: 1, action: 'stop' as const, requestId: 'author-request', reason: 'user_stop' } }
    const pending = { ...initial, status: 'needs_action' as const, authorStage }
    await store.commit(pending, { runId: pending.runId, type: 'foundation.authoring.stop_requested',
      phase: pending.phase, status: pending.status, revision: pending.revision })
    expect(isInterruptedProjectProductionRun(pending)).toBe(true)
    await coordinator.resume()
    expect(resumed).toEqual([initial.runId])
    expect(isInterruptedProjectProductionRun({ ...pending, authorStage: {
      ...authorStage, control: { ...authorStage.control, action: 'run' },
    } })).toBe(false)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('Continue routes an actionable production checkpoint back to its controller', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-actionable-'))
  const store = createRunStore(workspacePath, 'owner', { stateDirectory: '.beegame/delivery/production' })
  const resumed: string[] = []
  const coordinator = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
    projectId: 'project', confirmedBriefContext: '{"kind":"brief"}',
    controller: { async start() {}, async ensureProgress() {}, async dispose() {},
      async stopFoundation(run) { return run },
      async resume(run) { resumed.push(`${run.phase}:${run.status}`) } },
  })
  try {
    const initial = await coordinator.start()
    const actionable = { ...initial, status: 'needs_action' as const,
      blockedReason: 'Reviewer output could not be admitted' }
    await store.commit(actionable, { runId: actionable.runId, type: 'run.needs_action',
      phase: actionable.phase, status: actionable.status, revision: actionable.revision })
    expect(isIncompleteProjectProductionRun(actionable)).toBe(true)
    await coordinator.resume()
    expect(resumed).toEqual(['DOCUMENT_DRAFTING:needs_action'])
    expect(isIncompleteProjectProductionRun({ ...actionable, phase: 'DELIVERY', status: 'completed' })).toBe(false)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})

test('completed documents awaiting a workspace-idle review handoff resume without rerunning Author', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'bgs-production-review-handoff-'))
  const store = createRunStore(workspacePath, 'owner', { stateDirectory: '.beegame/delivery/production' })
  const calls: string[] = []
  const coordinator = createProjectProductionCoordinator({ workspacePath, ownerId: 'owner',
    projectId: 'project', confirmedBriefContext: '{"kind":"brief"}',
    controller: { async start() {}, async ensureProgress(run) { calls.push(`progress:${run.phase}`) },
      async resume(run) { calls.push(`resume:${run.phase}`) },
      async stopFoundation(run) { calls.push(`stop:${run.phase}`); return run }, async dispose() {} },
  })
  try {
    const initial = await coordinator.start()
    const handoff = { ...initial, phase: 'DOCUMENT_REVIEW' as const, status: 'needs_action' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      blockedReason: FOUNDATION_AUTHOR_REVIEW_HANDOFF_REASON,
      authorStage: { protocolVersion: 1 as const, requestId: 'author-request', inputDigest: 'a'.repeat(64),
        status: 'completed' as const, control: { sequence: 0, action: 'run' as const, requestId: 'author-request' },
        handle: { protocolVersion: 1 as const, producer: 'foundation-authoring' as const,
          id: '550e8400-e29b-41d4-a716-446655440000' },
        result: { protocolVersion: 1 as const, producer: 'foundation-authoring' as const,
          kind: 'foundation_documents' as const, resultId: 'b'.repeat(64), inputDigest: 'a'.repeat(64),
          ownerId: 'owner', projectId: 'project', confirmedBriefDigest: initial.confirmedBriefDigest,
          documentRevision: 'documents', workspaceRevision: 'workspace', receiptSetDigest: 'c'.repeat(64),
          documents: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: 'd'.repeat(64),
            byteLength: 12, artifactPath: `.beegame/workflow/foundation-authoring/artifacts/result/${path}` })) },
      } as import('./delivery-workflow/types').AuthorStageLink }
    await store.commit(handoff, { runId: handoff.runId, type: 'foundation.authoring.public_result',
      phase: handoff.phase, status: handoff.status, revision: handoff.revision })
    expect(isPendingProjectProductionReview(handoff)).toBe(true)
    await coordinator.start()
    await coordinator.resume()
    await coordinator.stop()
    expect(calls).toEqual(['progress:DOCUMENT_REVIEW', 'resume:DOCUMENT_REVIEW', 'stop:DOCUMENT_REVIEW'])
    expect(isPendingProjectProductionReview({ ...handoff, blockedReason: 'Review failed' })).toBe(false)
  } finally { await rm(workspacePath, { recursive: true, force: true }) }
})
