import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { basename, isAbsolute, join, resolve } from 'node:path'

export type BeeGamePreviewStatus =
  | 'idle'
  | 'starting'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'unsupported'

export type BeeGamePreviewSnapshot = {
  sessionId: string
  workspacePath: string
  status: BeeGamePreviewStatus
  url: string
  port?: number
  command?: string
  script?: string
  entrypoint?: string
  message?: string
  updatedAt: string
}

export type BeeGamePreviewStartOptions = {
  sessionId: string
  workspacePath: string
}

export type BeeGamePreviewProcess = {
  kill: () => void
  exited?: Promise<unknown>
}

export type BeeGamePreviewRunner = (
  command: string[],
  options: {
    cwd: string
    env: Record<string, string>
    onOutput: (text: string) => void
  },
) => BeeGamePreviewProcess

export type BeeGamePreviewPortAllocator = (start: number) => Promise<number>

export type BeeGamePreviewReadinessProbe = (url: string) => Promise<boolean>

type PreviewRecord = {
  snapshot: BeeGamePreviewSnapshot
  process?: BeeGamePreviewProcess
}

type PackageManifest = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

const DEFAULT_PREVIEW_PORT_START = 63100
const DEFAULT_HOST = '127.0.0.1'

export class BeeGamePreviewManager {
  private readonly records = new Map<string, PreviewRecord>()

  constructor(
    private readonly runner: BeeGamePreviewRunner = runPreviewProcess,
    private readonly portStart = Number.parseInt(process.env.BEEGAME_PREVIEW_PORT_START || '', 10) ||
      DEFAULT_PREVIEW_PORT_START,
    private readonly allocatePort: BeeGamePreviewPortAllocator = findAvailablePort,
    private readonly readinessProbe: BeeGamePreviewReadinessProbe = waitForPreviewReady,
  ) {}

  status(sessionId: string, workspacePath: string): BeeGamePreviewSnapshot {
    const existing = this.records.get(sessionId)
    if (existing && sameWorkspace(existing.snapshot.workspacePath, workspacePath)) {
      return { ...existing.snapshot }
    }
    return this.createSnapshot(sessionId, workspacePath, 'idle', {
      message: 'Preview has not been started',
    })
  }

  async start(options: BeeGamePreviewStartOptions): Promise<BeeGamePreviewSnapshot> {
    const workspacePath = normalizeWorkspacePath(options.workspacePath)
    const existing = this.records.get(options.sessionId)
    if (
      existing &&
      sameWorkspace(existing.snapshot.workspacePath, workspacePath) &&
      existing.snapshot.status === 'running'
    ) {
      return { ...existing.snapshot }
    }

    this.stop(options.sessionId, workspacePath)

    const plan = await createPreviewPlan(
      workspacePath,
      this.portStart,
      this.allocatePort,
    )
    if (!plan.supported) {
      const snapshot = this.createSnapshot(options.sessionId, workspacePath, 'unsupported', {
        message: plan.message,
      })
      this.records.set(options.sessionId, { snapshot })
      return snapshot
    }

    const startedAt = new Date().toISOString()
    const snapshot = this.createSnapshot(options.sessionId, workspacePath, 'starting', {
      url: '',
      port: plan.port,
      command: plan.command.join(' '),
      script: plan.script,
      entrypoint: basename(join(workspacePath, 'package.json')),
      message: `Preview starting at ${plan.url}`,
      updatedAt: startedAt,
    })
    const process = this.runner(plan.command, {
      cwd: workspacePath,
      env: {
        ...processEnv(),
        BEEGAME_PREVIEW_PORT: String(plan.port),
        PORT: String(plan.port),
        VITE_PORT: String(plan.port),
        HOST: DEFAULT_HOST,
      },
      onOutput: text => {
        const record = this.records.get(options.sessionId)
        if (!record) return
        const url = extractPreviewUrl(text) || record.snapshot.url
        record.snapshot = {
          ...record.snapshot,
          url,
          status: record.snapshot.status === 'running' ? 'running' : 'starting',
          message: text.trim().slice(0, 500) || record.snapshot.message,
          updatedAt: new Date().toISOString(),
        }
      },
    })
    this.records.set(options.sessionId, { snapshot, process })
    process.exited?.then(() => {
      const record = this.records.get(options.sessionId)
      if (!record || record.process !== process) return
      record.snapshot = {
        ...record.snapshot,
        status: 'stopped',
        message: 'Preview process exited',
        updatedAt: new Date().toISOString(),
      }
      delete record.process
    }).catch(error => {
      const record = this.records.get(options.sessionId)
      if (!record || record.process !== process) return
      record.snapshot = {
        ...record.snapshot,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        updatedAt: new Date().toISOString(),
      }
      delete record.process
    })
    const ready = await this.readinessProbe(plan.url)
    const record = this.records.get(options.sessionId)
    if (!record || record.process !== process) return { ...snapshot }
    if (!ready) {
      process.kill()
      delete record.process
      record.snapshot = {
        ...record.snapshot,
        status: 'failed',
        url: '',
        message: `Preview process started but ${plan.url} did not become reachable. ${record.snapshot.message || ''}`.trim(),
        updatedAt: new Date().toISOString(),
      }
      return { ...record.snapshot }
    }
    record.snapshot = {
      ...record.snapshot,
      status: 'running',
      url: plan.url,
      message: `Preview running at ${plan.url}`,
      updatedAt: new Date().toISOString(),
    }
    return { ...record.snapshot }
  }

  async restart(options: BeeGamePreviewStartOptions): Promise<BeeGamePreviewSnapshot> {
    this.stop(options.sessionId, options.workspacePath)
    return this.start(options)
  }

