import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DispatchRecord } from './types'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../../__tests__/complete-game-document-fixture'
import {
  deriveFoundationAuditArtifacts,
  publishDeterministicFoundationReview,
  publishFoundationDerivedArtifacts,
} from './foundation-audit-artifacts'
import { createFoundationFactStore, digestFactStore } from './foundation-fact-store'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './foundation-semantic-audit'
import { buildSemanticPacketFor } from './stages/foundation-review/packets'
import {
  admitFoundationSemanticReviewTerminal,
  isFoundationSemanticReviewComplete,
  type FoundationSemanticTerminalReviewSnapshot,
  type FoundationSemanticTerminalTask,
} from './stages/foundation-review/semantic-terminal'
import type { WorkflowUsage } from './types'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const usage: WorkflowUsage = {
  input_tokens: 10,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 5,
  total_tokens: 15,
}
const zeroUsage: WorkflowUsage = {
  input_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 0,
  total_tokens: 0,
}
const revision = 'semantic-terminal-isolation'
const phaseStartedAt = '2026-09-05T00:00:00.000Z'

async function fixture() {
  const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-semantic-terminal-isolation-'))
  roots.push(workspacePath)
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    await mkdir(dirname(join(workspacePath, path)), { recursive: true })
    await writeFile(join(workspacePath, path), renderTestCompleteGameDocument(path, completeTestSubmission(path)))
  }
  const artifacts = await deriveFoundationAuditArtifacts({
    workspacePath,
    revision,
    checkpoints: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })),
  })
  const factStore = createFoundationFactStore([])
  await publishFoundationDerivedArtifacts({
    workspacePath,
    revision,
    documentDigests: artifacts.documentDigests,
    sectionIndex: artifacts.sectionIndex,
    factStore,
    normalizedFactDigest: digestFactStore(factStore),
    manifest: artifacts.manifest as unknown as Record<string, unknown>,
  })
  const prefix = await publishDeterministicFoundationReview({
    workspacePath,
    revision,
    documentDigests: artifacts.documentDigests,
    sectionIndex: artifacts.sectionIndex,
    factStore,
    issues: [],
  })
  const check = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[0]!
  const packet = await buildSemanticPacketFor({
    workspacePath,
    revision,
    checkId: check.checkId,
    sectionIndex: artifacts.sectionIndex,
    factStore,
    deterministicReviewDigest: prefix.reviewDigest,
    deterministicIssuePrefix: [],
    documentDigests: artifacts.documentDigests,
  })
  const taskId = `${revision}:semantic:0`
  const task: FoundationSemanticTerminalTask = {
    taskId,
    kind: 'semantic',
    revision,
    checkId: check.checkId,
    packetDigest: packet.identity,
    modelTier: check.modelTier,
    status: 'running',
    attempt: 1,
    dispatch: dispatch(taskId, 'dispatch-0', 'running'),
  }
  return { workspacePath, prefix, packet, task, taskId }
}

function dispatch(taskId: string, dispatchId: string, status: DispatchRecord['status']): DispatchRecord {
  return {
    dispatchId,
    workerType: 'foundation-semantic-reviewer',
    phase: 'DOCUMENT_REVIEW',
    taskId,
    revision,
    status,
    usage: { ...usage },
    startedAt: phaseStartedAt,
    finishedAt: '2026-09-05T00:00:01.000Z',
  }
}

function snapshotFromResult(
  value: Awaited<ReturnType<typeof fixture>>,
  result: Awaited<ReturnType<typeof admitFoundationSemanticReviewTerminal>>,
): FoundationSemanticTerminalReviewSnapshot {
  return {
    revision,
    deterministicReviewDigest: value.prefix.reviewDigest,
    phaseStartedAt,
    tasks: result.tasks,
    aggregateUsage: result.aggregateUsage,
    ...(result.deepPhaseStartedAt ? { deepPhaseStartedAt: result.deepPhaseStartedAt } : {}),
    ...(result.deepAggregateUsage ? { deepAggregateUsage: result.deepAggregateUsage } : {}),
  }
}

function snapshot(fixtureValue: Awaited<ReturnType<typeof fixture>>): FoundationSemanticTerminalReviewSnapshot {
  return {
    revision,
    deterministicReviewDigest: fixtureValue.prefix.reviewDigest,
    phaseStartedAt,
    tasks: [fixtureValue.task],
    aggregateUsage: zeroUsage,
  }
}

function terminal(fixtureValue: Awaited<ReturnType<typeof fixture>>, outcome: 'PASS' | 'UNDECIDABLE' = 'PASS') {
  return {
    workerType: 'foundation-semantic-reviewer' as const,
    status: 'completed' as const,
    runId: 'run',
    dispatchId: fixtureValue.task.dispatch!.dispatchId,
    taskId: fixtureValue.taskId,
    revision,
    packetDigest: fixtureValue.packet.identity,
    outcome,
    ...(outcome === 'UNDECIDABLE' ? { reason: 'evidence requires a human decision' } : {}),
  }
}

