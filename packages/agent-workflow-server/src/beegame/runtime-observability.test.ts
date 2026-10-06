import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDocumentReceiptObservation,
  createRuntimeObservability,
} from './runtime-observability'

describe('passive native runtime observability', () => {
  test('retains only diagnostic metadata and does not assign late events to a finished turn', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-diagnostic-'))
    try {
      const observer = createRuntimeObservability({ workspacePath, sessionId: 'session',
        provider: 'anthropic', model: 'model' })
      observer.beginTurn({ requestId: 'host-turn' })
      observer.observeDiagnostic({ event: 'api_error', request: 7, attempt: 2,
        originRequest: 6, actor: 'a12345678', mode: 'non_streaming_fallback', phase: 'query', errorCode: 'ETIMEDOUT',
        category: 'timeout', prompt: 'PRIVATE', url: 'SECRET', headers: { auth: 'SECRET' } })
      observer.observeDiagnostic({ event: 'unknown', message: 'PRIVATE' })
      observer.observeDiagnostic({ event: 'api_error', status: 'PRIVATE' })
      observer.finishTurn({ outcome: 'success' })
      observer.observeDiagnostic({ event: 'stream_end', request: 7 })
      await observer.flush()
      const raw = await readFile(join(workspacePath, '.beegame/logs/native-runtime.jsonl'), 'utf8')
      const records = raw.trim().split('\n').map(line => JSON.parse(line))
      const diagnostics = records.filter(record => record.type === 'native_diagnostic')
      expect(diagnostics).toHaveLength(2)
      expect(diagnostics[0]).toMatchObject({ requestId: 'host-turn',
        diagnostic: { event: 'api_error', request: 7, attempt: 2, category: 'timeout',
          originRequest: 6, actor: 'a12345678', mode: 'non_streaming_fallback', phase: 'query', errorCode: 'ETIMEDOUT' } })
      expect(diagnostics[1].requestId).toBeUndefined()
      expect(raw).not.toContain('PRIVATE')
      expect(raw).not.toContain('SECRET')
    } finally { await rm(workspacePath, { recursive: true, force: true }) }
  })
  test('records stdout byte gaps without persisting streamed content', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-byte-gap-'))
    let nowMs = Date.parse('2026-08-12T10:00:00.000Z')
    try {
      const observer = createRuntimeObservability({
        workspacePath,
        sessionId: 'session-byte-gap',
        provider: 'anthropic',
        model: 'model-1',
        clock: () => new Date(nowMs),
        streamGapObservationMs: 1_000,
      })
      observer.beginTurn({ requestId: 'request-byte-gap' })
      observer.observeStdoutChunk(
        Buffer.from('PRIVATE PARTIAL TOOL JSON'),
      )
      nowMs += 3_500
      observer.observeStdoutChunk(Buffer.from('PRIVATE DOCUMENT BODY'))
      nowMs += 250
      observer.finishTurn({ outcome: 'success' })
      await observer.flush()

      const raw = await readFile(
        join(workspacePath, '.beegame/logs/native-runtime.jsonl'),
        'utf8',
      )
      const records = raw.trim().split('\n').map(line => JSON.parse(line))
      expect(records).toContainEqual(expect.objectContaining({
        type: 'stdout_resumed',
        gapMs: 3_500,
        chunkBytes: Buffer.byteLength('PRIVATE DOCUMENT BODY'),
      }))
      expect(records.at(-1)).toEqual(expect.objectContaining({
        type: 'turn_terminal',
        stdoutChunkCount: 2,
        stdoutByteCount:
          Buffer.byteLength('PRIVATE PARTIAL TOOL JSON') +
          Buffer.byteLength('PRIVATE DOCUMENT BODY'),
        maxStdoutChunkGapMs: 3_500,
        stdoutSilenceAtTerminalMs: 250,
      }))
      expect(raw).not.toContain('PRIVATE PARTIAL TOOL JSON')
      expect(raw).not.toContain('PRIVATE DOCUMENT BODY')
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('records terminal evidence without prompt bodies, tool inputs, or secrets', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-observation-'))
    try {
      const errors: string[] = []
      const observer = createRuntimeObservability({
        workspacePath,
        sessionId: 'session-1',
        provider: 'anthropic',
        model: 'model-1',
        launchContract: {
          selectedEnvironmentKeys: [
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_BASE_URL',
            'BEEGAME_CONFIG_DIR',
            'FEATURE_BASH_CLASSIFIER',
          ],
          forwardedEnvironmentKeys: [
            'ANTHROPIC_AUTH_TOKEN',
            'ANTHROPIC_BASE_URL',
            'BEEGAME_CONFIG_DIR',
          ],
          endpointClass: 'custom',
          configDirectoryConfigured: true,
          credentialConfigured: true,
        },
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
          launchContract: {
            selectedEnvironmentKeys: [
              'ANTHROPIC_AUTH_TOKEN',
              'ANTHROPIC_BASE_URL',
              'BEEGAME_CONFIG_DIR',
              'FEATURE_BASH_CLASSIFIER',
            ],
            forwardedEnvironmentKeys: [
              'ANTHROPIC_AUTH_TOKEN',
              'ANTHROPIC_BASE_URL',
              'BEEGAME_CONFIG_DIR',
            ],
            endpointClass: 'custom',
            configDirectoryConfigured: true,
            credentialConfigured: true,
          },
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
      expect(raw).not.toContain('provider-token')
      expect(raw).not.toContain('https://provider.example')
      expect(errors).toEqual(['api exploded request=req-provider'])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  for (const reason of ['user_stop', 'service_shutdown'] as const)
  test(`records ${reason} without reporting a runtime error`, async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-cancelled-'))
    try {
      const errors: string[] = []
      const observer = createRuntimeObservability({
        workspacePath,
        sessionId: 'session-cancelled',
        provider: 'anthropic',
        model: 'model-1',
        errorSink: message => errors.push(message),
      })
      observer.beginTurn({ requestId: 'request-cancelled' })
      const outcome = reason === 'user_stop' ? 'cancelled_by_user' : 'aborted'
      observer.finishTurn({ outcome, stopReason: reason })
      await observer.flush()

      const raw = await readFile(
        join(workspacePath, '.beegame/logs/native-runtime.jsonl'),
        'utf8',
      )
      expect(JSON.parse(raw.trim().split('\n').at(-1)!)).toMatchObject({
        type: 'turn_terminal',
        outcome,
        stopReason: reason,
      })
      expect(errors).toEqual([])
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
