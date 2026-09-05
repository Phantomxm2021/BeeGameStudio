import { describe, expect, test } from 'bun:test'
import {
  claimFoundationFactTasks,
  type FoundationFactTask,
} from './foundation-fact-runtime'
import {
  claimFoundationSemanticTasks,
  type FoundationSemanticRuntimeTask,
} from './foundation-semantic-runtime'
import {
  prepareFoundationFactClaim,
  prepareFoundationSemanticClaim,
  type FoundationReviewFactClaimInput,
  type FoundationReviewSemanticClaimInput,
} from './stages/foundation-review/claim'

const revision = 'claim-isolation'
const startedAt = '2026-09-05T00:00:00.000Z'
const usage = { input_tokens: 1, cache_read_tokens: 2, cache_creation_tokens: 3, completion_tokens: 4, total_tokens: 7 }

function factTask(index: number, status: FoundationFactTask['status'] = 'pending'): FoundationFactTask {
  return {
    taskId: `fact-${index}`,
    kind: 'document-facts',
    revision,
    packetDigest: `${String(index + 1).repeat(64)}`.slice(0, 64),
    factKeyCount: 1,
    modelTier: 'fast',
    status,
    attempt: status === 'retryable' ? 1 : 0,
    ...(status === 'retryable' ? { dispatch: { dispatchId: `old-${index}`, workerType: 'foundation-fact-extractor' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: `fact-${index}`, revision, status: 'failed' as const, startedAt } } : {}),
    attemptHistory: [{ dispatchId: `history-${index}`, workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: `fact-${index}`, revision, status: 'failed', startedAt, request: { runId: 'run', nested: { retained: true } } as never }],
    terminalDigest: 'a'.repeat(64),
    receiptPath: 'receipt.json',
    receiptDigest: 'b'.repeat(64),
    usage,
    durationMs: 4,
    failureReason: 'prior failure',
  }
}

function semanticTask(index: number, status: FoundationSemanticRuntimeTask['status'] = 'pending'): FoundationSemanticRuntimeTask & { admittedResult?: { checkId: string; packetIdentity: string; outcome: 'PASS' } } {
  return {
    taskId: `semantic-${index}`,
    kind: 'semantic',
    revision,
    checkId: `check-${index}`,
    packetDigest: 'c'.repeat(64),
    modelTier: index === 0 ? 'fast' : 'balanced',
    status,
    attempt: status === 'retryable' ? 1 : 0,
    attemptHistory: [{ dispatchId: `history-semantic-${index}`, workerType: 'foundation-semantic-reviewer', phase: 'DOCUMENT_REVIEW', taskId: `semantic-${index}`, revision, status: 'failed', startedAt, terminalResult: { nested: { retained: true } } }],
    admittedResult: { checkId: `check-${index}`, packetIdentity: 'c'.repeat(64), outcome: 'PASS' },
  }
}

function factInput(tasks: FoundationFactTask[], request: FoundationReviewFactClaimInput['request'] = { taskId: 'fact-0', schemaPresent: true }): FoundationReviewFactClaimInput {
  return {
    snapshot: { revision, status: 'extracting_facts', phaseStartedAt: startedAt, tasks, aggregateUsage: usage },
    request,
    record: { dispatchId: 'new-dispatch', startedAt },
  }
}

function semanticInput(tasks: FoundationSemanticRuntimeTask[], request: FoundationReviewSemanticClaimInput['request'] = { taskId: 'semantic-0', modelTier: 'fast' }): FoundationReviewSemanticClaimInput {
  return {
    snapshot: { revision, status: 'semantic_review', phaseStartedAt: startedAt, tasks: tasks as never, aggregateUsage: usage, deepPhaseStartedAt: startedAt, deepAggregateUsage: usage },
    request,
    record: { dispatchId: 'new-dispatch', startedAt },
  }
}

describe('Reviewer claim isolation', () => {
  test('matches fact runtime claim output, capacity and schema readiness', () => {
    const tasks = [factTask(0), factTask(1), factTask(2), factTask(3), factTask(4)]
    const actual = prepareFoundationFactClaim(factInput(tasks))
    const expected = claimFoundationFactTasks({ revision, phaseStartedAt: startedAt, status: 'extracting_facts', tasks: structuredClone(tasks), aggregateUsage: { ...usage } }, { onlyTaskId: 'fact-0', dispatchIdFor: () => 'new-dispatch', now: startedAt, modelReady: true })
    expect(actual).toEqual({ kind: 'claimed', state: expected })
    expect(actual.state.tasks.filter(task => task.status === 'running')).toHaveLength(1)

    const blocked = prepareFoundationFactClaim(factInput(tasks, { taskId: 'fact-0', schemaPresent: false }))
    expect(blocked.kind).toBe('blocked')
    if (blocked.kind === 'blocked') expect(blocked.reason).toBe('foundation fact fast model is not configured')
    expect(blocked.state.tasks.every(task => task.status === 'needs_action')).toBe(true)
  })

  test('preserves fact evidence and does not leak nested references', () => {
    const tasks = [factTask(0, 'retryable'), factTask(1)]
    const frozen = structuredClone(tasks)
    const actual = prepareFoundationFactClaim(factInput(tasks, { taskId: 'fact-0', schemaPresent: true }))
    expect(actual.kind).toBe('claimed')
    if (actual.kind === 'claimed') {
      const nestedRequest = actual.state.tasks[0]!.attemptHistory![0]!.request as unknown as { nested: unknown }
      nestedRequest.nested = { changed: true }
      actual.state.tasks[0]!.usage!.total_tokens = 99
    }
    expect(tasks).toEqual(frozen)
  })

  test('matches semantic tier readiness, retry capacity and fast-error broad blocking', () => {
    const tasks = [semanticTask(0), semanticTask(1), semanticTask(2), semanticTask(3), semanticTask(4)]
    const actual = prepareFoundationSemanticClaim(semanticInput(tasks))
    const expected = claimFoundationSemanticTasks({ revision, phaseStartedAt: startedAt, status: 'semantic_review', tasks: structuredClone(tasks) as FoundationSemanticRuntimeTask[], aggregateUsage: { ...usage }, deepPhaseStartedAt: startedAt, deepAggregateUsage: { ...usage } }, { onlyTaskId: 'semantic-0', dispatchIdFor: () => 'new-dispatch', now: startedAt, configuredTiers: { fast: true } })
    expect(actual).toEqual({ kind: 'claimed', state: expected })
    expect(actual.state.tasks.find(task => task.taskId === 'semantic-0')?.status).toBe('running')
    expect(actual.state.tasks.find(task => task.taskId === 'semantic-1')?.status).toBe('pending')

    const unavailable = prepareFoundationSemanticClaim(semanticInput(tasks, { taskId: 'semantic-0', modelTier: 'fast', fastModelError: 'provider unavailable' }))
    expect(unavailable.kind).toBe('blocked')
    expect(unavailable.state.tasks.find(task => task.taskId === 'semantic-0')?.failureReason).toBe('fast semantic model is not configured')
  })

  test('coerces an absent requested model tier exactly as the dispatch path', () => {
    const actual = prepareFoundationSemanticClaim(semanticInput([semanticTask(0)], { taskId: 'semantic-0', modelTier: undefined }))
    expect(actual.kind).toBe('blocked')
    if (actual.kind === 'blocked') expect(actual.reason).toBe('fast semantic model is not configured')
  })
})