  stop(sessionId: string, workspacePath?: string): BeeGamePreviewSnapshot {
    const record = this.records.get(sessionId)
    const resolvedWorkspace = workspacePath ? normalizeWorkspacePath(workspacePath) : undefined
    if (!record) {
      return this.createSnapshot(sessionId, resolvedWorkspace || '', 'stopped', {
        message: 'Preview is not running',
      })
    }
    if (resolvedWorkspace && !sameWorkspace(record.snapshot.workspacePath, resolvedWorkspace)) {
      return { ...record.snapshot }
    }
    record.process?.kill()
    delete record.process
    record.snapshot = {
      ...record.snapshot,
      status: 'stopped',
      message: 'Preview stopped',
      updatedAt: new Date().toISOString(),
    }
    return { ...record.snapshot }
  }

  private createSnapshot(
    sessionId: string,
    workspacePath: string,
    status: BeeGamePreviewStatus,
    fields: Partial<BeeGamePreviewSnapshot> = {},
  ): BeeGamePreviewSnapshot {
    return {
      sessionId,
      workspacePath,
      status,
      url: '',
      updatedAt: new Date().toISOString(),
      ...fields,
    }
  }
}

async function createPreviewPlan(
  workspacePath: string,
  portStart: number,
  allocatePort: BeeGamePreviewPortAllocator,
): Promise<
  | { supported: false; message: string }
  | {
      supported: true
      port: number
      url: string
      command: string[]
      script: string
    }
> {
  const manifestPath = join(workspacePath, 'package.json')
  if (!existsSync(manifestPath)) {
    return {
      supported: false,
      message: 'Preview host did not find a package.json entrypoint for an embeddable web preview',
    }
  }
  const manifest = readPackageManifest(manifestPath)
  const scripts = manifest.scripts || {}
  const script = ['preview', 'dev', 'start'].find(name => typeof scripts[name] === 'string' && scripts[name].trim())
  if (!script) {
    return {
      supported: false,
      message: 'Preview host did not find a preview, dev, or start script',
    }
  }
  const port = await allocatePort(portStart)
  const command = buildRunCommand(workspacePath, manifest, script, port)
  return {
    supported: true,
    port,
    url: `http://${DEFAULT_HOST}:${port}/`,
    command,
    script,
  }
}

function readPackageManifest(path: string): PackageManifest {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as PackageManifest
      : {}
  } catch {
    return {}
  }
}

function buildRunCommand(
  workspacePath: string,
  manifest: PackageManifest,
  script: string,
  port: number,
): string[] {
  const manager = detectPackageManager(workspacePath)
  const base = manager === 'npm'
    ? ['npm', 'run', script]
    : [manager, 'run', script]
  return usesVite(manifest, script) ? [...base, '--', '--host', DEFAULT_HOST, '--port', String(port)] : base
}

function detectPackageManager(workspacePath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(workspacePath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(workspacePath, 'bun.lockb')) || existsSync(join(workspacePath, 'bun.lock'))) return 'bun'
  return 'npm'
}

function usesVite(manifest: PackageManifest, script: string): boolean {
  const scriptCommand = manifest.scripts?.[script] || ''
  return /\bvite\b/.test(scriptCommand) ||
    Boolean(manifest.dependencies?.vite || manifest.devDependencies?.vite)
}

function runPreviewProcess(
  command: string[],
  options: {
    cwd: string
    env: Record<string, string>
    onOutput: (text: string) => void
  },
): BeeGamePreviewProcess {
  const proc = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  void streamOutput(proc.stdout, options.onOutput)
  void streamOutput(proc.stderr, options.onOutput)
  return {
    kill: () => proc.kill(),
    exited: proc.exited,
  }
}

async function streamOutput(
  stream: ReadableStream<Uint8Array> | null,
  onOutput: (text: string) => void,
): Promise<void> {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      onOutput(decoder.decode(chunk.value, { stream: true }))
    }
  } finally {
    reader.releaseLock()
  }
}

function extractPreviewUrl(text: string): string {
  const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?\/?[^\s)]*/i)
  return match?.[0] || ''
}

function normalizeWorkspacePath(path: string): string {
  if (!path || !isAbsolute(path)) throw new Error('Workspace path must be absolute')
  return resolve(path)
}

function sameWorkspace(a: string, b: string): boolean {
  return resolve(a) === resolve(b)
}

function processEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return env
}

function findAvailablePort(start: number): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const tryPort = (port: number) => {
      if (port >= 65536) {
        reject(new Error(`No available preview port found at or above ${start}`))
        return
      }
      const server = createServer()
      server.once('error', () => {
        server.close()
        tryPort(port + 1)
      })
      server.once('listening', () => {
        server.close(error => {
          if (error) reject(error)
          else resolvePort(port)
        })
      })
      server.listen(port, DEFAULT_HOST)
    }
    tryPort(start)
  })
}

async function waitForPreviewReady(url: string): Promise<boolean> {
  const deadline = Date.now() + getPreviewReadyTimeoutMs()
  while (Date.now() < deadline) {
    if (await canReachPreview(url)) return true
    await sleep(getPreviewReadyPollMs())
  }
  return false
}

async function canReachPreview(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: 'GET' })
    return response.status < 500
  } catch {
    return false
  }
}

function getPreviewReadyTimeoutMs(): number {
  const raw = Number(process.env.BEEGAME_PREVIEW_READY_TIMEOUT_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 15_000
}

function getPreviewReadyPollMs(): number {
  const raw = Number(process.env.BEEGAME_PREVIEW_READY_POLL_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 250
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms))
}
