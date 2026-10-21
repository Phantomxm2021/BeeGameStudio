import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export function bgsCommand(env: Record<string, string | undefined> = process.env): string[] {
  // Model/session environments omit operator-only executable configuration.
  const executable = process.env.BEEGAME_BGS_PATH || env.BEEGAME_BGS_PATH
  // A missing branded build must fail, never silently run the official package.
  return [executable || fileURLToPath(new URL(
    `../../../../dist/bgs-runtime/${process.platform === 'win32' ? 'bgs.exe' : 'bgs'}`, import.meta.url))]
}

export type RpcObject = Record<string, any>
export type BgsClientOptions = {
  command?: readonly string[]
  cwd: string
  env: Record<string, string>
  config?: Record<string, unknown>
  onNotification?(method: string, params: RpcObject): void | Promise<void>
  onRequest?(method: string, params: RpcObject, requestId?: string | number): unknown | Promise<unknown>
  onExit?(error: Error): void
}

/** One private stdio connection per owner/session. Protocol requests never use
 * a shell and credentials never enter argv, diagnostics, or a project file. */
export class BgsClient {
  private nextId = 0
  private pending = new Map<number, { method: string; resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>()
  private child: ChildProcessWithoutNullStreams
  private notifications = Promise.resolve()
  private exitError?: Error
  private closing?: Promise<void>
  readonly closed: Promise<void>
  get connected(): boolean { return !this.exitError }

  private constructor(private options: BgsClientOptions) {
    const command = options.command ?? bgsCommand(options.env)
    if (!command.length) throw Error('BGS executable is required')
    this.child = spawn(command[0]!, [...command.slice(1), 'app-server', '--listen', 'stdio://',
      ...Object.entries(options.config ?? {}).flatMap(([key, value]) => ['-c', `${key}=${toml(value)}`])], {
      cwd: options.cwd, env: options.env, stdio: 'pipe', detached: process.platform !== 'win32',
    })
    // stderr can contain upstream response bodies. Consume it without publishing
    // credentials, prompts or arbitrary provider errors to the product logs.
    this.child.stderr.resume()
    const lines = createInterface({ input: this.child.stdout, crlfDelay: Infinity })
    lines.on('line', line => {
      try { this.receive(JSON.parse(line)) }
      catch { this.fail(Error('BGS returned an invalid protocol message')); void this.close() }
    })
    this.child.on('error', () => this.fail(Error('Could not start BGS; install the configured BGS CLI')))
    this.child.stdin.on('error', () => this.fail(Error('BGS connection closed while sending a request')))
    this.closed = new Promise(resolve => {
      this.child.once('close', async () => {
        await this.notifications
        this.fail(Error('BGS app-server exited'))
        resolve()
      })
    })
  }

  static async connect(options: BgsClientOptions): Promise<BgsClient> {
    const client = new BgsClient(options)
    try {
      await client.request('initialize', { clientInfo: { name: 'bee_game_studio', title: 'BeeGameStudio', version: '2.8.4' },
        capabilities: { experimentalApi: true } })
      client.notify('initialized', {})
      return client
    } catch (error) { await client.close(); throw error }
  }

  request<T = RpcObject>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.exitError) return Promise.reject(this.exitError)
    const id = ++this.nextId
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(Error(`BGS ${method} did not acknowledge the request`))
      }, timeoutMs)
      timer.unref?.()
      this.pending.set(id, { method, resolve, reject, timer })
      try { this.write({ id, method, params }) }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error) }
    })
  }

  notify(method: string, params: unknown): void { this.write({ method, params }) }

  private write(message: unknown): void {
    if (this.exitError || this.child.stdin.destroyed) throw this.exitError ?? Error('BGS connection is closed')
    this.child.stdin.write(JSON.stringify(message) + '\n')
  }

  private receive(message: RpcObject): void {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw Error('Invalid RPC envelope')
    if (typeof message.method === 'string') {
      if (message.id !== undefined) {
        const id = message.id
        // Approval/UI requests must not block turn completion or cancellation.
        void Promise.resolve().then(() => {
          if (!this.options.onRequest) throw Error('Unsupported server request')
          return this.options.onRequest(message.method, message.params ?? {}, message.id)
        }).then(result => {
          if (!this.exitError) this.write({ id, result })
        }, () => {
          if (!this.exitError) this.write({ id, error: { code: -32603, message: 'BGS could not complete this request' } })
        }).catch(() => {})
      } else {
        this.notifications = this.notifications.then(() => this.options.onNotification?.(message.method, message.params ?? {}))
          .catch(() => { this.fail(Error('BGS could not consume a BGS event')); void this.close() })
      }
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id); clearTimeout(pending.timer)
    // Raw provider messages may contain secrets. Preserve method-level failure
    // through the caller, without forwarding an arbitrary JSON-RPC error body.
    if (message.error) pending.reject(Error(`BGS ${pending.method} rejected (code ${Number(message.error.code) || 'unknown'})`))
    else pending.resolve(message.result)
  }

  private fail(error: Error): void {
    if (this.exitError) return
    this.exitError = error
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error) }
    this.pending.clear()
    this.options.onExit?.(error)
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(Error('BGS connection closed'))
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
