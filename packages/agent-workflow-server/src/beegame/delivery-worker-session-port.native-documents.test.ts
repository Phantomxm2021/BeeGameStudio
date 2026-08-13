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
      })

      await port.start(request(workspacePath, 'dispatch-native') as never)
      await port.submit('dispatch-native', 'original complete document prompt')
      const terminal = await port.waitForTerminal?.('dispatch-native')

      expect(sessionIds).toHaveLength(1)
      expect(prompts).toHaveLength(1)
      expect(prompts[0]).toContain('Write the complete assigned document')
      expect(prompts[0]).toContain('original complete document prompt')
      expect(prompts[0]).not.toContain('checkpoint')
      expect(prompts[0]).not.toContain('beegame-draft-cursor')
      expect(terminal).toMatchObject({
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
        authoringMetrics: {
          toolCalls: {},
          failedToolCalls: 0,
          permissionDenials: 0,
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
      expect(prompts).toHaveLength(2)
      expect(prompts[1]).toContain('complete game document sections')
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
      expect(terminal).toMatchObject({
        status: 'completed',
        writtenPaths: ['docs/GDD.md'],
      })
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
