import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS,
  FOUNDATION_SEMANTIC_MAX_RUNNING,
  FOUNDATION_SEMANTIC_MAX_TASKS,
  FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS,
  FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS,
  FOUNDATION_DEEP_OUTPUT_MAX_TOKENS,
  FOUNDATION_DEEP_MAX_MODEL_TOKENS,
  FOUNDATION_DEEP_PHASE_DEADLINE_MS,
  digestFoundationSemanticTerminal,
  createFoundationSemanticTaskCollection,
  createFoundationConfirmationTask,
  appendFoundationConfirmationTask,
  claimFoundationSemanticTasks,
  admitFoundationSemanticTerminal,
  foundationSemanticTasksComplete,
  type FoundationSemanticTask,
  type FoundationSemanticTaskCollection,
} from './foundation-semantic-runtime'
import { FOUNDATION_SEMANTIC_CHECKS, type FoundationSemanticResult } from './foundation-semantic-audit'

const digest = 'a'.repeat(64)
const task = (index: number): FoundationSemanticTask => ({
  taskId: `rev:semantic:${index}`,
  kind: 'semantic',
  revision: 'rev',
  checkId: FOUNDATION_SEMANTIC_CHECKS[index]!.checkId,
  packetDigest: digest,
  modelTier: FOUNDATION_SEMANTIC_CHECKS[index]!.modelTier,
  status: 'pending',
  attempt: 0,
})
const usage = (total_tokens: number) => ({ input_tokens: total_tokens, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 0, total_tokens })
const ten = () => Array.from({ length: 10 }, (_, i) => task(i))
const admittedResult = (source: FoundationSemanticTask, outcome: FoundationSemanticResult['outcome'] = 'UNDECIDABLE'): FoundationSemanticResult => ({ checkId: source.checkId, packetIdentity: source.packetDigest, outcome, ...(outcome === 'UNDECIDABLE' ? { reason: 'insufficient evidence' } : {}) })
const terminalEvidence = (source: Pick<FoundationSemanticTask, 'taskId' | 'checkId' | 'packetDigest'>, outcome: FoundationSemanticResult['outcome']) => ({ checkId: source.checkId, packetIdentity: source.packetDigest, outcome })
const terminalDigest = (source: Pick<FoundationSemanticTask, 'taskId' | 'checkId' | 'packetDigest'>, outcome: FoundationSemanticResult['outcome']) => digestFoundationSemanticTerminal(terminalEvidence(source, outcome))

