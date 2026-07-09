import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { isAbsolute, join, resolve } from 'node:path'

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
  kind: 'web'
  engine: 'web'
  generation: number
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
  internalUrl?: string
  expectsPublicPath?: boolean
  processes?: BeeGamePreviewProcess[]
}

type PackageManifest = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type PreviewProcessPlan = {
  role: 'client' | 'server'
  cwd: string
  port: number
  command: string[]
  script: string
  entrypoint: string
  url?: string
}

type SupportedPreviewPlan = {
  supported: true
  port: number
  url: string
  command: string[]
  script: string
  entrypoint: string
  processes: PreviewProcessPlan[]
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
    private readonly publicBaseUrl = process.env.BEEGAME_PREVIEW_PUBLIC_BASE_URL || '',
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

    const generation = (existing?.snapshot.generation ?? 0) + 1
    this.stop(options.sessionId, workspacePath)

    const publicPath = this.publicPath(options.sessionId)
    const plan = await createPreviewPlan(
      workspacePath,
      this.portStart,
      this.allocatePort,
      publicPath,
    )
    if (!plan.supported) {
      const snapshot = this.createSnapshot(options.sessionId, workspacePath, 'unsupported', {
        generation,
        message: plan.message,
      })
      this.records.set(options.sessionId, { snapshot })
      return snapshot
    }

    const startedAt = new Date().toISOString()
    const snapshot = this.createSnapshot(options.sessionId, workspacePath, 'starting', {
      generation,
      url: '',
      port: plan.port,
      command: plan.command.join(' '),
      script: plan.script,
      entrypoint: plan.entrypoint,
      message: `Preview starting at ${plan.url}`,
      updatedAt: startedAt,
    })
    const processes = plan.processes.map(processPlan => this.runner(processPlan.command, {
      cwd: processPlan.cwd,
      env: buildPreviewProcessEnv(processPlan, plan),
      onOutput: text => {
        const record = this.records.get(options.sessionId)
        if (!record) return
        const internalUrl = processPlan.role === 'client'
          ? extractPreviewUrl(text) || record.internalUrl || ''
          : record.internalUrl || ''
        if (internalUrl) record.internalUrl = internalUrl
        record.snapshot = {
          ...record.snapshot,
          url: this.publicUrl(options.sessionId, internalUrl) || record.snapshot.url,
          status: record.snapshot.status === 'running' ? 'running' : 'starting',
          message: text.trim().slice(0, 500) || record.snapshot.message,
          updatedAt: new Date().toISOString(),
        }
      },
    }))
    this.records.set(options.sessionId, {
      snapshot,
      processes,
      expectsPublicPath: plan.command.includes('--base') && plan.command.includes(publicPath),
    })
    this.watchPreviewProcesses(options.sessionId, processes, plan)
    const readiness = await checkPreviewPlanReadiness(plan, this.readinessProbe)
    const record = this.records.get(options.sessionId)
    if (!record || record.processes !== processes) return { ...snapshot }
    if (!readiness.ready) {
      for (const process of processes) process.kill()
      delete record.processes
      record.snapshot = {
        ...record.snapshot,
        status: 'failed',
        url: '',
        message: `${readiness.message} ${record.snapshot.message || ''}`.trim(),
        updatedAt: new Date().toISOString(),
      }
      return { ...record.snapshot }
    }
    record.snapshot = {
      ...record.snapshot,
      status: 'running',
      url: this.publicUrl(options.sessionId, plan.url) || plan.url,
      message: `Preview running at ${this.publicUrl(options.sessionId, plan.url) || plan.url}`,
      updatedAt: new Date().toISOString(),
    }
    record.internalUrl = plan.url
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
    for (const process of record.processes ?? []) process.kill()
    delete record.processes
    record.snapshot = {
      ...record.snapshot,
      status: 'stopped',
      message: 'Preview stopped',
      updatedAt: new Date().toISOString(),
    }
    return { ...record.snapshot }
  }

  internalUrl(sessionId: string): string | undefined {
    const record = this.records.get(sessionId)
    if (!record || record.snapshot.status !== 'running') return undefined
    return record.internalUrl
  }

  runningSnapshot(sessionId: string): BeeGamePreviewSnapshot | undefined {
    const record = this.records.get(sessionId)
    if (!record || record.snapshot.status !== 'running') return undefined
    return { ...record.snapshot }
  }

  expectsPublicPath(sessionId: string): boolean {
    const record = this.records.get(sessionId)
    return Boolean(record?.expectsPublicPath)
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
      kind: 'web',
      engine: 'web',
      generation: 0,
      status,
      url: '',
      updatedAt: new Date().toISOString(),
      ...fields,
    }
  }

  private publicUrl(sessionId: string, internalUrl: string): string {
    if (!internalUrl) return ''
    const encodedSessionId = encodeURIComponent(sessionId)
    if (!this.publicBaseUrl.trim() || isLoopbackPublicBase(this.publicBaseUrl)) {
      return `/previews/${encodedSessionId}/`
    }
    const base = this.publicBaseUrl.trim().replace(/\/+$/, '')
    return `${base}/${encodedSessionId}/`
  }

  private publicPath(sessionId: string): string {
    if (!this.publicBaseUrl.trim() || isLoopbackPublicBase(this.publicBaseUrl)) {
      return `/previews/${encodeURIComponent(sessionId)}/`
    }
    try {
      const url = new URL(this.publicUrl(sessionId, DEFAULT_HOST))
      return url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
    } catch {
      return ''
    }
  }

  private watchPreviewProcesses(
    sessionId: string,
    processes: BeeGamePreviewProcess[],
    plan: SupportedPreviewPlan,
  ): void {
    processes.forEach((process, index) => {
      const processPlan = plan.processes[index]
      void (process.exited ?? new Promise(() => {})).then(() => {
        const record = this.records.get(sessionId)
        if (!record || record.processes !== processes) return
        const role = processPlan?.role === 'server' ? 'Backend server' : 'Preview client'
        record.snapshot = {
          ...record.snapshot,
          status: record.snapshot.status === 'running' ? 'failed' : 'stopped',
          url: '',
          message: `${role} process exited`,
          updatedAt: new Date().toISOString(),
        }
        for (const runningProcess of processes) {
          if (runningProcess !== process) runningProcess.kill()
        }
        delete record.processes
      }).catch(error => {
        const record = this.records.get(sessionId)
        if (!record || record.processes !== processes) return
        record.snapshot = {
          ...record.snapshot,
          status: 'failed',
          url: '',
          message: error instanceof Error ? error.message : String(error),
          updatedAt: new Date().toISOString(),
        }
        for (const runningProcess of processes) runningProcess.kill()
        delete record.processes
      })
    })
  }
}

