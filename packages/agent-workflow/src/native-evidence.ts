/** CLI-side capture only. The portable writer is owned by isolated Reviewer. */
import { AsyncLocalStorage } from 'node:async_hooks'
import { createEvidenceWriter as createReviewEvidenceWriter, evidenceSecrets, type EvidenceIds, type RequestIds } from '../../agent-workflow-server/src/beegame/native-review-evidence'
import { emitNativeDiagnostic } from './native-diagnostics'
export { redactEvidence, evidenceSecrets } from '../../agent-workflow-server/src/beegame/native-review-evidence'

const requestScope = new AsyncLocalStorage<RequestIds>()
export const withEvidenceRequest = <T>(ids: RequestIds, run: () => T): T => requestScope.run(ids, run)
export function createEvidenceWriter(options: Parameters<typeof createReviewEvidenceWriter>[0]) {
  const writer = createReviewEvidenceWriter({ ...options, onIncomplete() {
    emitNativeDiagnostic({ event: 'evidence_incomplete' })
    options.onIncomplete?.()
  } })
  return { close: writer.close, get enabled() { return writer.enabled }, get incomplete() { return writer.incomplete },
    record(event: string, value: unknown, ids: Partial<EvidenceIds> & Partial<RequestIds> = {}) {
      writer.record(event, value, { ...requestScope.getStore(), ...ids })
    } }
}

let nativeWriter: ReturnType<typeof createEvidenceWriter> | undefined
let nativeTurnId: string | undefined
export function setNativeEvidenceTurn(id: string | undefined) { nativeTurnId = id }
export function nativeEvidence() {
  if (!nativeWriter && process.env.BEEGAME_REVIEW_EVIDENCE === '1' && process.env.BEEGAME_REVIEW_EVIDENCE_DIR && process.env.BEEGAME_REVIEW_EVIDENCE_IDS) {
    try {
      const ids = JSON.parse(process.env.BEEGAME_REVIEW_EVIDENCE_IDS) as EvidenceIds
      if (typeof ids.runId !== 'string' || typeof ids.attemptId !== 'string') return
      nativeWriter = createEvidenceWriter({ enabled: true, directory: process.env.BEEGAME_REVIEW_EVIDENCE_DIR, ids, secrets: evidenceSecrets(process.env) })
      process.once('exit', () => nativeWriter?.close())
    } catch { /* Invalid diagnostic configuration cannot affect model execution. */ }
  }
  return nativeWriter
}
export const recordNativeEvidence = (event: string, value: unknown, ids?: Partial<RequestIds>) => nativeEvidence()?.record(event, value,
  { ...(nativeTurnId ? { turnId: nativeTurnId, attemptId: nativeTurnId } : {}), ...ids })
export function recordContextChange(reason: string, before: unknown, after: unknown, ids?: RequestIds) {
  const writer = nativeEvidence()
  if (!writer?.enabled) return
  // Capture each side before a caller mutates it; no semantic interpretation of coverage.
  try {
    if (JSON.stringify(before) !== JSON.stringify(after)) recordNativeEvidence('context_change', { reason, before, after }, ids)
  } catch { recordNativeEvidence('context_unavailable', { reason }) }
}
export function evidenceContextCheckpoint(reason: string, before: unknown): (after: unknown) => void {
  if (!nativeEvidence()?.enabled) return () => {}
  try {
    const snapshot = JSON.parse(JSON.stringify(before))
    return after => recordContextChange(reason, snapshot, after)
  } catch { recordNativeEvidence('context_unavailable', { reason }); return () => {} }
}

/** Called at the SDK's fetch boundary. Does not consume/clone a Request or a live response stream. */
export function recordEvidenceTransport(init?: RequestInit) {
  if (!nativeEvidence()?.enabled) return
  if (typeof init?.body !== 'string') { recordNativeEvidence('transport_unavailable', { reason: 'non_string_body' }); return }
  try { recordNativeEvidence('transport_request', { body: JSON.parse(init.body) }) }
  catch { recordNativeEvidence('transport_unavailable', { reason: 'non_json_body' }) }
}
export function observeEvidenceFetch(run: () => Promise<Response>): Promise<Response> {
  if (!nativeEvidence()?.enabled) return run()
  return run().then(response => {
    recordNativeEvidence('transport_result', { status: response.status })
    return response
  }, error => {
    recordNativeEvidence('transport_failed', { reason: 'fetch_rejected' })
    throw error
  })
}


/** Assemble visible blocks before redaction: secrets can straddle arbitrary network chunks. */
export function createEvidenceResponseRecorder(requestId: () => number,
  sink: (event: string, value: unknown, ids: RequestIds) => void = recordNativeEvidence,
  enabled = Boolean(nativeEvidence()?.enabled)) {
  const blocks = new Map<number, { block: Record<string, unknown>; text: string[]; json: string[] }>()
  let messageStopObserved = false
  const emit = (event: string, value: unknown) => sink(event, value, { requestId: requestId() })
  function flush(index: number, complete: boolean) {
    const saved = blocks.get(index)
    if (!saved) return
    blocks.delete(index)
    const block = { ...saved.block }
    if (saved.text.length) block.text = String(block.text ?? '') + saved.text.join('')
    if (saved.json.length) {
      const raw = saved.json.join('')
      try { block.input = JSON.parse(raw) } catch { block.input = { unparsedJson: raw } }
    }
    emit('api_response_block', { index, complete, block })
  }
  return {
    consume(value: unknown) {
      if (!enabled) return
      try {
        const part = value as { type: string; index: number; content_block?: Record<string, unknown>; delta?: Record<string, unknown> }
        if (part.type === 'content_block_start' && part.content_block) {
          const block = part.content_block
          if (block.type === 'text' || block.type === 'tool_use') blocks.set(part.index, { block: { ...block }, text: [], json: [] })
          else emit('api_response_block_omitted', { index: part.index, type: block.type })
        } else if (part.type === 'content_block_delta') {
          const saved = blocks.get(part.index)
          if (saved && part.delta?.type === 'text_delta' && typeof part.delta.text === 'string') saved.text.push(part.delta.text)
          if (saved && part.delta?.type === 'input_json_delta' && typeof part.delta.partial_json === 'string') saved.json.push(part.delta.partial_json)
        } else if (part.type === 'content_block_stop') flush(part.index, true)
        else if (['message_start', 'message_delta', 'message_stop', 'error'].includes(part.type)) {
          if (part.type === 'message_stop') messageStopObserved = true
          emit('api_response_event', value)
        }
      } catch { emit('response_capture_incomplete', { reason: 'decode_failed' }) }
    },
    finish(value: unknown) {
      if (!enabled) return
      for (const index of blocks.keys()) flush(index, false)
      emit('api_stream_end', { messageStopObserved, outcome: value })
    },
  }
}