describe('Reviewer semantic terminal isolation', () => {
  test('matches the bounded admission contract on a real committed fixture', async () => {
    const value = await fixture()
    const original = snapshot(value)
    const before = structuredClone(original)
    const result = await admitFoundationSemanticReviewTerminal({
      workspacePath: value.workspacePath,
      snapshot: original,
      taskId: value.taskId,
      dispatch: { ...value.task.dispatch!, status: 'completed', terminalResult: terminal(value) },
      terminal: terminal(value),
    })
    expect(result.status).toBe('running')
    expect(result.blockedReason).toBeUndefined()
    expect(result.thinking).toBe('working')
    expect(result.accepted).toBe(true)
    expect(result.idempotent).toBe(false)
    expect(result.aggregateUsage).toEqual(usage)
    expect(result.tasks[0]).toMatchObject({ taskId: value.taskId, status: 'completed', admittedResult: { outcome: 'PASS', checkId: value.task.checkId, packetIdentity: value.packet.identity } })
    expect(original).toEqual(before)
    expect(isFoundationSemanticReviewComplete(snapshotFromResult(value, result))).toBe(false)
  })

  test('is idempotent for an exact replay and rejects a conflicting replay', async () => {
    const value = await fixture()
    const firstDispatch = { ...value.task.dispatch!, status: 'completed' as const, terminalResult: terminal(value) }
    const first = await admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: snapshot(value), taskId: value.taskId, dispatch: firstDispatch, terminal: terminal(value) })
    const replaySnapshot = snapshotFromResult(value, first)
    const replay = await admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: replaySnapshot, taskId: value.taskId, dispatch: firstDispatch, terminal: terminal(value) })
    expect(replay.idempotent).toBe(true)
    expect(replay.terminalDigest).toBe(first.terminalDigest)
    await expect(admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: replaySnapshot, taskId: value.taskId, dispatch: firstDispatch, terminal: terminal(value, 'UNDECIDABLE') })).rejects.toThrow('conflicting semantic terminal replay')
  })

  test('escalates an undecidable source and admits the confirmation task', async () => {
    const value = await fixture()
    const sourceTerminal = terminal(value, 'UNDECIDABLE')
    const first = await admitFoundationSemanticReviewTerminal({
      workspacePath: value.workspacePath,
      snapshot: snapshot(value),
      taskId: value.taskId,
      dispatch: { ...value.task.dispatch!, status: 'completed', terminalResult: sourceTerminal },
      terminal: sourceTerminal,
    })
    expect(first.tasks).toHaveLength(2)
    const confirmation = first.tasks.find(task => task.kind === 'confirmation')!
    const confirmationRunningTask = { ...confirmation, dispatch: dispatch(confirmation.taskId, 'dispatch-confirmation', 'running'), status: 'running' as const, attempt: 1 as const }
    const confirmationDispatch = dispatch(confirmation.taskId, 'dispatch-confirmation', 'completed')
    const confirmationTerminal = { workerType: sourceTerminal.workerType, status: sourceTerminal.status, runId: sourceTerminal.runId, dispatchId: confirmationDispatch.dispatchId, taskId: confirmation.taskId, revision: sourceTerminal.revision, packetDigest: sourceTerminal.packetDigest, outcome: 'PASS' as const }
    const second = await admitFoundationSemanticReviewTerminal({
      workspacePath: value.workspacePath,
      snapshot: { ...snapshotFromResult(value, first), tasks: first.tasks.map(task => task.taskId === confirmation.taskId ? confirmationRunningTask : task) },
      taskId: confirmation.taskId,
      dispatch: { ...confirmationDispatch, terminalResult: confirmationTerminal },
      terminal: confirmationTerminal,
    })
    expect(second.status).toBe('running')
    expect(second.tasks.find(task => task.taskId === confirmation.taskId)).toMatchObject({ status: 'completed', admittedResult: { outcome: 'PASS' } })
    expect(second.deepAggregateUsage).toEqual(usage)
  })

  test('preserves measured usage errors, source projections, and caller-input isolation', async () => {
    const value = await fixture()
    const originalSnapshot = snapshot(value)
    const terminalValue = terminal(value)
    const record = { ...value.task.dispatch!, status: 'completed' as const, terminalResult: terminalValue }
    const pending = admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: originalSnapshot, taskId: value.taskId, dispatch: record, terminal: terminalValue })
    originalSnapshot.tasks[0]!.checkId = 'mutated'
    terminalValue.outcome = 'UNDECIDABLE'
    record.usage!.total_tokens = 999
    const result = await pending
    expect(result.tasks[0]!.admittedResult).toMatchObject({ outcome: 'PASS' })
    expect(result.aggregateUsage).toEqual(usage)
    value.task.checkId = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[0]!.checkId
    const extraSnapshot = snapshot(value)
    Object.assign(extraSnapshot.tasks[0], { privateAuthority: true, admittedResult: { checkId: value.task.checkId, packetIdentity: value.packet.identity, outcome: 'PASS', issues: [] } })
    const projected = await admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: extraSnapshot, taskId: value.taskId, dispatch: { ...record, usage }, terminal: terminal(value) })
    expect(projected.tasks[0]).not.toHaveProperty('privateAuthority')
    expect(projected.tasks[0]).toHaveProperty('admittedResult')
    await expect(admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: snapshot(value), taskId: value.taskId, dispatch: { ...record, usage: { ...usage, total_tokens: 1 } }, terminal: terminal(value) })).rejects.toThrow('semantic usage total_tokens is inconsistent')
    await expect(admitFoundationSemanticReviewTerminal({ workspacePath: value.workspacePath, snapshot: snapshot(value), taskId: value.taskId, dispatch: { ...record, usage: undefined }, terminal: terminal(value) })).rejects.toThrow('semantic terminal is missing measured usage or duration')
  })
})
