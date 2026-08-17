import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  completeTestSubmission,
  renderTestCompleteGameDocument,
} from '../__tests__/complete-game-document-fixture'
import { createBeeGameDeliveryWorkerPort } from './delivery-worker-session-port'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import { buildWorkerPrompt } from './delivery-workflow/worker-prompts'
import { commitAuthoredFoundationDocument } from './authored-document-receipt'

function count(value: string, needle: string): number {
  return value.split(needle).length - 1
}

function request(workspacePath: string, dispatchId: string) {
  return {
    dispatchId,
    runId: 'run',
    ownerId: 'owner',
    projectId: 'project',
    workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    revision: 'revision',
    allowedPaths: ['docs/GDD.md'],
    contract: {
      authoringMode: 'initial',
      documentSet: 'foundation',
      foundationDocumentPath: 'docs/GDD.md',
      upstreamDocumentPaths: [],
      completeDocumentContract: getGameDocumentContract('docs/GDD.md'),
    },
  } as const
}

function parallelRequest(
  workspacePath: string,
  dispatchId: string,
  authoringMode: 'parallel-draft' | 'calibration',
  resumeWorkerSessionId?: string,
) {
  return {
    dispatchId,
    runId: 'run',
    ownerId: 'owner',
    projectId: 'project',
    workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    taskId: 'docs/LEVEL_SCENE_DESIGN.md',
    revision: 'revision',
    allowedPaths: ['docs/LEVEL_SCENE_DESIGN.md'],
    contract: {
      authoringMode,
      documentSet: 'foundation',
      foundationDocumentPath: 'docs/LEVEL_SCENE_DESIGN.md',
      upstreamDocumentPaths: ['docs/GDD.md'],
      availableUpstreamPaths: ['docs/GDD.md'],
      completeDocumentContract: getGameDocumentContract(
        'docs/LEVEL_SCENE_DESIGN.md',
      ),
      ...(resumeWorkerSessionId ? { resumeWorkerSessionId } : {}),
    },
  } as const
}

function fakeSessions(input: {
  workspacePath: string
  body: string
  correctionBody?: string
  keepProcessingUntilIdle?: boolean
  prompts: string[]
  sessionIds: string[]
}) {
  const events: Array<Record<string, unknown>> = []
  let processing = false
  let streamContract:
    | {
        dispatchId: string
        targetPath: 'docs/GDD.md'
      }
    | undefined
  return {
    start: (startInput?: {
      workflowMarkdownStreamContract?: {
        dispatchId: string
        targetPath: 'docs/GDD.md'
      }
    }) => {
      streamContract = startInput?.workflowMarkdownStreamContract
      const session = {
        id: `session-${input.sessionIds.length + 1}`,
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: input.workspacePath,
      }
      input.sessionIds.push(session.id)
      return session
    },
    updateAuthToken: () => undefined,
    get: () => ({
      id: input.sessionIds.at(-1)!,
      status: 'running',
      turnStatus: 'idle',
      createdAt: new Date(),
      updatedAt: new Date(),
      cwd: input.workspacePath,
    }),
    events: () => events,
    isWorkflowWorkerOpen: () => true,
    waitForWorkflowWorkerIdle: async () => {
      processing = false
    },
    sendWithDisplay: async (_sessionId: string, prompt: string) => {
      if (processing) throw new Error('Session is already processing a prompt')
      processing = true
      input.prompts.push(prompt)
      const body =
        input.prompts.length > 1 && input.correctionBody
          ? input.correctionBody
          : input.body
      if (streamContract) {
        try {
          await commitAuthoredFoundationDocument({
            workspacePath: input.workspacePath,
            dispatchId: streamContract.dispatchId,
            targetPath: streamContract.targetPath,
            authoredBody: body,
          })
        } catch (error) {
          events.push({
            type: 'turn.failed',
            text: error instanceof Error ? error.message : String(error),
          })
          processing = false
          return
        }
      } else {
        await writeFile(join(input.workspacePath, 'docs/GDD.md'), body)
      }
      events.push({
        type: 'result',
        text: 'turn complete',
        payload: {
          type: 'result',
          num_turns: 1,
          usage: {
            input_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
            output_tokens: 0,
          },
          permission_denials: [],
        },
      })
      if (!input.keepProcessingUntilIdle) processing = false
    },
    stop: () => undefined,
    disposeWorkflowWorker: async () => undefined,
  }
}

