import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'

export type BeeGameDeploymentStatus =
  | 'queued'
  | 'building'
  | 'publishing'
  | 'succeeded'
  | 'failed'

export type BeeGameDeploymentRecord = {
  id: string
  sessionId: string
  projectId?: string
  workspacePath: string
  status: BeeGameDeploymentStatus
  url: string
  buildCommand?: string
  buildLog?: string
  entrypoint?: string
  outputDir?: string
  artifactPath?: string
  artifactHash?: string
  message?: string
  createdAt: string
  updatedAt: string
  deployedAt?: string
}

export type BeeGameDeploymentRunner = (
  command: string[],
  options: {
    cwd: string
    env: Record<string, string>
  },
) => Promise<{
  exitCode: number
  stdout: string
  stderr: string
}>

export type BeeGameDeploymentManagerOptions = {
  dataRoot: string
  publicBaseUrl?: string
  runner?: BeeGameDeploymentRunner
  outputCandidates?: string[]
}

type PackageManifest = {
  scripts?: Record<string, string>
}

type DeploymentPlan =
  | {
      supported: true
      cwd: string
      entrypoint: string
      command: string[]
    }
  | {
      supported: false
      message: string
    }

const DEFAULT_OUTPUT_CANDIDATES = ['dist', 'build', 'out']
const PUBLIC_PATH_PREFIX = '/deployments'

export class BeeGameDeploymentManager {
  private readonly deploymentsRoot: string
  private readonly recordsPath: string
  private readonly publicBaseUrl: string
  private readonly runner: BeeGameDeploymentRunner
  private readonly outputCandidates: string[]

  constructor(options: BeeGameDeploymentManagerOptions) {
    this.deploymentsRoot = join(options.dataRoot, 'deployments')
    this.recordsPath = join(this.deploymentsRoot, 'deployments.json')
    this.publicBaseUrl = (options.publicBaseUrl || '').replace(/\/+$/, '')
    this.runner = options.runner ?? runDeploymentCommand
    this.outputCandidates = options.outputCandidates ?? DEFAULT_OUTPUT_CANDIDATES
  }

  async list(sessionId?: string): Promise<BeeGameDeploymentRecord[]> {
    const records = await this.loadRecords()
    return sessionId
      ? records.filter(record => record.sessionId === sessionId)
      : records
  }

  async deploy(input: {
    sessionId: string
    projectId?: string
    workspacePath: string
  }): Promise<BeeGameDeploymentRecord> {
    const now = new Date().toISOString()
    const workspacePath = resolve(input.workspacePath)
    const id = `deploy_${createHash('sha1')
      .update(`${input.sessionId}-${workspacePath}-${now}`)
      .digest('hex')
      .slice(0, 12)}`
    let record: BeeGameDeploymentRecord = {
      id,
      sessionId: input.sessionId,
      ...(input.projectId ? { projectId: input.projectId } : {}),
      workspacePath,
      status: 'queued',
      url: '',
      createdAt: now,
      updatedAt: now,
    }
    await this.saveRecord(record)

    try {
      const plan = createDeploymentPlan(workspacePath)
      if (!plan.supported) {
        record = this.fail(record, plan.message)
        await this.saveRecord(record)
        return record
      }

      record = {
        ...record,
        status: 'building',
        buildCommand: plan.command.join(' '),
        entrypoint: plan.entrypoint,
        updatedAt: new Date().toISOString(),
      }
      await this.saveRecord(record)

      const result = await this.runner(plan.command, {
        cwd: plan.cwd,
        env: buildDeploymentEnv(),
      })
      const buildLog = [result.stdout, result.stderr].filter(Boolean).join('\n')
      if (result.exitCode !== 0) {
        record = this.fail(
          { ...record, buildLog },
          `Build command failed with exit code ${result.exitCode}`,
        )
        await this.saveRecord(record)
        return record
      }

      const outputDir = await this.findOutputDir(plan.cwd, workspacePath)
      const artifactPath = join(this.deploymentsRoot, id, 'site')
      record = {
        ...record,
        status: 'publishing',
        outputDir,
        artifactPath,
        buildLog,
        updatedAt: new Date().toISOString(),
      }
      await this.saveRecord(record)

      await rm(artifactPath, { recursive: true, force: true })
      await mkdir(artifactPath, { recursive: true })
      await cp(outputDir, artifactPath, { recursive: true })
      const artifactHash = await hashDirectory(artifactPath)
      const deployedAt = new Date().toISOString()
      record = {
        ...record,
        status: 'succeeded',
        artifactHash,
        url: this.publicUrl(id),
        message: 'Static deployment published',
        updatedAt: deployedAt,
        deployedAt,
      }
      await this.saveRecord(record)
      return record
    } catch (error) {
      record = this.fail(record, error instanceof Error ? error.message : String(error))
      await this.saveRecord(record)
      return record
    }
  }

  async readPublicFile(publicPath: string): Promise<
    | {
        body: Blob
        contentType: string
      }
    | undefined
  > {
    const normalized = publicPath.replace(/^\/+/, '')
    const parts = normalized.split('/').filter(Boolean)
    if (parts[0] !== 'deployments' || !parts[1]) return undefined
    const deploymentId = safeSegment(parts[1])
    const rest = parts.slice(2).join('/') || 'index.html'
    const requestedPath = resolve(this.deploymentsRoot, deploymentId, 'site', rest)
    const siteRoot = resolve(this.deploymentsRoot, deploymentId, 'site')
    if (!isInsideOrEqual(requestedPath, siteRoot)) return undefined
    let targetPath = requestedPath
    try {
      const targetStat = await stat(targetPath)
      if (targetStat.isDirectory()) {
        targetPath = join(targetPath, 'index.html')
      }
    } catch {
      targetPath = join(siteRoot, 'index.html')
    }
    if (!isInsideOrEqual(targetPath, siteRoot)) return undefined
    try {
      const bytes = await readFile(targetPath)
      return {
        body: new Blob([bytes]),
        contentType: contentTypeForPath(targetPath),
      }
    } catch {
      return undefined
    }
  }

