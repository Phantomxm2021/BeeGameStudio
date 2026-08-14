import { describe, expect, test } from 'bun:test'
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
  return {
    start: () => {
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
      await writeFile(
        join(input.workspacePath, 'docs/GDD.md'),
        input.prompts.length > 1 && input.correctionBody
          ? input.correctionBody
          : input.body,
      )
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
  test('preserves and resumes one native session for draft calibration', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-resume-'))
    const prompts: string[] = []
    const sessionIds: string[] = []
    const disposedSessionIds: string[] = []
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
        waitForWorkflowWorkerIdle: async () => undefined,
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
      expect(disposedSessionIds).toEqual([started.sessionId])
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain('Calibrate only')
      expect(prompts[1]).not.toContain('rewrite the complete document')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('fails closed when a requested resume session is unavailable or busy', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-resume-gate-'))
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

      for (const sessionId of ['unknown-session', 'stopped-session', 'busy-session'])
        await expect(
          port.start(
            parallelRequest(
              workspacePath,
              `dispatch-${sessionId}`,
              'calibration',
              sessionId,
            ) as never,
          ),
        ).rejects.toThrow(/resume session/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('creates a fresh native session for every document dispatch', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-sessions-'))
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

      const first = await port.start(request(workspacePath, 'dispatch-one') as never)
      const second = await port.start(request(workspacePath, 'dispatch-two') as never)

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
        sessions: fakeSessions({ workspacePath, body, prompts, sessionIds }) as never,
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
      expect(count(prompts[0]!, 'Write the complete assigned document')).toBe(1)
      expect(count(prompts[0]!, 'end the turn normally')).toBe(1)
      expect(count(prompts[0]!, 'confirmed_build_brief')).toBe(1)
      expect(count(prompts[0]!, 'completeDocumentContract')).toBe(1)
      for (const protocolLiteral of [
        '<!-- beegame-executive-summary -->',
        '<!-- beegame-section:vision -->',
        '<!-- beegame-production-materials -->',
        '<!-- beegame-material:product-gameplay-overview -->',
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
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-incomplete-'))
    const prompts: string[] = []
    const sessionIds: string[] = []
    const body = '# Incomplete GDD\n\nNative progress remains on disk.\n'
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const port = createBeeGameDeliveryWorkerPort({
        sessions: fakeSessions({ workspacePath, body, prompts, sessionIds }) as never,
        userId: 'user',
      })

      await port.start(request(workspacePath, 'dispatch-incomplete') as never)
      await port.submit('dispatch-incomplete', 'original complete document prompt')
      await expect(
        port.waitForTerminal?.('dispatch-incomplete'),
      ).rejects.toThrow(/complete game document/i)
      expect(await readFile(join(workspacePath, 'docs/GDD.md'), 'utf8')).toBe(body)
      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain('complete game document sections')
      expect(prompts[1]).not.toContain(body)
      expect(prompts[1]).not.toContain('rewrite the document')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('returns a mechanical validation failure to the same native session once', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'native-document-correction-'))
    const prompts: string[] = []
    const sessionIds: string[] = []
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      const completeBody = renderTestCompleteGameDocument(
        'docs/GDD.md',
        completeTestSubmission('docs/GDD.md'),
      )
      const incompleteBody = completeBody.replace(
        '<!-- beegame-material:product-gameplay-overview -->',
        '',
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
      await port.submit('dispatch-correction', 'original complete document prompt')
      const terminal = await port.waitForTerminal?.('dispatch-correction')

      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain(
        'complete game document production materials must exactly match',
      )
      expect(prompts[1]).toContain('Fix only the reported mechanical contract failure')
      expect(prompts[1]).not.toContain(incompleteBody)
      expect(prompts[1]).not.toContain('rewrite the document')
      expect(terminal).toMatchObject({
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