describe('native initial document authoring', () => {
  test('has no Foundation remediation session-port boundary', () => {
    const source = readFileSync(
      new URL('./delivery-worker-session-port.ts', import.meta.url),
      'utf8',
    )
    expect(source).not.toContain('FOUNDATION_REMEDIATION_LANES')
    expect(source).not.toContain('document remediation authority is invalid')
    expect(source).not.toContain("authoringMode === 'remediation'")
  })

  test('persists the native visible Reviewer lane Markdown without a schema or Write tool call', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-markdown-'))
    const revision = 'a'.repeat(64)
    const projectionDigest = 'b'.repeat(64)
    const stagingPath = join(
      workspacePath,
      '.beegame/reviews/foundation',
      revision,
      '.staging/parts/core-design.md',
    )
    const committedPath = join(
      workspacePath,
      '.beegame/reviews/foundation',
      revision,
      'parts/core-design.md',
    )
    const markdown = [
      '# Foundation Review Packet',
      `Revision: \`${revision}\``,
      'Lane: `core-design`',
      `Projection: \`${projectionDigest}\``,
      '## `core-design:C1` — Loose list receipt',
      '### Problem',
      'The authority permits incompatible implementations.',
      '### Evidence',
      '- Path: `docs/GDD.md`',
      '  Location: Contract section',
      '  Observed: The required outcome is ambiguous.',
      '### Required outcome',
      'Define one implementable outcome.',
      '### Changes',
      '- Path: `docs/GDD.md`',
      '  Action: Define the unique outcome.',
      '### Acceptance',
      '- The outcome has one observable result.',
    ].join('\n\n')
    const prompts: string[] = []
    const events: Array<Record<string, unknown>> = []
    let startInput: Record<string, unknown> | undefined
    const sessions = {
      start: (input: Record<string, unknown>) => {
        startInput = input
        return {
          id: 'review-session',
          status: 'running',
          turnStatus: 'idle',
          createdAt: new Date(),
          updatedAt: new Date(),
          cwd: workspacePath,
        }
      },
      updateAuthToken: () => undefined,
      get: () => ({
        id: 'review-session',
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: workspacePath,
      }),
      events: () => events,
      isWorkflowWorkerOpen: () => true,
      sendWithDisplay: async (_sessionId: string, prompt: string) => {
        prompts.push(prompt)
        events.push({
          type: 'result',
          text: 'This visible text is not the Reviewer authority.',
          payload: {
            type: 'result',
            result: `  ${markdown}\n\n`,
            num_turns: 1,
            usage: {
              input_tokens: 0,
              cache_read_input_tokens: 0,
              cache_creation_input_tokens: 0,
              output_tokens: 0,
            },
            permission_denials: [],
          },
        })
      },
      stop: () => undefined,
      disposeWorkflowWorker: async () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = {
      dispatchId: 'review-dispatch',
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision,
      contract: {
        reviewMode: 'initial',
        reviewRole: 'core-design',
        projection: {
          path: '.beegame/reviews/foundation/projections/core-design.json',
          digest: projectionDigest,
          byteLength: 100,
        },
        assignment: {
          scope: 'foundation',
          role: 'core-design',
          sourcePaths: [join(workspacePath, 'docs/GDD.md')],
          stagingOutputPaths: [stagingPath],
          committedOutputPaths: [committedPath],
        },
      },
    } as const

    await port.start(request as never)
    await port.submit(request.dispatchId, 'Review the assigned lane.')
    await port.waitForTerminal?.(request.dispatchId)

    expect(prompts[0]).toContain(
      'Return exactly one contracted Markdown receipt as the visible final response',
    )
    expect(prompts[0]).toContain(
      'Use native read and search capabilities as needed',
    )
    expect(prompts[0]).toContain('Do not call StructuredOutput')
    expect(prompts[0]).not.toContain(
      'native tools, reasoning, permissions, context management, and normal completion behavior remain unchanged',
    )
    expect(startInput?.workflowJsonSchema).toBeUndefined()
    expect(await readFile(stagingPath, 'utf8')).toBe(`${markdown}\n`)
    await rm(workspacePath, { recursive: true, force: true })
  })

  test('persists the native visible synthesis selection Markdown', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-selection-'))
    const revision = 'a'.repeat(64)
    const stagingPath = join(
      workspacePath,
      '.beegame/reviews/foundation',
      revision,
      '.staging/selection.md',
    )
    const committedPath = join(
      workspacePath,
      '.beegame/reviews/foundation',
      revision,
      'selection.md',
    )
    const candidateReferences = [
      'core-design:C1',
      'technical-assets:C1',
      'presentation:C1',
    ]
    const markdown = [
      '普通前言段落会按原样持久化。',
      '# Foundation Review Selection',
      `Revision: \`${revision}\``,
      '## Keep',
      '- `core-design:C1`',
      '## Duplicate',
      '- `presentation:C1` -> `core-design:C1`',
      '## Reject',
      '- `technical-assets:C1`',
    ].join('\n\n')
    const events: Array<Record<string, unknown>> = []
    const sessions = {
      start: () => ({
        id: 'review-session',
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: workspacePath,
      }),
      updateAuthToken: () => undefined,
      get: () => ({
        id: 'review-session',
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: workspacePath,
      }),
      events: () => events,
      isWorkflowWorkerOpen: () => true,
      sendWithDisplay: async () => {
        events.push({
          type: 'result',
          text: markdown,
          payload: { type: 'result', result: markdown },
        })
      },
      stop: () => undefined,
      disposeWorkflowWorker: async () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = {
      dispatchId: 'synthesis-dispatch',
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision,
      contract: {
        reviewMode: 'initial',
        reviewRole: 'synthesis',
        candidateReferences,
        assignment: {
          scope: 'foundation',
          role: 'synthesis',
          sourcePaths: candidateReferences.map(reference =>
            join(workspacePath, `${reference.split(':')[0]}.md`),
          ),
          stagingOutputPaths: [stagingPath],
          committedOutputPaths: [committedPath],
        },
      },
    } as const

    await port.start(request as never)
    await port.submit(request.dispatchId, 'Select the accepted candidates.')
    await port.waitForTerminal?.(request.dispatchId)

    expect(await readFile(stagingPath, 'utf8')).toBe(`${markdown}\n`)
    await rm(workspacePath, { recursive: true, force: true })
  })

  test.each([
    ['missing', undefined, 'no visible Markdown receipt'],
    ['empty', ' \n\t ', 'no visible Markdown receipt'],
    ['malformed', '# Not a Foundation Review Packet', 'lane Markdown'],
    [
      'oversized',
      `# Foundation Review Packet\n\n${'x'.repeat(2 * 1024 * 1024)}`,
      'maximum',
    ],
  ])('rejects %s native Reviewer result text before returning a completed terminal', async (_case, resultText, expectedError) => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'reviewer-invalid-'))
    const revision = 'a'.repeat(64)
    const stagingPath = join(workspacePath, '.beegame/reviewer.md')
    const events: Array<Record<string, unknown>> = []
    const sessions = {
      start: () => ({
        id: 'review-session',
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: workspacePath,
      }),
      updateAuthToken: () => undefined,
      get: () => ({
        id: 'review-session',
        status: 'running',
        turnStatus: 'idle',
        createdAt: new Date(),
        updatedAt: new Date(),
        cwd: workspacePath,
      }),
      events: () => events,
      isWorkflowWorkerOpen: () => true,
      sendWithDisplay: async () => {
        events.push({
          type: 'result',
          text: typeof resultText === 'string' ? resultText : '',
          payload: {
            type: 'result',
            ...(typeof resultText === 'string' ? { result: resultText } : {}),
          },
        })
      },
      stop: () => undefined,
      disposeWorkflowWorker: async () => undefined,
    }
    const port = createBeeGameDeliveryWorkerPort({
      sessions: sessions as never,
      userId: 'user',
    })
    const request = {
      dispatchId: `invalid-${_case}`,
      runId: 'run',
      ownerId: 'owner',
      projectId: 'project',
      workspacePath,
      workerType: 'document-reviewer',
      phase: 'DOCUMENT_REVIEW',
      revision,
      contract: {
        reviewMode: 'initial',
        reviewRole: 'core-design',
        projection: {
          path: '.beegame/projection.json',
          digest: 'b'.repeat(64),
          byteLength: 100,
        },
        assignment: {
          scope: 'foundation',
          role: 'core-design',
          sourcePaths: [join(workspacePath, 'docs/GDD.md')],
          stagingOutputPaths: [stagingPath],
          committedOutputPaths: [join(workspacePath, 'reviewer.md')],
        },
      },
    } as const

    await port.start(request as never)
    await port.submit(request.dispatchId, 'Review the assigned lane.')
    await expect(port.waitForTerminal?.(request.dispatchId)).rejects.toThrow(
      expectedError,
    )
    await expect(readFile(stagingPath, 'utf8')).rejects.toThrow()
    await rm(workspacePath, { recursive: true, force: true })
  })

  test.skip('legacy calibration session resume is removed', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-resume-'),
    )
    const prompts: string[] = []
    const sessionIds: string[] = []
    const disposedSessionIds: string[] = []
    const idleSessionIds: string[] = []
    const reboundDispatches: Array<{
      sessionId: string
      runId: string
      dispatchId: string
      workerType: string
    }> = []
    const events: Array<Record<string, unknown>> = []
    const states = new Map<
      string,
      { status: 'running' | 'stopped'; turnStatus: 'idle' | 'running' }
    >()
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(
        join(workspacePath, 'docs/LEVEL_SCENE_DESIGN.md'),
        renderTestCompleteGameDocument(
          'docs/LEVEL_SCENE_DESIGN.md',
          completeTestSubmission('docs/LEVEL_SCENE_DESIGN.md'),
        ),
      )
      await writeFile(
        join(workspacePath, 'docs/GDD.md'),
        renderTestCompleteGameDocument(
          'docs/GDD.md',
          completeTestSubmission('docs/GDD.md'),
        ),
      )
      const nativeSessions = {
        start: () => {
          const id = `session-${sessionIds.length + 1}`
          sessionIds.push(id)
          states.set(id, { status: 'running', turnStatus: 'idle' })
          return {
            id,
            status: 'running',
            turnStatus: 'idle',
            createdAt: new Date(),
            updatedAt: new Date(),
            cwd: workspacePath,
          }
        },
        updateAuthToken: () => undefined,
        get: (id: string) => {
          const state = states.get(id)
          return state
            ? {
                id,
                ...state,
                createdAt: new Date(),
                updatedAt: new Date(),
                cwd: workspacePath,
              }
            : undefined
        },
        events: () => events,
        isWorkflowWorkerOpen: () => true,
        waitForWorkflowWorkerIdle: async (id: string) => {
          idleSessionIds.push(id)
        },
        rebindWorkflowWorker: async (
          id: string,
          binding: {
            runId: string
            dispatchId: string
            workerType: string
          },
        ) => {
          reboundDispatches.push({ sessionId: id, ...binding })
        },
        sendWithDisplay: async (_sessionId: string, prompt: string) => {
          prompts.push(prompt)
          events.push({
            type: 'result',
            text: 'turn complete',
            payload: {
              type: 'result',
              num_turns: 1,
              usage: {
                input_tokens: 0,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                output_tokens: 0,
              },
              permission_denials: [],
            },
          })
        },
        stop: (id: string) => {
          const state = states.get(id)
          if (state) state.status = 'stopped'
        },
        disposeWorkflowWorker: async (id: string) => {
          disposedSessionIds.push(id)
          states.delete(id)
        },
      }
      const port = createBeeGameDeliveryWorkerPort({
        sessions: nativeSessions as never,
        userId: 'user',
      })

      const draft = parallelRequest(
        workspacePath,
        'dispatch-draft',
        'parallel-draft',
      )
      const started = await port.start(draft as never)
      await port.submit(draft.dispatchId, 'Author the independent draft.')
      await port.waitForTerminal?.(draft.dispatchId)
      await port.close?.(draft.dispatchId, { preserveSession: true })

      const calibration = parallelRequest(
        workspacePath,
        'dispatch-calibration',
        'calibration',
        started.sessionId,
      )
      await port.start(calibration as never)
      await port.submit(
        calibration.dispatchId,
        'Calibrate only against the newly committed upstream authority.',
      )
      await port.waitForTerminal?.(calibration.dispatchId)
      await port.close?.(calibration.dispatchId)

      expect(sessionIds).toHaveLength(1)
      expect(idleSessionIds).toContain(started.sessionId)
      expect(reboundDispatches).toEqual([
        {
          sessionId: started.sessionId,
          runId: 'run',
          dispatchId: 'dispatch-calibration',
          workerType: 'document-author',
        },
      ])
      expect(disposedSessionIds).toEqual([started.sessionId])
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain('Calibrate only')
      expect(prompts[1]).not.toContain('rewrite the complete document')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('fails closed when a requested resume session is unavailable or busy', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-resume-gate-'),
    )
    const states = new Map<
      string,
      { status: 'running' | 'stopped'; turnStatus: 'idle' | 'running' }
    >([
      ['stopped-session', { status: 'stopped', turnStatus: 'idle' }],
      ['busy-session', { status: 'running', turnStatus: 'running' }],
    ])
    try {
      const nativeSessions = {
        start: () => {
          throw new Error('resume must not create a replacement session')
        },
        get: (id: string) => {
          const state = states.get(id)
          return state
            ? {
                id,
                ...state,
                createdAt: new Date(),
                updatedAt: new Date(),
                cwd: workspacePath,
              }
            : undefined
        },
      }
      const port = createBeeGameDeliveryWorkerPort({
        sessions: nativeSessions as never,
        userId: 'user',
      })

      for (const sessionId of [
        'unknown-session',
        'stopped-session',
        'busy-session',
      ])
        await expect(
          port.start(
            parallelRequest(
              workspacePath,
              `dispatch-${sessionId}`,
              'calibration',
              sessionId,
            ) as never,
          ),
        ).rejects.toThrow(/resume|not supported/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('creates a fresh native session for every document dispatch', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-sessions-'),
    )
    const sessionIds: string[] = []
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const sessions = fakeSessions({
        workspacePath,
        body: '',
        prompts: [],
        sessionIds,
      })
      const port = createBeeGameDeliveryWorkerPort({
        sessions: sessions as never,
        userId: 'user',
      })

      const first = await port.start(
        request(workspacePath, 'dispatch-one') as never,
      )
      const second = await port.start(
        request(workspacePath, 'dispatch-two') as never,
      )

      expect(first.sessionId).not.toBe(second.sessionId)
      expect(new Set(sessionIds).size).toBe(2)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('completes one document in one unconstrained native session', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-'))
    const prompts: string[] = []
    const sessionIds: string[] = []
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const body = renderTestCompleteGameDocument(
        'docs/GDD.md',
        completeTestSubmission('docs/GDD.md'),
      )
      const port = createBeeGameDeliveryWorkerPort({
        sessions: fakeSessions({
          workspacePath,
          body,
          prompts,
          sessionIds,
        }) as never,
        userId: 'user',
        confirmedBriefContext:
          '{"kind":"confirmed_build_brief","marker":"unique-authority"}',
      })

      const dispatch = request(workspacePath, 'dispatch-native')
      await port.start(dispatch as never)
      await port.submit('dispatch-native', buildWorkerPrompt(dispatch as never))
      const terminal = await port.waitForTerminal?.('dispatch-native')

      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(1)
      expect(count(prompts[0]!, 'complete raw Markdown body')).toBeGreaterThan(
        0,
      )
      expect(prompts[0]).toContain('Do not call tools')
      expect(count(prompts[0]!, 'confirmed_build_brief')).toBe(1)
      expect(count(prompts[0]!, 'completeDocumentContract')).toBe(1)
      expect(prompts[0]).toContain('BGS injects all beegame protocol comments')
      expect(prompts[0]).not.toContain('<!-- beegame-')
      for (const protocolLiteral of [
        '## Production Materials',
        '### Product and Gameplay Overview',
      ])
        expect(count(prompts[0]!, protocolLiteral)).toBe(1)
      for (const materialId of [
        'product-gameplay-overview',
        'core-loop-diagram',
        'game-state-flow',
      ])
        expect(count(prompts[0]!, materialId)).toBe(1)
      expect(count(prompts[0]!, 'unique-authority')).toBe(1)
      expect(prompts[0]).not.toContain('checkpoint')
      expect(prompts[0]).not.toContain('beegame-draft-cursor')
      expect(prompts[0]).not.toContain('must use Write')
      expect(prompts[0]).not.toContain('three writes')
      expect(terminal).toMatchObject({
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        authoringMetrics: {
          toolCalls: {},
          failedToolCalls: 0,
          permissionDenials: 0,
          authorityProjection: {
            byteLength: expect.any(Number),
            rangeCount: 0,
            projectedLineCount: 0,
          },
        },
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('preserves incomplete native output and reports the final contract failure', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-incomplete-'),
    )
    const prompts: string[] = []
    const sessionIds: string[] = []
    const body = '# Incomplete GDD\n\nNative progress remains on disk.\n'
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const port = createBeeGameDeliveryWorkerPort({
        sessions: fakeSessions({
          workspacePath,
          body,
          prompts,
          sessionIds,
        }) as never,
        userId: 'user',
      })

      await port.start(request(workspacePath, 'dispatch-incomplete') as never)
      await port.submit(
        'dispatch-incomplete',
        'original complete document prompt',
      )
      await expect(
        port.waitForTerminal?.('dispatch-incomplete'),
      ).rejects.toThrow(/complete game document/i)
      await expect(
        readFile(join(workspacePath, 'docs/GDD.md'), 'utf8'),
      ).rejects.toThrow()
      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(1)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('reports the authoritative commit failure appended while draining the native turn', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-drain-failure-'),
    )
    const events: Array<Record<string, unknown>> = []
    let failureAppended = false
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const sessions = {
        start: () => ({
          id: 'session-drain-failure',
          status: 'running',
          turnStatus: 'idle',
          createdAt: new Date(),
          updatedAt: new Date(),
          cwd: workspacePath,
        }),
        updateAuthToken: () => undefined,
        get: () => ({
          id: 'session-drain-failure',
          status: 'running',
          turnStatus: 'idle',
          createdAt: new Date(),
          updatedAt: new Date(),
          cwd: workspacePath,
        }),
        events: () => events,
        isWorkflowWorkerOpen: () => true,
        waitForWorkflowWorkerIdle: async () => {
          if (!failureAppended) {
            failureAppended = true
            events.push({
              type: 'turn.failed',
              text: 'complete game document canonical heading must appear exactly once: ## Asset Inventory Table',
            })
          }
        },
        sendWithDisplay: async () => {
          events.push({
            type: 'result',
            text: 'native response completed',
            payload: {
              type: 'result',
              usage: {
                input_tokens: 1,
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
                output_tokens: 1,
              },
              permission_denials: [],
            },
          })
        },
        stop: () => undefined,
        disposeWorkflowWorker: async () => undefined,
      }
      const port = createBeeGameDeliveryWorkerPort({
        sessions: sessions as never,
        userId: 'user',
      })

      await port.start(
        request(workspacePath, 'dispatch-drain-failure') as never,
      )
      await port.submit('dispatch-drain-failure', 'complete document prompt')
      await expect(
        port.waitForTerminal?.('dispatch-drain-failure'),
      ).rejects.toThrow(
        'complete game document canonical heading must appear exactly once: ## Asset Inventory Table',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('fails once without a hidden correction turn', async () => {
    const workspacePath = await mkdtemp(
      join(tmpdir(), 'native-document-correction-'),
    )
    const prompts: string[] = []
    const sessionIds: string[] = []
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const completeBody = renderTestCompleteGameDocument(
        'docs/GDD.md',
        completeTestSubmission('docs/GDD.md'),
      )
      const incompleteBody = completeBody.replace(
        '### Product and Gameplay Overview',
        '### Renamed Product Overview',
      )
      const port = createBeeGameDeliveryWorkerPort({
        sessions: fakeSessions({
          workspacePath,
          body: incompleteBody,
          correctionBody: completeBody,
          keepProcessingUntilIdle: true,
          prompts,
          sessionIds,
        }) as never,
        userId: 'user',
      })

      await port.start(request(workspacePath, 'dispatch-correction') as never)
      await port.submit(
        'dispatch-correction',
        'original complete document prompt',
      )
      await expect(
        port.waitForTerminal?.('dispatch-correction'),
      ).rejects.toThrow(/canonical heading/i)

      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(1)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
