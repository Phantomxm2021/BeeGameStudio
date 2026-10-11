import type { Subprocess } from 'bun'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlPermissionRequest,
  StdoutMessage,
} from '../entrypoints/sdk/controlTypes.js'
import type { PermissionUpdate } from '../types/permissions.js'
import { logForDebugging } from '../utils/debug.js'
import { jsonParse, jsonStringify } from '../utils/slowOperations.js'
import type { RemoteMessageContent } from '../utils/teleport/api.js'

export interface SSHSessionManagerOptions {
  onMessage: (sdkMessage: SDKMessage) => void
  onPermissionRequest: (
    request: SSHPermissionRequest,
    requestId: string,
  ) => void
  onConnected: () => void
  onReconnecting: (attempt: number, max: number) => void
  onDisconnected: () => void
  onError: (error: Error) => void
  reconnect?: (sessionId?: string, signal?: AbortSignal) => Promise<Subprocess>
  maxReconnectAttempts?: number
}

export interface SSHPermissionRequest {
  tool_name: string
  tool_use_id: string
  description?: string
  permission_suggestions?: PermissionUpdate[]
  blocked_path?: string
  input: { [key: string]: unknown }
}

export interface SSHSessionManager {
  connect(): void
  disconnect(): void
  sendMessage(content: RemoteMessageContent): Promise<boolean>
  sendInterrupt(): void
  respondToPermissionRequest(
    requestId: string,
    response: { behavior: string; message?: string; updatedInput?: unknown },
  ): boolean
}

function isStdoutMessage(value: unknown): value is StdoutMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as Record<string, unknown>).type === 'string'
  )
}

const BASE_RECONNECT_DELAY_MS = 2_000
const MAX_RECONNECT_DELAY_MS = 15_000
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3

export class SSHSessionManagerImpl implements SSHSessionManager {
  private proc: Subprocess
  private options: SSHSessionManagerOptions
  private connected = false
  private disconnected = false
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private sessionId: string | undefined
  private reconnectAttempt = 0
  private readonly maxReconnectAttempts: number
  private userInitiatedDisconnect = false
  private reconnecting = false
  private reconnectController: AbortController | undefined
  private pendingPermissions = new Set<string>()

  constructor(proc: Subprocess, options: SSHSessionManagerOptions) {
    this.proc = proc
    this.options = options
    this.maxReconnectAttempts =
      options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
  }

  connect(): void {
    if (this.connected || this.disconnected || this.reconnecting) return

    this.startReadLoop()
    this.monitorExit()

    this.connected = true
    this.options.onConnected()
  }