function isLoopbackPublicBase(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
  } catch {
    return false
  }
}

async function createPreviewPlan(
  workspacePath: string,
  portStart: number,
  allocatePort: BeeGamePreviewPortAllocator,
  publicPath: string,
): Promise<
  | { supported: false; message: string }
  | SupportedPreviewPlan
> {
  const manifestPath = join(workspacePath, 'package.json')
  if (!existsSync(manifestPath)) {
    return {
      supported: false,
      message: 'Preview host did not find a package.json entrypoint for an embeddable web preview',
    }
  }
  const manifest = readPackageManifest(manifestPath)
  const splitPlan = await createSplitClientServerPreviewPlan(
    workspacePath,
    manifest,
    portStart,
    allocatePort,
    publicPath,
  )
  if (splitPlan) return splitPlan

  const script = chooseScript(manifest, ['dev', 'preview', 'start'])
  if (!script) {
    return {
      supported: false,
      message: 'Preview host did not find a dev, preview, or start script',
    }
  }
  const port = await allocatePort(portStart)
  const command = buildRunCommand(workspacePath, manifest, script, port, publicPath)
  const url = `http://${DEFAULT_HOST}:${port}/`
  return {
    supported: true,
    port,
    url,
    command,
    script,
    entrypoint: 'package.json',
    processes: [{
      role: 'client',
      cwd: workspacePath,
      port,
      command,
      script,
      entrypoint: 'package.json',
      url,
    }],
  }
}

async function createSplitClientServerPreviewPlan(
  workspacePath: string,
  rootManifest: PackageManifest,
  portStart: number,
  allocatePort: BeeGamePreviewPortAllocator,
  publicPath: string,
): Promise<SupportedPreviewPlan | undefined> {
  const clientCwd = join(workspacePath, 'client')
  const clientManifestPath = join(clientCwd, 'package.json')
  if (!existsSync(clientManifestPath)) return undefined
  const clientManifest = readPackageManifest(clientManifestPath)
  if (!isWebClientManifest(clientManifest)) return undefined

  const serverPlan = await createServerProcessPlan(
    workspacePath,
    rootManifest,
    portStart,
    allocatePort,
  )
  const clientScript = chooseScript(clientManifest, ['dev', 'preview', 'start'])
  if (!clientScript) return undefined
  const clientPort = await allocatePort(portStart)
  const clientCommand = buildRunCommand(clientCwd, clientManifest, clientScript, clientPort, publicPath)
  const clientUrl = `http://${DEFAULT_HOST}:${clientPort}/`
  const clientPlan: PreviewProcessPlan = {
    role: 'client',
    cwd: clientCwd,
    port: clientPort,
    command: clientCommand,
    script: clientScript,
    entrypoint: 'client/package.json',
    url: clientUrl,
  }
  const processes = serverPlan ? [serverPlan, clientPlan] : [clientPlan]
  return {
    supported: true,
    port: clientPort,
    url: clientUrl,
    command: clientCommand,
    script: clientScript,
    entrypoint: clientPlan.entrypoint,
    processes,
  }
}

