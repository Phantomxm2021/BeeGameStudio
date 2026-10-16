import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendDocumentReceiptObservation,
  createRuntimeObservability,
} from './runtime-observability'

describe('passive native runtime observability', () => {
  test('unfinished compaction is retained on cancellation, not passed or billed as zero', async () => {
    const workspacePath=await mkdtemp(join(tmpdir(),'runtime-compact-'))
    let now=1000
    try {
      const observer=createRuntimeObservability({workspacePath,sessionId:'compact',provider:'fixture',model:'fixture',clock:()=>new Date(now)})
      observer.beginTurn({requestId:'turn'})
      observer.observeMessage({type:'system',subtype:'status',status:'compacting'})
      now+=30000
      observer.observeMessage({type:'system',subtype:'status',status:'compacting'})
      observer.observeDiagnostic({event:'request_start',source:'compact',evidenceSource:'cli_debug',prompt:'PRIVATE'})
      now+=10000
      observer.finishTurn({outcome:'aborted',stopReason:'user_pause'})
      await observer.flush()
      const text=await readFile(join(workspacePath,'.beegame/logs/native-runtime.jsonl'),'utf8')
      const rows=text.trim().split('\n').map(line=>JSON.parse(line))
      expect(rows.filter(row=>row.type==='compaction_started')).toHaveLength(1)
      expect(rows.at(-1).compaction).toMatchObject({status:'unfinished',elapsedMs:40000,elapsedBasis:'compacting_status_observed',statusElapsedMs:40000,usage:'unknown'})
      expect(rows.at(-1).outcome).toBe('aborted')
      expect(text).not.toContain('PRIVATE')
    } finally {await rm(workspacePath,{recursive:true,force:true})}
  })
  test('cleared compaction status is distinct from a successful boundary', async () => {
    const workspacePath=await mkdtemp(join(tmpdir(),'runtime-compact-clear-'))
    try {
      const observer=createRuntimeObservability({workspacePath,sessionId:'compact',provider:'fixture',model:'fixture'})
      observer.beginTurn({requestId:'turn'})
      observer.observeMessage({type:'system',subtype:'status',status:'compacting'})
      observer.observeMessage({type:'system',subtype:'status',status:null})
      observer.observeMessage({type:'system',subtype:'status',status:null})
      observer.finishTurn({outcome:'success'});await observer.flush()
      const rows=(await readFile(join(workspacePath,'.beegame/logs/native-runtime.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      expect(rows.filter(row=>row.type==='compaction_status_cleared')).toHaveLength(1)
      expect(rows.filter(row=>row.type==='compaction_boundary')).toHaveLength(0)
      expect(rows.at(-1).compaction).toMatchObject({status:'unfinished',usage:'unknown'})
    } finally {await rm(workspacePath,{recursive:true,force:true})}
  })
  test('late SDK status does not replace the observed compact request duration or guess header ownership', async () => {
    const workspacePath=await mkdtemp(join(tmpdir(),'runtime-compact-late-'))
    let now=1000
    try {
      const observer=createRuntimeObservability({workspacePath,sessionId:'compact',provider:'fixture',model:'fixture',clock:()=>new Date(now)})
      observer.beginTurn({requestId:'turn'})
      observer.observeDiagnostic({event:'request_start',source:'compact',evidenceSource:'cli_debug'})
      now+=14215;observer.observeDiagnostic({event:'response_headers',status:200,delayMs:14215,evidenceSource:'cli_debug'})
      now=205141;observer.observeMessage({type:'system',subtype:'status',status:'compacting'})
      now+=7;observer.observeMessage({type:'system',subtype:'compact_boundary'})
      now+=1000;observer.finishTurn({outcome:'success'});await observer.flush()
      const rows=(await readFile(join(workspacePath,'.beegame/logs/native-runtime.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      expect(rows.find(row=>row.type==='compaction_boundary')).toMatchObject({elapsedMs:204148,statusElapsedMs:7,
        elapsedBasis:'first_compact_request_observed',compactRequestCount:1})
      expect(rows.at(-1).compaction).toBeUndefined()
      expect(rows.find(row=>row.diagnostic?.event==='response_headers').diagnostic.source).toBeUndefined()
    } finally {await rm(workspacePath,{recursive:true,force:true})}
  })
  test('request-only cancellation remains unknown; known child and late requests do not pollute the next turn', async () => {
    const workspacePath=await mkdtemp(join(tmpdir(),'runtime-compact-request-only-'))
    let now=1000
    try {
      const observer=createRuntimeObservability({workspacePath,sessionId:'compact',provider:'fixture',model:'fixture',clock:()=>new Date(now)})
      observer.beginTurn({requestId:'first'})
      observer.observeDiagnostic({event:'request_start',source:'compact'})
      now+=1500;observer.observeDiagnostic({event:'request_start',source:'compact'})
      now+=500;observer.finishTurn({outcome:'aborted'})
      observer.observeDiagnostic({event:'request_start',source:'compact'})
      observer.beginTurn({requestId:'next'})
      observer.observeDiagnostic({event:'request_start',source:'compact',actor:'a12345678'})
      observer.observeMessage({type:'system',subtype:'compact_boundary'})
      observer.finishTurn({outcome:'success'});await observer.flush()
      const rows=(await readFile(join(workspacePath,'.beegame/logs/native-runtime.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      expect(rows.find(row=>row.type==='turn_terminal'&&row.requestId==='first').compaction).toMatchObject({
        status:'unfinished',elapsedMs:2000,compactRequestCount:2,usage:'unknown'})
      expect(rows.find(row=>row.type==='compaction_boundary').elapsedMs).toBeUndefined()
      expect(rows.at(-1).compaction).toBeUndefined()
    } finally {await rm(workspacePath,{recursive:true,force:true})}
  })
  test('an actual compaction boundary ends the observation even without a cleared status', async () => {
    const workspacePath=await mkdtemp(join(tmpdir(),'runtime-compact-boundary-'))
    let now=1000
    try {
      const observer=createRuntimeObservability({workspacePath,sessionId:'compact',provider:'fixture',model:'fixture',clock:()=>new Date(now)})
      observer.beginTurn({requestId:'turn'})
      observer.observeMessage({type:'system',subtype:'status',status:'compacting'})
      now+=1500;observer.observeMessage({type:'system',subtype:'compact_boundary'})
      observer.finishTurn({outcome:'success'});await observer.flush()
      const rows=(await readFile(join(workspacePath,'.beegame/logs/native-runtime.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line))
      expect(rows.find(row=>row.type==='compaction_boundary').elapsedMs).toBe(1500)
      expect(rows.at(-1).compaction).toBeUndefined()
    } finally {await rm(workspacePath,{recursive:true,force:true})}
  })
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
  test('persists sanitized stream comparison through the existing native diagnostic channel', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'runtime-stream-summary-'))
    try {
      const observer = createRuntimeObservability({ workspacePath, sessionId: 'session', provider: 'openai', model: 'fixture' })
      observer.beginTurn({ requestId: 'turn' })
      observer.observeDiagnostic({ event: 'openai_stream_summary', outcome: 'failed', streamFailure: 'upstream_incomplete',
        bytes: 120, wireEvents: 1, parsedChunks: 1, wireFinishSeen: false, parsedFinishSeen: false, eofSeen: true,
        headers: { authorization: 'PRIVATE_KEY' }, body: 'PRIVATE', error: 'PRIVATE' })
      observer.finishTurn({ outcome: 'error' }); await observer.flush()
      const raw = await readFile(join(workspacePath, '.beegame/logs/native-runtime.jsonl'), 'utf8')
      const rows = raw.trim().split('\n').map(line => JSON.parse(line))
      expect(rows.find(row => row.type === 'native_diagnostic')).toMatchObject({ requestId: 'turn',
        diagnostic: { event: 'openai_stream_summary', streamFailure: 'upstream_incomplete',
          wireFinishSeen: false, parsedFinishSeen: false, eofSeen: true } })
      expect(raw).not.toContain('PRIVATE')
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
