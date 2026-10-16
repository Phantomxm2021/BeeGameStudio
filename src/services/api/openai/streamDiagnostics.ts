import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import {
  NATIVE_DIAGNOSTIC_PREFIX,
  nativeErrorMetadata,
  parseNativeDiagnostic,
  type NativeDiagnostic,
} from '@bee-game-studio/agent-workflow/native-diagnostics'
import { writeToStderr } from '../../../utils/process.js'

let request = 0
const MAX_FRAME_CHARS = 64 * 1024

/** Observe the same response, without teeing, retaining payloads or issuing requests. */
export function createOpenAIStreamDiagnostics(
  baseFetch: typeof fetch,
  source?: string,
  emit: (line: string) => void = writeToStderr,
) {
  const started = performance.now()
  let lastRead = started
  let finished = false
  let transportError: unknown
  let upstreamError = false
  let sdkFailed = false
  let parsedEnded = false
  const summary: NativeDiagnostic = {
    event: 'openai_stream_summary', request: ++request, mode: 'streaming',
    source: source === 'compact' ? 'compact' : source === 'main' ? 'main' : 'other',
    bytes: 0, wireEvents: 0, parsedChunks: 0, invalidFrames: 0, skippedFrames: 0, maxGapMs: 0,
    wireFinishSeen: false, parsedFinishSeen: false, doneSeen: false, eofSeen: false,
    terminalWithoutDelta: false, pendingFrame: false,
  }
  // This bounded frame is transient and never passed to the log sink.
  let frame = '', line = '', skipping = false, previousCR = false
  function skipFrame() {
    if (!skipping) summary.skippedFrames!++
    skipping = true; frame = ''
  }
  function dispatchFrame() {
    if (!skipping && frame && !summary.doneSeen) {
      summary.wireEvents!++
      const data = frame.slice(0, -1)
      if (data.startsWith('[DONE]')) summary.doneSeen = true
      else {
        try {
          const value = JSON.parse(data)
          const choice = value?.choices?.[0]
          if (choice?.finish_reason) {
            summary.wireFinishSeen = true
            if (choice.delta == null) summary.terminalWithoutDelta = true
          }
          if (value?.error) upstreamError = true
        } catch { summary.invalidFrames!++ }
      }
    }
    frame = ''; skipping = false
  }
  function endLine() {
    if (!line) dispatchFrame()
    else if (!skipping && line.startsWith('data:')) {
      const data = line.slice(5).replace(/^ /, '')
      if (frame.length + data.length + 1 > MAX_FRAME_CHARS) { skipFrame() }
      else frame += data + '\n'
    }
    line = ''
  }
  function observeText(text: string) {
    for (const char of text) {
      if (char === '\r') { endLine(); previousCR = true }
      else if (char === '\n') { if (!previousCR) endLine(); previousCR = false }
      else {
        previousCR = false
        if (line.length < MAX_FRAME_CHARS) line += char
        else { skipFrame(); line = '' }
      }
    }
    summary.pendingFrame = !!(line || frame || skipping)
  }

  const fetchWithDiagnostics = (async (...args: Parameters<typeof fetch>) => {
    let response: Response
    try { response = await baseFetch(...args) }
    catch (error) { transportError = error; throw error }
    summary.status = response.status
    summary.responseFormat = response.headers.get('content-type')?.split(';')[0]?.trim() === 'text/event-stream'
      ? 'event_stream' : 'other'
    if (!response.ok || !response.body) return response
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await reader.read()
          const now = performance.now()
          summary.maxGapMs = Math.max(summary.maxGapMs!, Math.round(now - lastRead))
          lastRead = now
          if (done) {
            if (summary.responseFormat === 'event_stream') observeText(decoder.decode())
            summary.eofSeen = true
            reader.releaseLock(); controller.close()
          } else {
            summary.bytes! += value.byteLength
            if (summary.responseFormat === 'event_stream') observeText(decoder.decode(value, { stream: true }))
            controller.enqueue(value)
          }
        } catch (error) {
          transportError = error
          reader.releaseLock(); controller.error(error)
        }
      },
      async cancel(reason) { try { await reader.cancel(reason) } finally { reader.releaseLock() } },
    }, { highWaterMark: 0 })
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers })
  }) as typeof fetch

  return {
    fetch: fetchWithDiagnostics,
    async *observeParsed(stream: AsyncIterable<ChatCompletionChunk>) {
      try {
        for await (const chunk of stream) {
          summary.parsedChunks!++
          if (chunk.choices?.[0]?.finish_reason) summary.parsedFinishSeen = true
          yield chunk
        }
        parsedEnded = true
      } catch (error) { sdkFailed = true; throw error }
    },
    finish(outcome: NonNullable<NativeDiagnostic['outcome']>, error?: unknown) {
      if (finished) return
      finished = true
      summary.outcome = outcome
      summary.delayMs = Math.round(performance.now() - started)
      if (outcome === 'failed') {
        Object.assign(summary, nativeErrorMetadata(transportError ?? error))
        summary.streamFailure = transportError ? 'transport'
          : summary.status && summary.status >= 400 ? 'http'
          : upstreamError ? 'upstream_error'
          : summary.invalidFrames ? 'invalid_sse'
          : summary.parsedFinishSeen ? 'adapter'
          : summary.wireFinishSeen ? (parsedEnded || sdkFailed ? 'sdk_parse' : 'adapter')
          : summary.eofSeen && parsedEnded && summary.responseFormat === 'event_stream' && !summary.skippedFrames
            ? 'upstream_incomplete' : 'unknown'
      }
      frame = ''; line = '' // Discard even an unfinished payload before emitting metadata.
      const safe = parseNativeDiagnostic(summary)!
      try { emit(NATIVE_DIAGNOSTIC_PREFIX + JSON.stringify(safe) + '\n') } catch { /* Logging must not fail a model request. */ }
      return safe
    },
  }
}