  private async findOutputDir(cwd: string, workspacePath: string): Promise<string> {
    for (const candidate of this.outputCandidates) {
      const outputDir = resolve(cwd, candidate)
      if (!isInsideOrEqual(outputDir, workspacePath)) {
        throw new Error('Deployment output must stay inside the project workspace')
      }
      try {
        const outputStat = await stat(outputDir)
        if (outputStat.isDirectory()) return outputDir
      } catch {
        continue
      }
    }
    throw new Error(
      `Build finished but no static output directory was found (${this.outputCandidates.join(', ')})`,
    )
  }

  private publicUrl(id: string): string {
    const path = `${PUBLIC_PATH_PREFIX}/${id}/`
    return this.publicBaseUrl ? `${this.publicBaseUrl}${path}` : path
  }

  private fail(
    record: BeeGameDeploymentRecord,
    message: string,
  ): BeeGameDeploymentRecord {
    return {
      ...record,
      status: 'failed',
      url: '',
      message,
      updatedAt: new Date().toISOString(),
    }
  }

  private async loadRecords(): Promise<BeeGameDeploymentRecord[]> {
    try {
      const parsed = JSON.parse(await readFile(this.recordsPath, 'utf8'))
      return Array.isArray(parsed) ? parsed.filter(isDeploymentRecord) : []
    } catch {
      return []
    }
  }

  private async saveRecord(record: BeeGameDeploymentRecord): Promise<void> {
    await mkdir(this.deploymentsRoot, { recursive: true })
    const records = await this.loadRecords()
    const existingIndex = records.findIndex(item => item.id === record.id)
    if (existingIndex >= 0) {
      records[existingIndex] = record
    } else {
      records.unshift(record)
    }
    await writeFile(this.recordsPath, `${JSON.stringify(records, null, 2)}\n`)
  }
}

function createDeploymentPlan(workspacePath: string): DeploymentPlan {
  const rootManifestPath = join(workspacePath, 'package.json')
  if (existsSync(rootManifestPath)) {
    const manifest = readPackageManifest(rootManifestPath)
    if (hasBuildScript(manifest)) {
      return {
        supported: true,
        cwd: workspacePath,
        entrypoint: 'package.json',
        command: buildRunCommand(workspacePath, 'build'),
      }
    }
  }

  const clientPath = join(workspacePath, 'client')
  const clientManifestPath = join(clientPath, 'package.json')
  if (existsSync(clientManifestPath)) {
    const clientManifest = readPackageManifest(clientManifestPath)
    if (hasBuildScript(clientManifest)) {
      return {
        supported: true,
        cwd: clientPath,
        entrypoint: 'client/package.json',
        command: buildRunCommand(clientPath, 'build'),
      }
    }
  }

  return {
    supported: false,
    message: 'Deployment requires a package.json build script for static Web output',
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

function hasBuildScript(manifest: PackageManifest): boolean {
  return typeof manifest.scripts?.build === 'string' && manifest.scripts.build.trim().length > 0
}

function buildRunCommand(workspacePath: string, script: string): string[] {
  const manager = detectPackageManager(workspacePath)
  return manager === 'npm' ? ['npm', 'run', script] : [manager, 'run', script]
}

function detectPackageManager(workspacePath: string): 'npm' | 'pnpm' | 'yarn' | 'bun' {
  if (existsSync(join(workspacePath, 'pnpm-lock.yaml'))) return 'pnpm'
  if (existsSync(join(workspacePath, 'yarn.lock'))) return 'yarn'
  if (existsSync(join(workspacePath, 'bun.lockb')) || existsSync(join(workspacePath, 'bun.lock'))) return 'bun'
  return 'npm'
}

async function runDeploymentCommand(
  command: string[],
  options: {
    cwd: string
    env: Record<string, string>
  },
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  return { exitCode, stdout, stderr }
}

function buildDeploymentEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value
  }
  return {
    ...env,
    CI: env.CI || '1',
    BEEGAME_DEPLOYMENT: '1',
  }
}

async function hashDirectory(path: string): Promise<string> {
  const hash = createHash('sha256')
  const files = await listFiles(path)
  for (const file of files) {
    hash.update(relative(path, file))
    hash.update(await readFile(file))
  }
  return hash.digest('hex')
}

async function listFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = join(path, entry.name)
    if (entry.isDirectory()) {
      files.push(...await listFiles(fullPath))
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }
  return files.sort()
}

function contentTypeForPath(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    case '.wasm':
      return 'application/wasm'
    default:
      return 'application/octet-stream'
  }
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '')
}

function isDeploymentRecord(value: unknown): value is BeeGameDeploymentRecord {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as BeeGameDeploymentRecord).id === 'string' &&
      typeof (value as BeeGameDeploymentRecord).sessionId === 'string' &&
      typeof (value as BeeGameDeploymentRecord).workspacePath === 'string',
  )
}