describe('foundation semantic runtime', () => {
  test('seeds exactly ten semantic tasks and enforces the four-way waves', () => {
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: Array.from({ length: 10 }, (_, i) => task(i)) })
    expect(collection.tasks).toHaveLength(10)
    const claimed = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: item => `dispatch:${item.taskId}`, configuredTiers: { fast: true, balanced: true } })
    expect(claimed.tasks.filter(item => item.status === 'running')).toHaveLength(4)
    const next = claimFoundationSemanticTasks(claimed, { now: new Date(2).toISOString(), dispatchIdFor: item => `dispatch:${item.taskId}`, configuredTiers: { fast: true, balanced: true } })
    expect(next.tasks.filter(item => item.status === 'running')).toHaveLength(4)
  })

  test('rejects a duplicate semantic check in the ten-task seed', () => {
    const duplicate = ten().map((item, index) => index === 1 ? { ...item, checkId: task(0).checkId } : item)
    expect(() => createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: duplicate })).toThrow(/check IDs.*unique/i)
  })

  test('routes persisted fast and balanced tiers and fails closed when a tier is missing', () => {
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const blocked = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'd', configuredTiers: { fast: true, balanced: false } })
    expect(blocked.tasks.filter(item => item.status === 'needs_action')).toHaveLength(8)
    expect(blocked.tasks.filter(item => item.status === 'running')).toHaveLength(2)
    expect(blocked.tasks[1]?.failureReason).toMatch(/balanced.*configured/i)
  })

  test('uses fresh dispatches for retry and admits caps, deadline, and replay idempotently', () => {
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const claimed = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'd1', configuredTiers: { fast: true, balanced: true } })
    const failed = admitFoundationSemanticTerminal(claimed, { taskId: task(0).taskId, dispatchId: 'd1', revision: 'rev', packetDigest: digest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'failed', runId: 'run', dispatchId: 'd1', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' }, usage: usage(1), durationMs: 3, now: new Date(2).toISOString() })
    expect(failed.state.tasks[0]?.status).toBe('retryable')
    const retry = claimFoundationSemanticTasks(failed.state, { now: new Date(3).toISOString(), dispatchIdFor: () => 'd2', configuredTiers: { fast: true, balanced: true } })
    expect(retry.tasks[0]?.dispatch?.dispatchId).toBe('d2')
    const capped = admitFoundationSemanticTerminal(retry, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'd2', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' }, usage: { ...usage(FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS + 1), completion_tokens: FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS + 1, total_tokens: FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS * 2 + 2 }, durationMs: 3, now: new Date(4).toISOString() })
    expect(capped.state.tasks[0]?.status).toBe('needs_action')
    expect(() => admitFoundationSemanticTerminal(capped.state, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'd2', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' }, usage: usage(1), durationMs: 1, now: new Date(5).toISOString() })).toThrow(/running|replay/i)

    const nested = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'd2', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' as const, metadata: { nested: { marker: 1 } } }
    const replayState = retry.tasks.map(item => item.taskId === task(0).taskId ? { ...item, status: 'running' as const, dispatch: { ...item.dispatch!, dispatchId: 'd2' } } : item)
    const completed = admitFoundationSemanticTerminal({ ...retry, tasks: replayState }, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: nested, usage: usage(1), durationMs: 1, now: new Date(4).toISOString() })
    expect(digestFoundationSemanticTerminal(nested)).toHaveLength(64)
    expect(() => admitFoundationSemanticTerminal(completed.state, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: { ...nested, metadata: { nested: { marker: 2 } } }, usage: usage(1), durationMs: 1, now: new Date(5).toISOString() })).toThrow(/conflicting/i)
  })

  test('enforces aggregate/deadline constants and completed accounting', () => {
    expect(FOUNDATION_SEMANTIC_MAX_TASKS).toBe(10)
    expect(FOUNDATION_SEMANTIC_MAX_RUNNING).toBe(4)
    expect(FOUNDATION_SEMANTIC_OUTPUT_MAX_TOKENS).toBe(768)
    expect(FOUNDATION_SEMANTIC_MAX_MODEL_TOKENS).toBe(80_000)
    expect(FOUNDATION_SEMANTIC_PHASE_DEADLINE_MS).toBe(300_000)
    expect(foundationSemanticTasksComplete({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), status: 'semantic_review', tasks: [], aggregateUsage: usage(0) })).toBe(false)
  })

  test('completes four, releases the next four, then the final two', () => {
    let state = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    for (let wave = 0; wave < 3; wave++) {
      state = claimFoundationSemanticTasks(state, { now: new Date(wave + 1).toISOString(), dispatchIdFor: item => `wave:${wave}:${item.taskId}`, configuredTiers: { fast: true, balanced: true } })
      const running = state.tasks.filter(item => item.status === 'running')
      expect(running.length).toBe(wave === 2 ? 2 : 4)
      for (const item of running) {
        const terminal = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: item.dispatch!.dispatchId, taskId: item.taskId, revision: item.revision, packetDigest: item.packetDigest, outcome: 'PASS' as const }
        state = admitFoundationSemanticTerminal(state, { taskId: item.taskId, dispatchId: item.dispatch!.dispatchId, revision: item.revision, packetDigest: item.packetDigest, terminal, usage: usage(1), durationMs: 1, now: new Date(wave + 2).toISOString() }).state
      }
    }
    expect(foundationSemanticTasksComplete(state)).toBe(true)
  })

  test('admits confirmations only from an admitted undecidable or blocker and caps four unique sources', () => {
    const source = { ...task(0), status: 'completed' as const }
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const admittedSource = {
      ...source,
      terminalDigest: terminalDigest(source, 'UNDECIDABLE'),
      usage: usage(1),
      durationMs: 1,
      dispatch: { dispatchId: 'source-dispatch', workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: source.taskId, revision: source.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(source, 'UNDECIDABLE') },
    }
    let state: FoundationSemanticTaskCollection = { ...seeded, tasks: seeded.tasks.map(item => item.taskId === source.taskId ? admittedSource : { ...item, status: 'completed' as const, terminalDigest: terminalDigest(item, 'UNDECIDABLE'), usage: usage(1), durationMs: 1, dispatch: { dispatchId: `source-${item.taskId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: item.taskId, revision: item.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(item, 'UNDECIDABLE') } }) }
    state = appendFoundationConfirmationTask(state, { taskId: 'c1', sourceTaskId: source.taskId, admittedResult: admittedResult(source), now: '1970-01-01T00:01:00.000Z' })
    expect(state.deepPhaseStartedAt).toBeDefined()
    expect(state.deepPhaseStartedAt).toBe('1970-01-01T00:01:00.000Z')
    expect(state.tasks.at(-1)).toMatchObject({ kind: 'confirmation', sourceTaskId: source.taskId, packetDigest: source.packetDigest, modelTier: 'strong', attempt: 0 })
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'c2', sourceTaskId: source.taskId, admittedResult: admittedResult(source), now: '1970-01-01T00:01:01.000Z' })).toThrow(/already/i)
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'c2', sourceTaskId: task(1).taskId, admittedResult: admittedResult(task(1), 'PASS'), now: '1970-01-01T00:01:01.000Z' })).toThrow(/outcome|UNDECIDABLE|BLOCKER/i)
    for (let i = 1; i < 4; i++) state = appendFoundationConfirmationTask(state, { taskId: `c${i + 1}`, sourceTaskId: task(i).taskId, admittedResult: admittedResult(task(i)), now: '1970-01-01T00:01:01.000Z' })
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'c5', sourceTaskId: task(4).taskId, admittedResult: admittedResult(task(4)), now: '1970-01-01T00:01:01.000Z' })).toThrow(/limit/i)
  })

  test('rejects confirmation sources without durable admitted completion evidence', () => {
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: '1970-01-01T00:00:00.000Z', tasks: ten() })
    const incomplete: FoundationSemanticTaskCollection = { ...seeded, tasks: seeded.tasks.map(item => ({ ...item, status: 'completed' as const })) }
    expect(() => appendFoundationConfirmationTask(incomplete, { taskId: 'c1', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })).toThrow(/completed.*evidence|terminal|usage|dispatch/i)
  })

  test('confirmation admission is bound to the admitted result and terminal outcome', () => {
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: '1970-01-01T00:00:00.000Z', tasks: ten() })
    const source = task(0)
    const tasks = seeded.tasks.map(item => ({ ...item, status: 'completed' as const, terminalDigest: terminalDigest(item, item.taskId === source.taskId ? 'UNDECIDABLE' : 'PASS'), usage: usage(1), durationMs: 1, dispatch: { dispatchId: `source-${item.taskId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: item.taskId, revision: item.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(item, item.taskId === source.taskId ? 'UNDECIDABLE' : 'PASS') } }))
    const state: FoundationSemanticTaskCollection = { ...seeded, tasks }
    const result = admittedResult(source)
    expect(() => appendFoundationConfirmationTask({ ...state, tasks: state.tasks.map(item => item.taskId === source.taskId ? { ...item, terminalDigest: 'c'.repeat(64) } : item) }, { taskId: 'forged-terminal-digest', sourceTaskId: source.taskId, admittedResult: result, now: '1970-01-01T00:01:00.000Z' })).toThrow(/digest/i)
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'forged-outcome', sourceTaskId: source.taskId, admittedResult: { ...result, outcome: 'PASS' }, now: '1970-01-01T00:01:00.000Z' })).toThrow(/outcome/i)
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'forged-check', sourceTaskId: source.taskId, admittedResult: { ...result, checkId: 'SEM.other' }, now: '1970-01-01T00:01:00.000Z' })).toThrow(/check/i)
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'forged-packet', sourceTaskId: source.taskId, admittedResult: { ...result, packetIdentity: 'b'.repeat(64) }, now: '1970-01-01T00:01:00.000Z' })).toThrow(/packet/i)
    expect(() => appendFoundationConfirmationTask(state, { taskId: 'forged-severity', sourceTaskId: source.taskId, admittedResult: { ...result, severity: 'BLOCKER' } as never, now: '1970-01-01T00:01:00.000Z' })).toThrow(/result|severity|identity/i)
  })

  test('rejects invalid timestamps, usage, and duration instead of failing open', () => {
    expect(() => createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: 'invalid', tasks: ten() })).toThrow(/phaseStartedAt|timestamp|date/i)
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: '1970-01-01T00:00:00.000Z', tasks: ten() })
    expect(() => claimFoundationSemanticTasks(seeded, { now: 'invalid', dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })).toThrow(/timestamp|date|now/i)
    expect(() => claimFoundationSemanticTasks({ ...seeded, aggregateUsage: { ...usage(1), total_tokens: Number.NaN } }, { now: '1970-01-01T00:00:00.001Z', dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })).toThrow(/usage|finite|token/i)
    const claimed = claimFoundationSemanticTasks(seeded, { now: '1970-01-01T00:00:00.001Z', dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })
    const terminal = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'dispatch', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' as const }
    const base = { taskId: task(0).taskId, dispatchId: 'dispatch', revision: 'rev', packetDigest: digest, terminal, now: '1970-01-01T00:00:00.002Z' }
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: { ...usage(1), input_tokens: Number.NaN } as never, durationMs: 1 })).toThrow(/usage|finite|token/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: { ...usage(1), total_tokens: Number.POSITIVE_INFINITY } as never, durationMs: 1 })).toThrow(/usage|finite|token/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: { ...usage(1), total_tokens: 0 } as never, durationMs: 1 })).toThrow(/usage|total|consistent/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: usage(1), durationMs: Number.NaN })).toThrow(/duration|finite/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: usage(1), durationMs: -1 })).toThrow(/duration|negative/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, usage: usage(1), durationMs: 1, now: 'invalid' })).toThrow(/timestamp|date|now/i)
    expect(() => appendFoundationConfirmationTask({ ...seeded, deepPhaseStartedAt: 'invalid' }, { taskId: 'deep-invalid', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })).toThrow(/deep|timestamp|date/i)
  })

  test('rejects terminal identity fields that disagree with the admission binding', () => {
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const claimed = claimFoundationSemanticTasks(seeded, { now: new Date(1).toISOString(), dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })
    const base = { taskId: task(0).taskId, dispatchId: 'dispatch', revision: 'rev', packetDigest: digest, usage: usage(1), durationMs: 1, now: new Date(2).toISOString() }
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'other', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' } })).toThrow(/dispatch/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'dispatch', taskId: 'other', revision: 'rev', packetDigest: digest, outcome: 'PASS' } })).toThrow(/task/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'dispatch', taskId: task(0).taskId, revision: 'other', packetDigest: digest, outcome: 'PASS' } })).toThrow(/revision/i)
    expect(() => admitFoundationSemanticTerminal(claimed, { ...base, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'dispatch', taskId: task(0).taskId, revision: 'rev', packetDigest: 'b'.repeat(64), outcome: 'PASS' } })).toThrow(/packet/i)
  })

  test('uses deep confirmation caps and deadline independently from semantic accounting', () => {
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date().toISOString(), tasks: ten() })
    const completedTasks = seeded.tasks.map(item => ({ ...item, status: 'completed' as const, terminalDigest: terminalDigest(item, 'UNDECIDABLE'), usage: usage(1), durationMs: 1, dispatch: { dispatchId: `source-${item.taskId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: item.taskId, revision: item.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(item, 'UNDECIDABLE') } }))
    let state: FoundationSemanticTaskCollection = { ...seeded, tasks: completedTasks }
    state = appendFoundationConfirmationTask(state, { taskId: 'deep-1', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })
    const claimed = claimFoundationSemanticTasks(state, { now: '1970-01-01T00:01:01.000Z', dispatchIdFor: item => `dispatch:${item.taskId}`, configuredTiers: { strong: true } })
    const deep = claimed.tasks.find(item => item.kind === 'confirmation')!
    const capped = admitFoundationSemanticTerminal(claimed, { taskId: deep.taskId, dispatchId: deep.dispatch!.dispatchId, revision: deep.revision, packetDigest: deep.packetDigest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: deep.dispatch!.dispatchId, taskId: deep.taskId, revision: deep.revision, packetDigest: deep.packetDigest, outcome: 'PASS' }, usage: { input_tokens: FOUNDATION_DEEP_MAX_MODEL_TOKENS - FOUNDATION_DEEP_OUTPUT_MAX_TOKENS + 1, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: FOUNDATION_DEEP_OUTPUT_MAX_TOKENS, total_tokens: FOUNDATION_DEEP_MAX_MODEL_TOKENS + 1 }, durationMs: 1, now: '1970-01-01T00:01:02.000Z' })
    expect(capped.state.deepAggregateUsage?.total_tokens).toBe(FOUNDATION_DEEP_MAX_MODEL_TOKENS + 1)
    expect(capped.state.tasks.find(item => item.taskId === deep.taskId)?.status).toBe('needs_action')

    const completedSeed = { ...seeded, tasks: completedTasks }
    let expired = appendFoundationConfirmationTask(completedSeed, { taskId: 'deep-2', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })
    expired = { ...expired, deepPhaseStartedAt: new Date(0).toISOString() }
    const expiredClaim = claimFoundationSemanticTasks({ ...expired, tasks: expired.tasks.map(item => item.kind === 'confirmation' ? item : { ...item, status: 'completed' as const }) }, { now: new Date(FOUNDATION_DEEP_PHASE_DEADLINE_MS + 1).toISOString(), dispatchIdFor: () => 'expired', configuredTiers: { strong: true } })
    expect(expiredClaim.tasks.find(item => item.kind === 'confirmation')?.status).toBe('needs_action')
  })
})
