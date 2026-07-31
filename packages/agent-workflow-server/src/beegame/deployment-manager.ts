import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import {
  cp,
  mkdir,
  realpath,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { computeWorkspaceRevision } from './delivery-workflow/revision'

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
  manifestStorageObjectId?: string
  message?: string
  createdAt: string
  updatedAt: string
  deployedAt?: string
}

export type BeeGameDeploymentRetentionItem = {
  id: string
  projectId?: string
  sessionId: string
  status: BeeGameDeploymentStatus
  createdAt: string
  updatedAt: string
  deployedAt?: string
  artifactPath?: string
  reason: string
}

export type BeeGameDeploymentRetentionResult = {
  dryRun: boolean
  retained: BeeGameDeploymentRetentionItem[]
  plannedForDeletion: BeeGameDeploymentRetentionItem[]
  deleted: BeeGameDeploymentRetentionItem[]
  skipped: BeeGameDeploymentRetentionItem[]
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

export type BeeGameDeploymentFile = {
  path: string
  bytes(): Promise<Uint8Array>
  text(): Promise<string>
}

export type BeeGameDeploymentPublisher = {
  publishStaticDirectory(input: {
    deploymentId: string
    sessionId: string
    userId?: string
    projectId?: string
    workspacePath: string
    outputDir: string
    artifactHash: string
    authToken?: string
    files: BeeGameDeploymentFile[]
  }): Promise<{
    url: string
    artifactPath?: string
    manifestStorageObjectId?: string
    message?: string
  }>
}

export type BeeGameDeploymentManagerOptions = {
  dataRoot: string
  publicBaseUrl?: string
  runner?: BeeGameDeploymentRunner
  outputCandidates?: string[]
  publisher?: BeeGameDeploymentPublisher
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
const SAFE_BUILD_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SHELL',
  'TMPDIR',
  'USER',
] as const

export class BeeGameDeploymentManager {
  private readonly deploymentsRoot: string
  private readonly recordsPath: string
  private readonly publicBaseUrl: string
  private readonly runner: BeeGameDeploymentRunner
  private readonly outputCandidates: string[]
  private readonly publisher?: BeeGameDeploymentPublisher

  constructor(options: BeeGameDeploymentManagerOptions) {
    this.deploymentsRoot = join(options.dataRoot, 'deployments')
    this.recordsPath = join(this.deploymentsRoot, 'deployments.json')
    this.publicBaseUrl = (options.publicBaseUrl || '').replace(/\/+$/, '')
    this.runner = options.runner ?? runDeploymentCommand
    this.outputCandidates = options.outputCandidates ?? DEFAULT_OUTPUT_CANDIDATES
    this.publisher = options.publisher
  }

  async list(sessionId?: string): Promise<BeeGameDeploymentRecord[]> {
    const records = await this.loadRecords()
    return sessionId
      ? records.filter(record => record.sessionId === sessionId)
      : records
  }

  async applyRetention(input: {
    dryRun: boolean
    keepSuccessfulPerProject?: number
  }): Promise<BeeGameDeploymentRetentionResult> {
    const keepSuccessfulPerProject = Math.max(1, input.keepSuccessfulPerProject ?? 6)
    const records = await this.loadRecords()
    const retainedIds = new Set<string>()
    const deleteIds = new Set<string>()
    const byProject = new Map<string, BeeGameDeploymentRecord[]>()
    for (const record of records) {
      const groupId = record.projectId || record.sessionId
      const group = byProject.get(groupId) ?? []
      group.push(record)
      byProject.set(groupId, group)
    }

    for (const group of byProject.values()) {
      const successful = group
        .filter(record => record.status === 'succeeded')
        .sort(compareDeploymentRecordsNewestFirst)
      for (const [index, record] of successful.entries()) {
        if (index < keepSuccessfulPerProject) {
          retainedIds.add(record.id)
        } else {
          deleteIds.add(record.id)
        }
      }
      for (const record of group) {
        if (!retainedIds.has(record.id) && !deleteIds.has(record.id)) {
          retainedIds.add(record.id)
        }
      }
    }

    const retained = records
      .filter(record => retainedIds.has(record.id))
      .map(record => toRetentionItem(record, 'retention_policy_retained'))
    const plannedForDeletion = records
      .filter(record => deleteIds.has(record.id))
      .map(record => toRetentionItem(record, 'older_than_rollback_retention_window'))
    const deleted: BeeGameDeploymentRetentionItem[] = []
    const skipped: BeeGameDeploymentRetentionItem[] = []
    if (!input.dryRun) {
      for (const record of records.filter(item => deleteIds.has(item.id))) {
        const item = toRetentionItem(record, 'older_than_rollback_retention_window')
        const deletedArtifact = await this.deleteLocalArtifact(record)
        if (!deletedArtifact) {
          skipped.push({
            ...item,
            reason: 'artifact_not_local_or_missing',
          })
        }
        deleted.push(item)
      }
      await this.saveRecords(records.filter(record => !deleteIds.has(record.id)))
    }

    return {
      dryRun: input.dryRun,
      retained,
      plannedForDeletion,
      deleted,
      skipped,
    }
  }

  async deploy(input: {
    sessionId: string
    userId?: string
    projectId?: string
    workspacePath: string
    authToken?: string
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
      const acceptedWorkspaceRevision = await computeWorkspaceRevision(workspacePath)
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
      if (
        (await computeWorkspaceRevision(workspacePath)) !==
        acceptedWorkspaceRevision
      ) {
        record = this.fail(
          { ...record, buildLog },
          'Project source changed during the deployment build. Re-run the delivery workflow for the new revision.',
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
      await validateDeploymentArtifact(artifactPath)
      const artifactHash = await hashDirectory(artifactPath)
      const published = this.publisher
        ? await this.publisher.publishStaticDirectory({
            deploymentId: id,
            sessionId: input.sessionId,
            ...(input.userId ? { userId: input.userId } : {}),
            ...(input.projectId ? { projectId: input.projectId } : {}),
            workspacePath,
            outputDir,
            artifactHash,
            ...(input.authToken ? { authToken: input.authToken } : {}),
            files: await createDeploymentFiles(artifactPath),
          })
        : undefined
      const deployedAt = new Date().toISOString()
      record = {
        ...record,
        status: 'succeeded',
        artifactHash,
        url: published?.url ?? this.publicUrl(id),
        artifactPath: published?.artifactPath ?? artifactPath,
        ...(published?.manifestStorageObjectId
          ? { manifestStorageObjectId: published.manifestStorageObjectId }
          : {}),
        message: published?.message ?? 'Static deployment published',
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

  async rollbackTo(source: BeeGameDeploymentRecord): Promise<BeeGameDeploymentRecord> {
    if (source.status !== 'succeeded' || !source.url) {
      throw new Error('Only successful deployments can be restored')
    }
    const now = new Date().toISOString()
    const id = `deploy_${createHash('sha1')
      .update(`${source.sessionId}-${source.id}-rollback-${now}`)
      .digest('hex')
      .slice(0, 12)}`
    const {
      buildCommand: _buildCommand,
      buildLog: _buildLog,
      ...restoredSource
    } = source
    const record: BeeGameDeploymentRecord = {
      ...restoredSource,
      id,
      status: 'succeeded',
      message: `Restored from deployment ${source.id}`,
      createdAt: now,
      updatedAt: now,
      deployedAt: now,
    }
    await this.saveRecord(record)
    return record
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
      if (isStaticFilePath(rest)) return undefined
      targetPath = join(siteRoot, 'index.html')
    }
    if (!isInsideOrEqual(targetPath, siteRoot)) return undefined
    try {
      const [resolvedSiteRoot, resolvedTargetPath] = await Promise.all([
        realpath(siteRoot),
        realpath(targetPath),
      ])
      if (!isInsideOrEqual(resolvedTargetPath, resolvedSiteRoot)) return undefined
      const bytes = await readFile(resolvedTargetPath)
      return {
        body: new Blob([bytes]),
        contentType: contentTypeForPath(resolvedTargetPath),
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
    await this.saveRecords(records)
  }

  private async saveRecords(records: BeeGameDeploymentRecord[]): Promise<void> {
    await mkdir(this.deploymentsRoot, { recursive: true })
    await writeFile(this.recordsPath, `${JSON.stringify(records, null, 2)}\n`)
  }

  private async deleteLocalArtifact(record: BeeGameDeploymentRecord): Promise<boolean> {
    const artifactPath = record.artifactPath ? resolve(record.artifactPath) : ''
    if (!artifactPath || !isInsideOrEqual(artifactPath, this.deploymentsRoot)) {
      return false
    }
    await rm(resolve(this.deploymentsRoot, record.id), { recursive: true, force: true })
    return true
  }
}

export function createSupabaseStorageDeploymentPublisher(options: {
  supabaseUrl: string
  anonKey: string
  bucket: string
  publicBaseUrl?: string
  keyPrefix?: string
  fetch?: typeof fetch
}): BeeGameDeploymentPublisher {
  const supabaseUrl = options.supabaseUrl.replace(/\/+$/, '')
  const publicBaseUrl = options.publicBaseUrl?.replace(/\/+$/, '')
  const keyPrefix = trimSlashes(options.keyPrefix ?? 'deployments')
  const fetchImpl = options.fetch ?? fetch
  return {
    async publishStaticDirectory(input) {
      if (!input.authToken) {
        throw new Error('Deployment storage publishing requires a user auth token')
      }
      if (!input.userId) {
        throw new Error('Deployment storage publishing requires a user id')
      }
      const objectRoot = [keyPrefix, input.userId, input.deploymentId]
        .filter(Boolean)
        .join('/')
      for (const file of input.files) {
        const objectPath = `${objectRoot}/${file.path}`
        const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeObjectPath(
          options.bucket,
        )}/${encodeObjectPath(objectPath)}`
        const bytes = await file.bytes()
        const body = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(body).set(bytes)
        const response = await fetchImpl(uploadUrl, {
          method: 'POST',
          headers: {
            apikey: options.anonKey,
            authorization: `Bearer ${input.authToken}`,
            'content-type': contentTypeForPath(file.path),
            'x-upsert': 'true',
          },
          body,
        })
        if (!response.ok) {
          throw new Error(
            `Deployment storage upload failed: ${response.status} ${await response.text()}`,
          )
        }
      }
      const url = publicBaseUrl
        ? `${publicBaseUrl}/${objectRoot}/index.html`
        : `${supabaseUrl}/storage/v1/object/public/${encodeObjectPath(
            options.bucket,
          )}/${encodeObjectPath(`${objectRoot}/index.html`)}`
      return {
        url,
        artifactPath: `supabase://${options.bucket}/${objectRoot}`,
        message: 'Static deployment published to storage',
      }
    },
  }
}

export function createSupabaseStorageDeploymentPublisherFromEnv(): BeeGameDeploymentPublisher | undefined {
  const supabaseUrl = process.env.BEEGAME_SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const anonKey = process.env.BEEGAME_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
  const bucket = process.env.BEEGAME_DEPLOYMENT_STORAGE_BUCKET
  if (!supabaseUrl || !anonKey || !bucket) return undefined
  return createSupabaseStorageDeploymentPublisher({
    supabaseUrl,
    anonKey,
    bucket,
    publicBaseUrl: process.env.BEEGAME_DEPLOYMENT_STORAGE_PUBLIC_BASE_URL ??
      process.env.BEEGAME_DEPLOYMENT_PUBLIC_BASE_URL,
    keyPrefix: process.env.BEEGAME_DEPLOYMENT_STORAGE_PREFIX,
  })
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
        command: buildRunCommand(workspacePath, 'build', manifest.scripts?.build),
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
        command: buildRunCommand(clientPath, 'build', clientManifest.scripts?.build),
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

function buildRunCommand(workspacePath: string, script: string, scriptCommand?: string): string[] {
  const manager = detectPackageManager(workspacePath)
  const command = manager === 'npm' ? ['npm', 'run', script] : [manager, 'run', script]
  return isViteBuildScript(scriptCommand) ? [...command, '--', '--base=./'] : command
}

function isViteBuildScript(scriptCommand?: string): boolean {
  return typeof scriptCommand === 'string' &&
    scriptCommand.split(/\s+/).some(part => part === 'vite')
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
  const env = Object.fromEntries(SAFE_BUILD_ENV_KEYS.flatMap(key => {
    const value = process.env[key]
    return typeof value === 'string' ? [[key, value]] : []
  }))
  return {
    ...env,
    CI: '1',
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

async function createDeploymentFiles(outputDir: string): Promise<BeeGameDeploymentFile[]> {
  const files = await listFiles(outputDir)
  return files.map(file => {
    const relativePath = relative(outputDir, file).split('\\').join('/')
    return {
      path: relativePath,
      bytes: async () => await readFile(file),
      text: async () => await readFile(file, 'utf8'),
    }
  })
}

async function validateDeploymentArtifact(artifactPath: string): Promise<void> {
  const indexPath = join(artifactPath, 'index.html')
  if (!existsSync(indexPath)) throw new Error('Deployment artifact has no index.html entrypoint')
  const indexHtml = await readFile(indexPath, 'utf8')
  if (!indexHtml.trim()) throw new Error('Deployment artifact index.html is empty')
  const files = await listFiles(artifactPath)
  if (files.length === 0) throw new Error('Deployment artifact is empty')
  for (const file of files) {
    const extension = extname(file).toLowerCase()
    const bytes = await readFile(file)
    if (bytes.byteLength === 0) throw new Error(`Deployment artifact contains an empty file: ${relative(artifactPath, file)}`)
    if (extension === '.json') {
      try {
        JSON.parse(bytes.toString('utf8'))
      } catch {
        throw new Error(`Deployment artifact contains invalid JSON: ${relative(artifactPath, file)}`)
      }
    }
    if (extension === '.glb' && bytes.subarray(0, 4).toString('ascii') !== 'glTF') {
      throw new Error(`Deployment artifact contains an invalid GLB: ${relative(artifactPath, file)}`)
    }
  }
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
    } else if (entry.isSymbolicLink()) {
      throw new Error(`Deployment artifact contains a symbolic link: ${fullPath}`)
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

function isStaticFilePath(path: string): boolean {
  const name = path.split('/').filter(Boolean).at(-1) || ''
  return name.includes('.')
}

function isInsideOrEqual(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function compareDeploymentRecordsNewestFirst(
  left: BeeGameDeploymentRecord,
  right: BeeGameDeploymentRecord,
): number {
  return deploymentTime(right) - deploymentTime(left)
}

function deploymentTime(record: BeeGameDeploymentRecord): number {
  return Date.parse(record.deployedAt || record.updatedAt || record.createdAt) || 0
}

function toRetentionItem(
  record: BeeGameDeploymentRecord,
  reason: string,
): BeeGameDeploymentRetentionItem {
  return {
    id: record.id,
    ...(record.projectId ? { projectId: record.projectId } : {}),
    sessionId: record.sessionId,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(record.deployedAt ? { deployedAt: record.deployedAt } : {}),
    ...(record.artifactPath ? { artifactPath: record.artifactPath } : {}),
    reason,
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '')
}

function trimSlashes(value: string): string {
  return value
    .split('/')
    .filter(Boolean)
    .join('/')
}

function encodeObjectPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')
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
