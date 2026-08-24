import { describe, expect, test } from 'bun:test'
import {
  acceptFoundationAuditTerminal,
  claimFoundationAuditTask,
  createFoundationAuditState,
  finalizeFoundationAuditTasks,
  type FoundationAuditTask,
} from './foundation-audit-state'
import {
  loadCommittedDerivedFoundationAuditArtifacts,
  publishDerivedFoundationAuditArtifacts,
} from './foundation-audit-artifacts'

const digest = (letter: string) => letter.repeat(64)

function task(status: FoundationAuditTask['status'] = 'pending'): FoundationAuditTask {
  return {
    taskId: 'foundation-fact:docs/GDD.md',
    kind: 'foundation-fact-extraction',
    revision: 'revision-1',
    packetDigest: digest('a'),
    modelTier: 'fast',
    status,
    attempt: 0,
  }
}

function state() {
  return createFoundationAuditState({
    revision: 'revision-1',
    documentDigests: [
      { path: 'docs/GDD.md', digest: digest('a') },
      { path: 'docs/LEVEL_SCENE_DESIGN.md', digest: digest('b') },
      { path: 'docs/BALANCE_DESIGN.md', digest: digest('c') },
      { path: 'docs/TECHNICAL_DESIGN.md', digest: digest('d') },
      { path: 'docs/ART_DIRECTION.md', digest: digest('e') },
      { path: 'docs/UI_UX_SPEC.md', digest: digest('f') },
      { path: 'docs/AUDIO_DESIGN.md', digest: digest('0') },
      { path: 'docs/ASSET_PLAN.md', digest: digest('1') },
    ],
    manifest: {
      revision: 'revision-1',
      status: 'index_staged',
      catalogVersion: 'foundation-facts.v1',
      sectionIndexDigest: digest('b'),
      needsAction: 'foundation fact extraction is not part of Task 4A',
    },
    tasks: [task()],
  })
}

describe('foundation fact task collection', () => {
  test('claims a pending task atomically and enforces four running tasks', () => {
    const claimed = claimFoundationAuditTask(state(), {
      taskId: task().taskId,
      revision: 'revision-1',
      packetDigest: digest('a'),
      dispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'foundation-fact-extractor',
        phase: 'DOCUMENT_REVIEW',
        taskId: task().taskId,
        revision: 'revision-1',
        status: 'running',
        startedAt: '2026-08-24T00:00:00.000Z',
      },
    })
    expect(claimed.tasks[0]).toMatchObject({
      status: 'running',
      attempt: 1,
      modelTier: 'fast',
      dispatch: { dispatchId: 'dispatch-1' },
    })
    expect(() =>
      claimFoundationAuditTask(
        { ...claimed, tasks: [...['b', 'c', 'd', 'e'].map(letter => ({ ...task('running'), taskId: `foundation-fact:${letter}` })), task()] },
        {
          taskId: task().taskId,
          revision: 'revision-1',
          packetDigest: digest('a'),
          dispatch: { ...claimed.tasks[0].dispatch!, dispatchId: 'dispatch-2' },
        },
      ),
    ).toThrow('maximum of four')
  })

  test('accepts an exact terminal once and rejects conflicting replay', () => {
    const claimed = claimFoundationAuditTask(state(), {
      taskId: task().taskId,
      revision: 'revision-1',
      packetDigest: digest('a'),
      dispatch: {
        dispatchId: 'dispatch-1',
        workerType: 'foundation-fact-extractor',
        phase: 'DOCUMENT_REVIEW',
        taskId: task().taskId,
        revision: 'revision-1',
        status: 'running',
        startedAt: '2026-08-24T00:00:00.000Z',
      },
    })
    const terminal = {
      taskId: task().taskId,
      dispatchId: 'dispatch-1',
      revision: 'revision-1',
      packetDigest: digest('a'),
      terminalDigest: digest('t'),
      status: 'completed' as const,
      usage: { input_tokens: 10, cache_read_tokens: 0, cache_creation_tokens: 0, completion_tokens: 3, total_tokens: 13 },
      durationMs: 42,
    }
    const completed = acceptFoundationAuditTerminal(claimed, terminal)
    expect(completed.tasks[0]).toMatchObject({ status: 'completed', terminalDigest: digest('t'), durationMs: 42 })
    expect(acceptFoundationAuditTerminal(completed, terminal)).toEqual(completed)
    expect(() => acceptFoundationAuditTerminal(completed, { ...terminal, terminalDigest: digest('x') })).toThrow('conflicting')
  })

  test('retries only once, then enters needs_action, and finalizes exactly once', () => {
    const claimed = claimFoundationAuditTask(state(), {
      taskId: task().taskId,
      revision: 'revision-1',
      packetDigest: digest('a'),
      dispatch: {
        dispatchId: 'dispatch-1', workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: task().taskId,
        revision: 'revision-1', status: 'running', startedAt: '2026-08-24T00:00:00.000Z',
      },
    })
    const retry = acceptFoundationAuditTerminal(claimed, {
      taskId: task().taskId, dispatchId: 'dispatch-1', revision: 'revision-1', packetDigest: digest('a'), terminalDigest: digest('x'), status: 'failed', failureReason: 'timeout', durationMs: 4,
    })
    expect(retry.tasks[0]).toMatchObject({ status: 'retryable', attempt: 1, failureReason: 'timeout' })
    const second = claimFoundationAuditTask(retry, {
      taskId: task().taskId, revision: 'revision-1', packetDigest: digest('a'),
      dispatch: { dispatchId: 'dispatch-2', workerType: 'foundation-fact-extractor', phase: 'DOCUMENT_REVIEW', taskId: task().taskId, revision: 'revision-1', status: 'running', startedAt: '2026-08-24T00:00:00.000Z' },
    })
    const exhausted = acceptFoundationAuditTerminal(second, {
      taskId: task().taskId, dispatchId: 'dispatch-2', revision: 'revision-1', packetDigest: digest('a'), terminalDigest: digest('y'), status: 'failed', failureReason: 'invalid', durationMs: 5,
    })
    expect(exhausted.tasks[0].status).toBe('needs_action')
    expect(() => finalizeFoundationAuditTasks(exhausted)).toThrow('cannot finalize')
    const done = acceptFoundationAuditTerminal(claimed, {
      taskId: task().taskId, dispatchId: 'dispatch-1', revision: 'revision-1', packetDigest: digest('a'), terminalDigest: digest('t'), status: 'completed', durationMs: 1,
    })
    expect(finalizeFoundationAuditTasks(done).status).toBe('facts_staged')
  })
})

describe('derived foundation audit publication', () => {
  test('publishes all derived facts behind one validated commit marker', async () => {
    const { mkdtemp, readFile, rm, stat } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-derived-'))
    try {
      const sectionIndex: never[] = []
      const factStore: never[] = []
      const published = await publishDerivedFoundationAuditArtifacts({
        workspacePath,
        revision: 'revision-1',
        documentDigests: [],
        sectionIndex,
        factStore,
        normalizedFactDigest: digest('c'),
      })
      expect(await stat(published.paths.commitMarker)).toBeTruthy()
      expect(JSON.parse(await readFile(published.paths.commitMarker, 'utf8'))).toMatchObject({ status: 'committed', revision: 'revision-1' })
      expect((await loadCommittedDerivedFoundationAuditArtifacts({ workspacePath, revision: 'revision-1' })).paths.derived).toBe(published.paths.derived)
      await rm(published.paths.commitMarker)
      await expect(loadCommittedDerivedFoundationAuditArtifacts({ workspacePath, revision: 'revision-1' })).rejects.toThrow('commit marker')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
