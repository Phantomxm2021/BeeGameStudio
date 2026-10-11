import type { Subprocess } from 'bun'
import { randomUUID } from 'node:crypto'

/** Perform the existing SDK handshake, without consuming the session's output. */
export async function initializeSSHProcess(
  proc: Subprocess,
  timeoutMs = 30_000,
  signal?: AbortSignal,
): Promise<Subprocess> {
  const stdout = proc.stdout as ReadableStream<Uint8Array> | null
  const stdin = proc.stdin
  if (!stdout || !stdin || typeof stdin === 'number') {
    proc.kill()
    throw new Error('CLI handshake requires piped stdin and stdout')
  }
  const requestId = randomUUID()
  const reader = stdout.getReader()
  const buffered: Uint8Array[] = []
  const decoder = new TextDecoder()
  let pending = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  try {
    signal?.throwIfAborted()
    const sink = stdin as unknown as { write(data: Uint8Array): number; flush?(): void }
    sink.write(new TextEncoder().encode(JSON.stringify({
      type: 'control_request', request_id: requestId, request: { subtype: 'initialize' },
    }) + '\n'))
    sink.flush?.()
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('CLI initialize handshake timed out')), timeoutMs)
    })
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal?.reason ?? new DOMException('SSH initialization cancelled', 'AbortError'))
      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) onAbort()
    })
    let initialized = false
    while (!initialized) {
      const { done, value } = await Promise.race([reader.read(), timeout, aborted])
      if (done) throw new Error('CLI exited before completing the initialize handshake')
      buffered.push(value)
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        let message
        try { message = JSON.parse(line) } catch { continue }
        if (message?.type !== 'control_response' || message.response?.request_id !== requestId) continue
        if (message.response.subtype !== 'success') {
          throw new Error(`CLI initialize failed: ${message.response.error ?? 'unknown error'}`)
        }
        initialized = true
      }
    }
  } catch (error) {
    try { proc.kill(signal?.aborted ? 'SIGKILL' : 'SIGTERM') } catch { /* Already exited. */ }
    await reader.cancel().catch(() => {})
    reader.releaseLock()
    throw error
  } finally {
    clearTimeout(timer)
    if (onAbort) signal?.removeEventListener('abort', onAbort)
  }

  // Replay complete byte chunks, including unrelated messages and partial lines.
  // The session manager remains the sole parser of SDK session messages.
  const replay = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of buffered) controller.enqueue(chunk)
    },
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) { reader.releaseLock(); controller.close() }
        else controller.enqueue(value)
      } catch (error) { reader.releaseLock(); controller.error(error) }
    },
    async cancel(reason) {
      try { await reader.cancel(reason) } finally { reader.releaseLock() }
    },
  })
  return new Proxy(proc, {
    get(target, property) {
      if (property === 'stdout') return replay
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}
