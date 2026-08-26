import { describe, expect, test } from 'bun:test'
import {
  FOUNDATION_SEMANTIC_MAX_RUNNING,
  FOUNDATION_SEMANTIC_REQUIRED_CHECK_COUNT,
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

  test('requires exactly the service-owned manifest checks without treating their count as a complexity cap', () => {
    const extra = { ...task(0), taskId: 'rev:semantic:extra', checkId: 'SEM.custom_followup' }
    expect(FOUNDATION_SEMANTIC_REQUIRED_CHECK_COUNT).toBe(10)
    expect(() => createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: [...ten(), extra] })).toThrow(/service manifest/i)
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const completed = collection.tasks.map(item => ({
      ...item,
      status: 'completed' as const,
      terminalDigest: digest,
      usage: usage(1),
      durationMs: 1,
      dispatch: {
        dispatchId: `dispatch:${item.taskId}`,
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: item.taskId,
        revision: item.revision,
        status: 'completed' as const,
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        terminalResult: { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: `dispatch:${item.taskId}`, taskId: item.taskId, revision: item.revision, packetDigest: item.packetDigest, outcome: 'PASS' as const },
      },
    }))
    expect(foundationSemanticTasksComplete({ ...collection, tasks: completed })).toBe(true)
    expect(() => createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten().slice(1) })).toThrow(/required.*manifest|coverage/i)
  })

  test('routes persisted fast and balanced tiers and fails closed when a tier is missing', () => {
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const blocked = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'd', configuredTiers: { fast: true, balanced: false } })
    expect(blocked.tasks.filter(item => item.status === 'needs_action')).toHaveLength(8)
    expect(blocked.tasks.filter(item => item.status === 'running')).toHaveLength(2)
    expect(blocked.tasks[1]?.failureReason).toMatch(/balanced.*configured/i)
  })

  test('uses fresh dispatches for retry and keeps replay idempotent', () => {
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const claimed = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'd1', configuredTiers: { fast: true, balanced: true } })
    const failed = admitFoundationSemanticTerminal(claimed, { taskId: task(0).taskId, dispatchId: 'd1', revision: 'rev', packetDigest: digest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'failed', runId: 'run', dispatchId: 'd1', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' }, usage: usage(1), durationMs: 3, now: new Date(2).toISOString() })
    expect(failed.state.tasks[0]).toMatchObject({
      status: 'retryable',
      usage: usage(1),
      durationMs: 3,
      failureReason: 'semantic worker did not complete',
      dispatch: { status: 'failed', finishedAt: new Date(2).toISOString() },
    })
    const retry = claimFoundationSemanticTasks(failed.state, { now: new Date(3).toISOString(), dispatchIdFor: () => 'd2', configuredTiers: { fast: true, balanced: true } })
    expect(retry.tasks[0]?.dispatch?.dispatchId).toBe('d2')
    const highProviderUsage = admitFoundationSemanticTerminal(retry, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: 'd2', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' }, usage: { ...usage(1), completion_tokens: 4_897, total_tokens: 4_898 }, durationMs: 3, now: new Date(4).toISOString() })
    expect(highProviderUsage.state.tasks[0]?.status).toBe('completed')
    const nested = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'd2', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'PASS' as const, metadata: { nested: { marker: 1 } } }
    const replayState = retry.tasks.map(item => item.taskId === task(0).taskId ? { ...item, status: 'running' as const, dispatch: { ...item.dispatch!, dispatchId: 'd2' } } : item)
    const completed = admitFoundationSemanticTerminal({ ...retry, tasks: replayState }, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: nested, usage: usage(1), durationMs: 1, now: new Date(4).toISOString() })
    expect(completed.state.tasks[0]).toMatchObject({
      status: 'completed',
      durationMs: 1,
      dispatch: { status: 'completed', finishedAt: new Date(4).toISOString(), terminalResult: nested },
    })
    expect(digestFoundationSemanticTerminal(nested)).toHaveLength(64)
    expect(() => admitFoundationSemanticTerminal(completed.state, { taskId: task(0).taskId, dispatchId: 'd2', revision: 'rev', packetDigest: digest, terminal: { ...nested, metadata: { nested: { marker: 2 } } }, usage: usage(1), durationMs: 1, now: new Date(5).toISOString() })).toThrow(/conflicting/i)
  })

  test('admits the real multilingual two-issue semantic payload', () => {
    const issue = (suffix: string) => ({
      problem: `状态运行时恢复必须保留所有已确认的语义证据与上下文。${'恢复'.repeat(74)}${suffix}`,
      expected: '每个检查都应输出稳定、可重放且绑定当前语义包的结论。',
      actual: '当前输出在多语言问题描述中包含额外细节，导致固定预算边界被触发。',
      sourceSectionKey: 'GDD#core_loop',
      remediation: { kind: 'patch', sectionKeys: ['GDD#core_loop'] },
    })
    const terminal = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'dispatch', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'ISSUES' as const, issues: [issue('!'), issue('')] }
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const claimed = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })
    const admitted = admitFoundationSemanticTerminal(claimed, { taskId: task(0).taskId, dispatchId: 'dispatch', revision: 'rev', packetDigest: digest, terminal, usage: usage(1), durationMs: 1, now: new Date(2).toISOString() })
    expect(admitted.state.tasks[0]?.status).toBe('completed')
    const completedTasks = collection.tasks.map(item => ({ ...item, status: 'completed' as const, terminalDigest: terminalDigest(item, 'UNDECIDABLE'), usage: usage(1), durationMs: 1, dispatch: { dispatchId: `source-${item.taskId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: item.taskId, revision: item.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(item, 'UNDECIDABLE') } }))
    const deepSeed = appendFoundationConfirmationTask({ ...collection, tasks: completedTasks }, { taskId: 'deep-real-size', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })
    const deepClaimed = claimFoundationSemanticTasks(deepSeed, { onlyTaskId: 'deep-real-size', now: '1970-01-01T00:01:01.000Z', dispatchIdFor: () => 'deep-dispatch', configuredTiers: { strong: true } })
    const deepTask = deepClaimed.tasks.find(item => item.taskId === 'deep-real-size')!
    const deepAdmitted = admitFoundationSemanticTerminal(deepClaimed, { taskId: deepTask.taskId, dispatchId: 'deep-dispatch', revision: 'rev', packetDigest: digest, terminal: { ...terminal, taskId: deepTask.taskId, dispatchId: 'deep-dispatch' }, usage: usage(1), durationMs: 1, now: new Date(2).toISOString() })
    expect(deepAdmitted.state.tasks.find(item => item.taskId === deepTask.taskId)?.status).toBe('completed')
  })

  test('admits a legal multilingual issue set that exceeds the former semantic cap', () => {
    const issue = (index: number) => ({
      problem: `第${index}项规则在资源、进度和成长曲线之间缺少闭合约束。${'需要保留证据并明确修订边界。'.repeat(30)}`,
      expected: '规则应能从权威章节和已确认事实中被唯一推导。',
      actual: '当前章节给出的数值和解释存在冲突，无法直接形成可执行结论。',
      sourceSectionKey: 'GDD#progression',
      remediation: { kind: 'patch', sectionKeys: ['BALANCE#economy'] },
    })
    const terminal = { workerType: 'foundation-semantic-reviewer' as const, status: 'completed' as const, runId: 'run', dispatchId: 'dispatch', taskId: task(0).taskId, revision: 'rev', packetDigest: digest, outcome: 'ISSUES' as const, issues: [1, 2, 3, 4].map(issue) }
    const collection = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), tasks: ten() })
    const claimed = claimFoundationSemanticTasks(collection, { now: new Date(1).toISOString(), dispatchIdFor: () => 'dispatch', configuredTiers: { fast: true, balanced: true } })
    const admitted = admitFoundationSemanticTerminal(claimed, { taskId: task(0).taskId, dispatchId: 'dispatch', revision: 'rev', packetDigest: digest, terminal, usage: usage(1), durationMs: 1, now: new Date(2).toISOString() })
    expect(admitted.state.tasks[0]?.status).toBe('completed')
  })

  test('retains concurrency and per-dispatch accounting without aggregate gates', () => {
    expect(FOUNDATION_SEMANTIC_REQUIRED_CHECK_COUNT).toBe(10)
    expect(FOUNDATION_SEMANTIC_MAX_RUNNING).toBe(4)
    expect(foundationSemanticTasksComplete({ revision: 'rev', phaseStartedAt: new Date(0).toISOString(), status: 'semantic_review', tasks: [], aggregateUsage: usage(0) })).toBe(false)
    const oldAndExpensive = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: '2020-01-01T00:00:00.000Z', tasks: ten() })
    const claimed = claimFoundationSemanticTasks({ ...oldAndExpensive, aggregateUsage: usage(200_000) }, { now: '2026-08-25T00:00:00.000Z', dispatchIdFor: item => `old:${item.taskId}`, configuredTiers: { fast: true, balanced: true } })
    expect(claimed.tasks.filter(item => item.status === 'running')).toHaveLength(4)
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

  test('admits every valid confirmation and keeps dispatch concurrency bounded at four', () => {
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
    for (let i = 1; i < 5; i++) state = appendFoundationConfirmationTask(state, { taskId: `c${i + 1}`, sourceTaskId: task(i).taskId, admittedResult: admittedResult(task(i)), now: '1970-01-01T00:01:01.000Z' })
    expect(state.tasks.filter(item => item.kind === 'confirmation')).toHaveLength(5)
    const claimed = claimFoundationSemanticTasks(state, { now: '1970-01-01T00:01:02.000Z', dispatchIdFor: item => `dispatch:${item.taskId}`, configuredTiers: { strong: true } })
    expect(claimed.tasks.filter(item => item.kind === 'confirmation' && item.status === 'running')).toHaveLength(4)
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

  test('keeps deep confirmation accounting independent from semantic accounting', () => {
    const seeded = createFoundationSemanticTaskCollection({ revision: 'rev', phaseStartedAt: new Date().toISOString(), tasks: ten() })
    const completedTasks = seeded.tasks.map(item => ({ ...item, status: 'completed' as const, terminalDigest: terminalDigest(item, 'UNDECIDABLE'), usage: usage(1), durationMs: 1, dispatch: { dispatchId: `source-${item.taskId}`, workerType: 'foundation-semantic-reviewer' as const, phase: 'DOCUMENT_REVIEW' as const, taskId: item.taskId, revision: item.revision, status: 'completed' as const, startedAt: '1970-01-01T00:00:00.000Z', finishedAt: '1970-01-01T00:00:00.001Z', terminalResult: terminalEvidence(item, 'UNDECIDABLE') } }))
    let state: FoundationSemanticTaskCollection = { ...seeded, tasks: completedTasks }
    state = appendFoundationConfirmationTask(state, { taskId: 'deep-1', sourceTaskId: task(0).taskId, admittedResult: admittedResult(task(0)), now: '1970-01-01T00:01:00.000Z' })
    const claimed = claimFoundationSemanticTasks(state, { now: '1970-01-01T00:01:01.000Z', dispatchIdFor: item => `dispatch:${item.taskId}`, configuredTiers: { strong: true } })
    const deep = claimed.tasks.find(item => item.kind === 'confirmation')!
    const admitted = admitFoundationSemanticTerminal(claimed, { taskId: deep.taskId, dispatchId: deep.dispatch!.dispatchId, revision: deep.revision, packetDigest: deep.packetDigest, terminal: { workerType: 'foundation-semantic-reviewer', status: 'completed', runId: 'run', dispatchId: deep.dispatch!.dispatchId, taskId: deep.taskId, revision: deep.revision, packetDigest: deep.packetDigest, outcome: 'PASS' }, usage: { input_tokens: 200_000, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 1, total_tokens: 200_001 }, durationMs: 1, now: '2026-08-25T00:01:02.000Z' })
    expect(admitted.state.deepAggregateUsage?.total_tokens).toBe(200_001)
    expect(admitted.state.tasks.find(item => item.taskId === deep.taskId)?.status).toBe('completed')
  })
})
