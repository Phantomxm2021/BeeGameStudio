import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { statSync } from 'node:fs'
import { basename } from 'node:path'
import type { BgsStableMethod, BgsStableParams, BgsStableResult } from './native-protocol'

export function bgsCommand(env: Record<string, string | undefined> = process.env): string[] {
  // Model/session environments omit operator-only executable configuration.
  const executable = process.env.BEEGAME_BGS_PATH || env.BEEGAME_BGS_PATH
  // A missing branded build must fail, never silently run the official package.
  return [executable || fileURLToPath(new URL(
    `../../../../dist/bgs-runtime/${process.platform === 'win32' ? 'bgs.exe' : 'bgs'}`, import.meta.url))]
}

export type RpcObject = Record<string, any>
/** Safe local-process diagnostics; never includes raw stderr, argv or provider bodies. */
export type BgsErrorInfo = {
  phase: 'spawn' | 'stdin' | 'protocol' | 'request' | 'exit' | 'close'
  method?: string
  code?: string
  rpcCode?: number
  executable?: string
  cwd?: { kind: 'directory' | 'missing' | 'not-directory' | 'unavailable' }
  exitCode?: number | null
  signal?: NodeJS.Signals | null
  timeoutMs?: number
}

export class BgsClientError extends Error {
  constructor(message: string, readonly bgsErrorInfo: BgsErrorInfo) {
    super(message)
    this.name = 'BgsClientError'
  }
}
export type BgsClientOptions = {
  command?: readonly string[]
  cwd: string
  env: Record<string, string>
  config?: Record<string, unknown>
  onNotification?(method: string, params: RpcObject): void | Promise<void>
  onRequest?(method: string, params: RpcObject, requestId: string | number, signal: AbortSignal): unknown | Promise<unknown>
  onExit?(error: Error): void
}