async function createServerProcessPlan(
  workspacePath: string,
  rootManifest: PackageManifest,
  portStart: number,
  allocatePort: BeeGamePreviewPortAllocator,
): Promise<PreviewProcessPlan | undefined> {
  const serverCwd = join(workspacePath, 'server')
  const serverManifestPath = join(serverCwd, 'package.json')
  if (existsSync(serverManifestPath)) {
    const serverManifest = readPackageManifest(serverManifestPath)
    const serverScript = chooseScript(serverManifest, ['dev', 'start'])
    if (!serverScript) return undefined
    const serverPort = await allocatePort(portStart)
    return {
      role: 'server',
      cwd: serverCwd,
      port: serverPort,
      command: buildRunCommand(serverCwd, serverManifest, serverScript, serverPort),
      script: serverScript,
      entrypoint: 'server/package.json',
      url: `http://${DEFAULT_HOST}:${serverPort}/`,
    }
  }

  const rootServerScript = chooseScript(rootManifest, ['dev:server', 'server', 'start:server'])
  if (!rootServerScript) return undefined
  const serverPort = await allocatePort(portStart)
  return {
    role: 'server',
    cwd: workspacePath,
    port: serverPort,
    command: buildRunCommand(workspacePath, rootManifest, rootServerScript, serverPort),
    script: rootServerScript,
    entrypoint: 'package.json',
    url: `http://${DEFAULT_HOST}:${serverPort}/`,
  }
}

function chooseScript(manifest: PackageManifest, names: string[]): string | undefined {
  return names.find(name => typeof manifest.scripts?.[name] === 'string' && manifest.scripts[name].trim())
}

function isWebClientManifest(manifest: PackageManifest): boolean {
  return Boolean(
    manifest.dependencies?.vite ||
      manifest.devDependencies?.vite ||
      chooseScript(manifest, ['dev', 'preview', 'start']),
  )
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
  publicPath = '',
): string[] {
  const manager = detectPackageManager(workspacePath)
  const base = manager === 'npm'
    ? ['npm', 'run', script]
    : [manager, 'run', script]
  if (!usesVite(manifest, script)) return base
  const viteArgs = ['--host', DEFAULT_HOST, '--port', String(port)]
  if (publicPath) viteArgs.push('--base', publicPath)
  return [...base, '--', ...viteArgs]
}

function detectPackageManager(workspacePath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(workspacePath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(workspacePath, 'bun.lockb')) || existsSync(join(workspacePath, 'bun.lock'))) return 'bun'
  return 'npm'
}

function buildPreviewProcessEnv(
  processPlan: PreviewProcessPlan,
  plan: SupportedPreviewPlan,
): Record<string, string> {
  const serverPlan = plan.processes.find(item => item.role === 'server')
  const serverHttpUrl = serverPlan ? `http://${DEFAULT_HOST}:${serverPlan.port}` : ''
  const serverWsUrl = serverPlan ? `ws://${DEFAULT_HOST}:${serverPlan.port}` : ''
  return {
    ...processEnv(),
    BEEGAME_PREVIEW_PORT: String(processPlan.port),
    PORT: String(processPlan.port),
    VITE_PORT: String(processPlan.port),
    HOST: DEFAULT_HOST,
    ...(processPlan.role === 'server'
      ? {
          SERVER_PORT: String(processPlan.port),
          API_PORT: String(processPlan.port),
          WS_PORT: String(processPlan.port),
        }
      : {}),
    ...(processPlan.role === 'client' && serverPlan
      ? {
          VITE_API_URL: serverHttpUrl,
          VITE_API_BASE_URL: serverHttpUrl,
          VITE_BACKEND_URL: serverHttpUrl,
          VITE_SERVER_URL: serverHttpUrl,
          VITE_WS_URL: serverWsUrl,
          VITE_SOCKET_URL: serverWsUrl,
          VITE_WS_ENDPOINT: serverWsUrl,
        }
      : {}),
  }
}

async function checkPreviewPlanReadiness(
  plan: SupportedPreviewPlan,
  readinessProbe: BeeGamePreviewReadinessProbe,
): Promise<{ ready: true } | { ready: false; message: string }> {
  const backendProcesses = plan.processes.filter(process => process.role === 'server' && process.url)
  for (const process of backendProcesses) {
    const url = process.url || ''
    if (!(await readinessProbe(url))) {
      return {
        ready: false,
        message: `Backend server did not become reachable at ${url}. Client preview was not exposed because networked games need the backend running.`,
      }
    }
  }
  if (!(await readinessProbe(plan.url))) {
    return {
      ready: false,
      message: `Preview client did not become reachable at ${plan.url}.`,
    }
  }
  return { ready: true }
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