  private async startReadLoop(): Promise<void> {
    const proc = this.proc
    const stdout = proc.stdout
    if (!stdout) {
      this.options.onError(new Error('SSH process stdout is not available'))
      return
    }

    const reader = (stdout as ReadableStream<Uint8Array>).getReader()
    this.reader = reader
    const decoder = new TextDecoder()
    let lineBuffer = ''

    try {
      while (!this.disconnected && proc === this.proc) {
        const { done, value } = await reader.read()
        if (this.disconnected || proc !== this.proc) break
        if (done) break

        lineBuffer += decoder.decode(value, { stream: true })
        const lines = lineBuffer.split('\n')
        lineBuffer = lines.pop() ?? ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          this.processLine(trimmed)
        }
      }
    } catch (err) {
      if (!this.disconnected && proc === this.proc) {
        this.options.onError(
          err instanceof Error ? err : new Error(String(err)),
        )
      }
    } finally {
      reader.releaseLock()
      if (this.reader === reader) this.reader = null
      if (!this.disconnected && !this.userInitiatedDisconnect) {
        void this.handleProcessExit(proc)
      }
    }
  }

  private monitorExit(): void {
    const proc = this.proc
    if (proc.exitCode !== null) {
      if (!this.userInitiatedDisconnect) {
        void this.handleProcessExit(proc)
      }
      return
    }
    proc.exited
      .then(() => {
        if (!this.disconnected && !this.userInitiatedDisconnect) {
          void this.handleProcessExit(proc)
        }
      })
      .catch(() => {
        if (!this.disconnected && !this.userInitiatedDisconnect) {
          void this.handleProcessExit(proc)
        }
      })
  }

  private async handleProcessExit(proc: Subprocess): Promise<void> {
    if (proc !== this.proc || this.disconnected || this.reconnecting) return
    this.connected = false
    this.pendingPermissions.clear()
    // EOF can precede process exit. Retire this process before replacing it.
    try { proc.kill() } catch { /* already exited */ }

    if (!this.options.reconnect) {
      this.disconnected = true
      this.options.onDisconnected()
      return
    }

    if (this.reconnectAttempt >= this.maxReconnectAttempts) {
      this.disconnected = true
      this.options.onDisconnected()
      return
    }

    this.reconnecting = true
    try {
      await this.attemptReconnect()
    } finally {
      // A replacement may already be reconnecting after its own EOF.
      if (this.proc === proc) this.reconnecting = false
    }
  }

  private async attemptReconnect(): Promise<void> {
    const reconnect = this.options.reconnect!

    while (this.reconnectAttempt < this.maxReconnectAttempts) {
      this.reconnectAttempt++
      this.options.onReconnecting(
        this.reconnectAttempt,
        this.maxReconnectAttempts,
      )

      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** (this.reconnectAttempt - 1),
        MAX_RECONNECT_DELAY_MS,
      )
      await new Promise<void>(r => setTimeout(r, delay))

      if (this.userInitiatedDisconnect) return

      const controller = new AbortController()
      this.reconnectController = controller
      try {
        const newProc = await reconnect(this.sessionId, controller.signal)
        if (this.disconnected || this.userInitiatedDisconnect) {
          try { newProc.kill() } catch { /* already exited */ }
          if (newProc.stdout && typeof newProc.stdout !== 'number') {
            await newProc.stdout.cancel().catch(() => {})
          }
          return
        }
        if (newProc.exitCode !== null || newProc.signalCode !== null) {
          try { newProc.kill() } catch { /* already exited */ }
          throw new Error(`Replacement SSH process exited (${newProc.exitCode ?? newProc.signalCode})`)
        }
        this.proc = newProc
        this.reconnectAttempt = 0
        this.connected = true
        this.reconnecting = false
        this.startReadLoop()
        this.monitorExit()
        this.options.onConnected()
        return
      } catch (err) {
        if (this.disconnected || this.userInitiatedDisconnect) return
        const error = new Error(
          `SSH reconnect attempt ${this.reconnectAttempt} failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        logForDebugging(
          `[SSH] ${error.message}`,
        )
        this.options.onError(error)
      } finally {
        if (this.reconnectController === controller) this.reconnectController = undefined
      }
    }

    this.disconnected = true
    this.options.onDisconnected()
  }

  private processLine(line: string): void {
    let raw: unknown
    try {
      raw = jsonParse(line)
    } catch {
      return
    }

    if (!isStdoutMessage(raw)) return
    const parsed = raw

    if (parsed.type === 'system' && (parsed as Record<string, unknown>).subtype === 'init') {
      const id = (parsed as Record<string, unknown>).session_id
      if (typeof id === 'string' && id) this.sessionId = id
    }

    if (parsed.type === 'control_request') {
      const request = parsed as unknown as {
        request_id: string
        request: SDKControlPermissionRequest & { subtype: string }
      }
      if (request.request.subtype === 'can_use_tool') {
        this.pendingPermissions.add(request.request_id)
        this.options.onPermissionRequest(
          request.request as unknown as SSHPermissionRequest,
          request.request_id,
        )
      } else {
        logForDebugging(
          `[SSH] Unsupported control request subtype: ${request.request.subtype}`,
        )
        this.sendErrorResponse(
          request.request_id,
          `Unsupported control request subtype: ${request.request.subtype}`,
        )
      }
      return
    }

    if (
      parsed.type !== 'control_response' &&
      parsed.type !== 'keep_alive' &&
      parsed.type !== 'control_cancel_request' &&
      parsed.type !== 'streamlined_text' &&
      parsed.type !== 'streamlined_tool_use_summary' &&
      !(
        parsed.type === 'system' &&
        (parsed as Record<string, unknown>).subtype === 'post_turn_summary'
      )
    ) {
      this.options.onMessage(parsed as SDKMessage)
    }
  }

  private writeToStdin(data: string): boolean {
    try {
      if (!this.connected || this.reconnecting || this.proc.exitCode !== null || this.proc.signalCode !== null) return false
      const stdin = this.proc.stdin
      if (!stdin || typeof stdin === 'number' || this.disconnected) return false
      const encoded = new TextEncoder().encode(data + '\n')
      const written = (stdin as unknown as { write(d: Uint8Array): number }).write(encoded)
      if (written !== encoded.length) {
        this.options.onError(new Error('SSH process did not accept the complete message'))
        // Retire a pipe containing an incomplete JSON frame; do not append a
        // subsequent message or silently retry a possibly delivered action.
        void this.handleProcessExit(this.proc)
        return false
      }
      ;(stdin as unknown as { flush?(): void }).flush?.()
      return true
    } catch {
      if (this.connected && !this.disconnected) {
        this.options.onError(new Error('SSH process pipe is not writable'))
        void this.handleProcessExit(this.proc)
      }
      return false
    }
  }

  async sendMessage(content: RemoteMessageContent): Promise<boolean> {
    const message = jsonStringify({
      type: 'user',
      message: {
        role: 'user',
        content,
      },
      parent_tool_use_id: null,
      session_id: '',
    })
    return this.writeToStdin(message)
  }

  sendInterrupt(): void {
    const request = jsonStringify({
      type: 'control_request',
      request_id: crypto.randomUUID(),
      request: {
        subtype: 'interrupt',
      },
    })
    this.writeToStdin(request)
  }

  respondToPermissionRequest(
    requestId: string,
    response: { behavior: string; message?: string; updatedInput?: unknown },
  ): boolean {
    if (!this.pendingPermissions.has(requestId)) return false
    const msg = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: {
          behavior: response.behavior,
          ...(response.behavior === 'allow'
            ? { updatedInput: response.updatedInput }
            : { message: response.message }),
        },
      },
    })
    const sent = this.writeToStdin(msg)
    if (sent) this.pendingPermissions.delete(requestId)
    return sent
  }

  private sendErrorResponse(requestId: string, error: string): void {
    const response = jsonStringify({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error,
      },
    })
    this.writeToStdin(response)
  }

  disconnect(): void {
    if (this.disconnected) return
    this.userInitiatedDisconnect = true
    this.disconnected = true
    this.connected = false
    this.pendingPermissions.clear()
    this.reconnectController?.abort()
    void this.reader?.cancel().catch(() => {})

    try {
      const stdin = this.proc.stdin
      if (stdin && typeof stdin !== 'number') {
        ;(stdin as unknown as { end?(): void }).end?.()
      }
    } catch {
      // stdin may already be closed
    }

    try {
      this.proc.kill()
    } catch {
      // process may already be dead
    }
  }

  isConnected(): boolean {
    return this.connected && !this.disconnected
  }
}
