import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { computeWorkspaceRevision, resolveWorkspaceRelativePath } from './delivery-workflow/revision'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { parseBeeGameContentIndex, type BeeGameContentAuthority } from './game-content-package'
import { buildSceneUiContentAuthoringAuthority } from './scene-ui-content-authoring'
import type { BeeGameAssetManifest } from './asset-contracts'
import {
  readRuntimeAcceptanceReport,
  runtimeEvidenceIsCurrent,
  type RuntimeAcceptance,
} from './delivery-workflow/runtime-acceptance'

export const PROJECT_DELIVERY_REPORT_PATH = '.beegame/delivery/acceptance.json'
export const PROJECT_CONTENT_CONTRACT_PATH = '.beegame/delivery/content-contract.json'

type ProjectDeliveryState = {
  version: 1
  objective: string
  status: 'active' | 'paused'
  accepted?: {
    revision: string
    reportPath: string
    reportSha256: string
    reports: RuntimeAcceptance[]
  }
}

function statePath(workspacePath: string, dataRoot: string): string {
  const absolute = resolve(workspacePath)
  const canonical = realpathSync.native(absolute)
  const identity = createHash('sha256').update(canonical).digest('hex')
  return join(dataRoot, 'project-delivery', identity, 'state.json')
}

async function save(workspacePath: string, dataRoot: string, state: ProjectDeliveryState): Promise<void> {
  const path = statePath(workspacePath, dataRoot)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
}

export async function readProjectDelivery(workspacePath: string, dataRoot: string): Promise<ProjectDeliveryState | undefined> {
  let raw: string
  try { raw = await readFile(statePath(workspacePath, dataRoot), 'utf8') }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      (value as ProjectDeliveryState).version !== 1 ||
      typeof (value as ProjectDeliveryState).objective !== 'string' ||
      !['active', 'paused'].includes((value as ProjectDeliveryState).status))
    throw new Error('Invalid project delivery state')
  return value as ProjectDeliveryState
}

export async function beginProjectDelivery(workspacePath: string, dataRoot: string, objective: string): Promise<ProjectDeliveryState> {
  const existing = await readProjectDelivery(workspacePath, dataRoot)
  if (existing) {
    if (existing.objective !== objective) throw new Error('Project delivery already has a different objective')
    return existing
  }
  const state: ProjectDeliveryState = { version: 1, objective, status: 'active' }
  const format = structuredClone(buildSceneUiContentAuthoringAuthority({
    documentRevision: '0'.repeat(64), assetManifestRevision: '0'.repeat(64),
    manifest: {} as BeeGameAssetManifest,
  }).contract.output.format) as Record<string, unknown>
  const index = format.index as Record<string, unknown>
  index.documentRevision = '<64-character document digest>'
  index.assetManifestRevision = '<64-character Asset Manifest digest>'
  await mkdir(join(workspacePath, '.beegame/delivery'), { recursive: true })
  await writeFile(join(workspacePath, PROJECT_CONTENT_CONTRACT_PATH), `${JSON.stringify(format, null, 2)}\n`, 'utf8')
  await save(workspacePath, dataRoot, state)
  return state
}

export async function pauseProjectDelivery(workspacePath: string, dataRoot: string): Promise<void> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (state) await save(workspacePath, dataRoot, { ...state, status: 'paused' })
}

export async function resumeProjectDelivery(workspacePath: string, dataRoot: string): Promise<ProjectDeliveryState | undefined> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (state?.status === 'paused') {
    const resumed = { ...state, status: 'active' as const }
    await save(workspacePath, dataRoot, resumed)
    return resumed
  }
  return state
}

/** Capture an Agent's fresh delivery report once. Later file changes cannot silently re-baseline it. */
export async function captureProjectDeliveryAcceptance(workspacePath: string, dataRoot: string, turnStartedAt: number): Promise<void> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state || state.status !== 'active') return
  const reportPath = join(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
  let reportStat
  try { reportStat = await stat(reportPath) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  // A previous report cannot certify work performed in this turn.
  if (!reportStat.isFile() || reportStat.mtimeMs < turnStartedAt) return
  const report = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
  if (!report || report.scope === 'request' || report.status !== 'passed' ||
      !await runtimeEvidenceIsCurrent(workspacePath, [report])) return
  const reportSha256 = createHash('sha256').update(await readFile(reportPath)).digest('hex')
  const revision = await computeWorkspaceRevision(workspacePath)
  await save(workspacePath, dataRoot, { ...state, accepted: {
    revision, reportPath: PROJECT_DELIVERY_REPORT_PATH, reportSha256, reports: [report],
  } })
}

/** Preserve an already-current legacy acceptance without rerunning its Agent or validators. */
export async function importProjectDeliveryAcceptance(input: {
  workspacePath: string
  dataRoot: string
  revision: string
  reportPath: string
  reports: RuntimeAcceptance[]
}): Promise<void> {
  const state = await readProjectDelivery(input.workspacePath, input.dataRoot)
  if (!state) throw new Error('Project delivery has not started')
  if (input.revision !== await computeWorkspaceRevision(input.workspacePath) ||
      !await runtimeEvidenceIsCurrent(input.workspacePath, input.reports))
    throw new Error('Historical acceptance is no longer current')
  const report = resolveWorkspaceRelativePath(input.workspacePath, input.reportPath)
  if (!report) throw new Error('Historical acceptance path is invalid')
  const reportSha256 = createHash('sha256').update(await readFile(report)).digest('hex')
  await save(input.workspacePath, input.dataRoot, { ...state, accepted: {
    revision: input.revision, reportPath: input.reportPath,
    reportSha256, reports: input.reports,
  } })
}

export async function evaluateProjectDeliveryGate(workspacePath: string, dataRoot: string): Promise<{
  allowed: boolean
  issues: string[]
} | undefined> {
  const state = await readProjectDelivery(workspacePath, dataRoot)
  if (!state) return undefined
  if (!state.accepted) return { allowed: false, issues: ['Current project has no verified delivery acceptance.'] }
  const { accepted } = state
  if (accepted.revision !== await computeWorkspaceRevision(workspacePath))
    return { allowed: false, issues: ['Workspace changed after acceptance; revalidation is required.'] }
  let reportSha256: string
  try {
    const candidate = resolveWorkspaceRelativePath(workspacePath, accepted.reportPath)
    if (!candidate) throw new Error('invalid report path')
    const actual = await realpath(candidate)
    const relativePath = relative(await realpath(workspacePath), actual)
    if (!relativePath || relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath))
      throw new Error('report escapes project workspace')
    reportSha256 = createHash('sha256')
      .update(await readFile(candidate))
      .digest('hex')
  } catch {
    return { allowed: false, issues: ['Delivery acceptance report is missing.'] }
  }
  if (reportSha256 !== accepted.reportSha256 ||
      (accepted.reportPath === PROJECT_DELIVERY_REPORT_PATH &&
        (await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH))?.status !== 'passed') ||
      !await runtimeEvidenceIsCurrent(workspacePath, accepted.reports))
    return { allowed: false, issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
  return { allowed: true, issues: [] }
}

/** Editor authority comes from the authored package, not a delivery phase snapshot. */
export function nativeContentAuthority(workspacePath: string): BeeGameContentAuthority {
  const index = parseBeeGameContentIndex(JSON.parse(
    requireContentIndex(workspacePath),
  ))
  return {
    documentRevision: index.documentRevision,
    assetManifestRevision: index.assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(workspacePath),
  }
}

function requireContentIndex(workspacePath: string): string {
  return readFileSync(join(workspacePath, 'content/index.json'), 'utf8')
}