function safeCwd(cwd: string): BgsErrorInfo['cwd'] {
  try { return { kind: statSync(cwd).isDirectory() ? 'directory' : 'not-directory' } }
  catch (error) {
    return { kind: (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
}

/** One private stdio connection per owner/session. Protocol requests never use
 * a shell and credentials never enter argv, diagnostics, or a project file. */
export class BgsClient {
  private nextId = 0
  private pending = new Map<number, { method: string; resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private inboundRequests = new Map<string | number, { params: RpcObject; controller: AbortController }>()
  private child: ChildProcessWithoutNullStreams
  private notifications = Promise.resolve()
  private exitError?: Error
  private closing?: Promise<void>
  private executable = 'bgs'
  private started: Promise<void>
  readonly closed: Promise<void>
  get connected(): boolean { return !this.exitError }

  private diagnostic(phase: BgsErrorInfo['phase'], extra: Omit<BgsErrorInfo, 'phase' | 'executable' | 'cwd'> = {}): BgsErrorInfo {
    return { phase, executable: this.executable, cwd: safeCwd(this.options.cwd), ...extra }
  }

  private constructor(private options: BgsClientOptions) {
    const command = options.command ?? bgsCommand(options.env)
    if (!command.length) throw Error('BGS executable is required')
    this.executable = basename(command[0] || 'bgs')
    let resolveStarted!: () => void
    let rejectStarted!: (error: Error) => void
    this.started = new Promise<void>((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject })
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(command[0]!, [...command.slice(1), 'app-server', '--listen', 'stdio://',
        ...Object.entries(options.config ?? {}).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`])], {
        cwd: options.cwd, env: options.env, stdio: 'pipe', detached: process.platform !== 'win32',
      })
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const diagnostic = this.diagnostic('spawn', { code })
      throw new BgsClientError('Could not start BGS; install the configured BGS CLI', diagnostic)
    }
    this.child = child
    child.once('spawn', resolveStarted)
    // stderr can contain upstream response bodies. Consume it without publishing
    // credentials, prompts or arbitrary provider errors to the product logs.
    this.child.stderr.resume()
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      try { this.receive(JSON.parse(line)) }
      catch {
        this.fail(new BgsClientError('BGS returned an invalid protocol message', this.diagnostic('protocol')))
        void this.close()
      }
    })
    this.child.on('error', (error: NodeJS.ErrnoException) => {
      const diagnostic = this.diagnostic('spawn', { code: error.code })
      const failure = new BgsClientError('Could not start BGS; install the configured BGS CLI', diagnostic)
      rejectStarted(failure)
      this.fail(failure)
    })
    this.child.stdin.on('error', (error: NodeJS.ErrnoException) => this.fail(new BgsClientError(
      'BGS connection closed while sending a request', this.diagnostic('stdin', { code: error.code }),
    )))
    this.closed = new Promise(resolve => {
      this.child.once('close', async (exitCode, signal) => {
        for (const request of this.inboundRequests.values()) request.controller.abort()
        this.inboundRequests.clear()
        const failure = new BgsClientError('BGS app-server exited', this.diagnostic('exit', { exitCode, signal }))
        rejectStarted(failure)
        await this.notifications
        this.fail(failure)
        resolve()
      })
    })
  }

  static async connect(options: BgsClientOptions): Promise<BgsClient> {
    let client: BgsClient | undefined
    try {
      client = new BgsClient(options)
      await client.started
      await client.request('initialize', { clientInfo: { name: 'bee_game_studio', title: 'BeeGameStudio', version: '2.8.4' },
        capabilities: { experimentalApi: true } })
      client.notify('initialized', {})
      return client
    } catch (error) { await client?.close(); throw error }
  }

  request<T = RpcObject>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.exitError) return Promise.reject(this.exitError)
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new BgsClientError(`BGS ${method} did not acknowledge the request`,
          this.diagnostic('request', { method, timeoutMs })))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { method, resolve, reject, timer })
      try { this.write({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  /**
   * Use the generated stable app-server payloads for callers that do not rely
   * on experimental fields. Experimental and fixture methods intentionally
   * remain available through request().
   */
  requestNative<M extends BgsStableMethod>(
    method: M,
    params: BgsStableParams<M>,
    timeoutMs = 30_000,
  ): Promise<BgsStableResult<M>> {
    return this.request<BgsStableResult<M>>(method, params, timeoutMs)
  }

  notify(method: string, params: unknown): void { this.write({ method, params }) }

  /** Drain received events only from outside their ordered handler. */
  async drainNotifications(): Promise<void> {
    await this.notifications
    if (this.exitError) throw this.exitError
  }

  /** Cancel only requests belonging to the native thread/turn that ended. */
  cancelServerRequests(threadId: string, turnId?: string): void {
    for (const [id, request] of this.inboundRequests) {
      if (request.params.threadId === threadId && (!turnId || !request.params.turnId || request.params.turnId === turnId)) {
        this.inboundRequests.delete(id)
        request.controller.abort()
      }
    }
  }

  private write(message: unknown): void {
    if (this.exitError) throw this.exitError
    if (this.child.stdin.destroyed) {
      const method = typeof message === 'object' && message !== null && 'method' in message && typeof message.method === 'string'
        ? message.method : undefined
      throw new BgsClientError('BGS connection is closed', this.diagnostic('stdin', { method }))
    }
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  private receive(message: RpcObject): void {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid RPC envelope')
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        const id = message.id
        if ((typeof id !== 'string' && typeof id !== 'number') || this.inboundRequests.has(id))
          throw Error('Invalid server request identity')
        // Register at intake: a cancellation may arrive before the ordered
        // notification backlog lets the permission handler start.
        const request = { params: message.params ?? {}, controller: new AbortController() }
        this.inboundRequests.set(id, request)
        const signal = request.controller.signal
        const precedingNotifications = this.notifications
        void precedingNotifications.then(() => {
          if (this.exitError || signal.aborted) return
          if (!this.options.onRequest) throw Error('Unsupported server request')
          return this.options.onRequest(message.method, request.params, id, signal)
        }).then(result => {
          if (!this.exitError && !signal.aborted) this.write({ id, result })
        }, () => {
          if (!this.exitError && !signal.aborted)
            this.write({ id, error: { code: -32603, message: 'BGS could not complete this request' } })
        }).catch(() => {}).finally(() => {
          if (this.inboundRequests.get(id) === request) this.inboundRequests.delete(id)
        })
      } else {
        const params = message.params ?? {}
        if (message.method === 'serverRequest/resolved') {
          const request = this.inboundRequests.get(params.requestId)
          if (request && request.params.threadId === params.threadId) {
            this.inboundRequests.delete(params.requestId)
            request.controller.abort()
          }
        } else if (typeof params.threadId === 'string') {
          const turnId = params.turnId ?? params.turn?.id
          if (message.method === 'turn/completed') this.cancelServerRequests(params.threadId, turnId)
          else if (message.method === 'turn/started') {
            for (const [id, request] of this.inboundRequests) {
              if (request.params.threadId === params.threadId && request.params.turnId !== turnId) {
                this.inboundRequests.delete(id)
                request.controller.abort()
              }
            }
          }
        }
        this.notifications = this.notifications.then(() => this.options.onNotification?.(message.method, params))
          .catch(() => {
            this.fail(new BgsClientError('BGS could not consume a BGS event', this.diagnostic('protocol')))
            void this.close()
          })
      }
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id); clearTimeout(pending.timer)
    // Raw provider messages may contain secrets. Preserve method-level failure
    // through the caller, without forwarding an arbitrary JSON-RPC error body.
    if (message.error) {
      const rpcCode = Number(message.error.code)
      pending.reject(new BgsClientError(`BGS ${pending.method} rejected (code ${rpcCode || 'unknown'})`,
        this.diagnostic('request', { method: pending.method, ...(Number.isFinite(rpcCode) ? { rpcCode } : {}),
          ...(pending.method === 'thread/resume' && rpcCode === -32600 &&
            /^no rollout found for thread id [0-9a-f-]{36}$/.test(message.error.message ?? '')
            ? { code: 'native-history-missing' } : {}) })))
    }
    else pending.resolve(message.result)
  }

  private fail(error: Error): void {
    if (this.exitError) return
    this.exitError = error
    for (const request of this.inboundRequests.values()) request.controller.abort()
    this.inboundRequests.clear()
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.options.onExit?.(error)
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(new BgsClientError('BGS connection closed', this.diagnostic('close')))
      const stop = (signal: NodeJS.Signals) => {
        if (process.platform === 'win32' && (this.child.exitCode !== null || this.child.signalCode !== null)) return
        try {
          if (process.platform === 'win32') this.child.kill(signal)
          else if (this.child.pid) process.kill(-this.child.pid, signal)
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      if (process.platform === 'win32' && this.child.pid && this.child.exitCode === null) {
        await new Promise<void>((resolve, reject) => execFile('taskkill', ['/PID', String(this.child.pid), '/T', '/F'], error => error ? reject(error) : resolve()))
      } else stop('SIGTERM')
      const timer = setTimeout(() => stop('SIGKILL'), 5000); timer.unref?.()
      try { await this.closed } finally { clearTimeout(timer); if (process.platform !== 'win32') stop('SIGKILL') }
    })()
  }
}

/** TOML inline values for Bgs's official -c override syntax. */
export function toml(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(toml).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.entries(value).map(([key, child]) => JSON.stringify(key) + '=' + toml(child)).join(',') + '}'
  throw Error('Unsupported BGS configuration value')
}
