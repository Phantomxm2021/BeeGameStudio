import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDocumentReceiptObservation,
  createRuntimeObservability,
} from './runtime-observability'

describe('passive native runtime observability', () => {
  test('records terminal evidence without prompt bodies, tool inputs, or secrets', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-observation-'))
    try {
      const errors: string[] = []
      const observer = createRuntimeObservability({
        workspacePath,
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'model-1',
        errorSink: message => errors.push(message),
      })
      expect(observer.beginTurn({ requestId: 'request-1' })).toBeUndefined()
      observer.observeLine('{"type":"assistant"}')
      observer.observeMessage({
        type: 'assistant',
        message: {
          content: [{
            type: 'tool_use',
            id: 'tool-1',
            name: 'Write',
            input: { content: 'SECRET PROMPT BODY' },
          }],
        },
      })
      observer.observeMessage({ type: 'result', subtype: 'error' })
      observer.finishTurn({
        outcome: 'error',
        error: new Error('api exploded request=req-provider'),
      })
      await observer.flush()

      await appendDocumentReceiptObservation({
        workspacePath,
        sessionId: 'session-1',
        dispatchId: 'dispatch-1',
        targetPath: 'docs/GDD.md',
        digest: 'a'.repeat(64),
      })
      const raw = await readFile(
        join(workspacePath, '.beegame/logs/native-runtime.jsonl'),
        'utf8',
      )
      const records = raw.trim().split('\n').map(line => JSON.parse(line))
      expect(records).toEqual([
        expect.objectContaining({
          type: 'turn_started',
          sessionId: 'session-1',
          requestId: 'request-1',
          provider: 'anthropic',
          model: 'model-1',
        }),
        expect.objectContaining({
          type: 'tool_started',
          toolUseId: 'tool-1',
          toolName: 'Write',
        }),
        expect.objectContaining({
          type: 'turn_terminal',
          outcome: 'error',
          eventCount: 2,
          byteCount: 20,
          lastEventType: 'result',
          error: 'api exploded request=req-provider',
        }),
        expect.objectContaining({
          type: 'document_receipt',
          dispatchId: 'dispatch-1',
          targetPath: 'docs/GDD.md',
          digest: 'a'.repeat(64),
        }),
      ])
      expect(raw).not.toContain('SECRET PROMPT BODY')
      expect(raw).not.toContain('input')
      expect(errors).toEqual(['api exploded request=req-provider'])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
