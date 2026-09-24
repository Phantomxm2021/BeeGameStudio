import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { mkdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
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

type ProjectDeliveryAcceptance = {
  revision: string
} & (
  | {
      source: 'chat'
      sessionId: string
      turnId: string
      completedAt: string
      resultSha256: string
    }
  | {
      source?: 'report'
      reportPath: string
      reportSha256: string
      reports: RuntimeAcceptance[]
    }
)

type ProjectDeliveryState = {
  version: 1
  objective: string
  status: 'active' | 'paused'
  accepted?: ProjectDeliveryAcceptance
}

function statePath(workspacePath: string, dataRoot: string): string {
  const absolute = resolve(workspacePath)
  const canonical = realpathSync.native(absolute)
  const identity = createHash('sha256').update(canonical).digest('hex')
  return join(dataRoot, 'project-delivery', identity, 'state.json')
}

export const projectDeliveryStatePath = statePath

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

  const canonicalWorkspace = await realpath(workspacePath)
  const freshReports: Array<{ path: string; absolutePath: string; mtimeMs: number; report?: RuntimeAcceptance }> = []
  for (const path of [PROJECT_DELIVERY_REPORT_PATH]) {
    const candidatePath = resolveWorkspaceRelativePath(workspacePath, path)
    if (!candidatePath) continue
    let canonicalReportPath: string
    try { canonicalReportPath = await realpath(candidatePath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    const relativeReportPath = relative(canonicalWorkspace, canonicalReportPath)
    if (!relativeReportPath || relativeReportPath === '..' ||
        relativeReportPath.startsWith(`..${sep}`) || isAbsolute(relativeReportPath)) continue

    let reportStat
    try { reportStat = await stat(canonicalReportPath) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw error
    }
    // A previous report cannot certify work performed in this turn.
    if (!reportStat.isFile() || reportStat.mtimeMs < turnStartedAt) continue

    let raw: unknown
    try { raw = JSON.parse(await readFile(canonicalReportPath, 'utf8')) }
    catch { continue }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const scope = (raw as { scope?: unknown }).scope
    // Only the current delivery-scoped Chat report is authoritative.
    if (scope !== 'delivery') continue
    freshReports.push({
      path,
      absolutePath: canonicalReportPath,
      mtimeMs: reportStat.mtimeMs,
      report: await readRuntimeAcceptanceReport(workspacePath, path),
    })
  }

  // Do not fall back to an older passing report if the latest delivery report
  // from this turn is failed, blocked, malformed, or has stale evidence.
  const latest = freshReports.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]
  const report = latest?.report
  if (!latest || latest.path !== PROJECT_DELIVERY_REPORT_PATH || !report ||
      report.scope !== 'delivery' || report.status !== 'passed' ||
      !await runtimeEvidenceIsCurrent(workspacePath, [report])) return
  const reportSha256 = createHash('sha256').update(await readFile(latest.absolutePath)).digest('hex')
  if (state.accepted?.source === 'report' &&
      state.accepted.reportSha256 === reportSha256) return
  const revision = await computeWorkspaceRevision(workspacePath)
  await save(workspacePath, dataRoot, { ...state, accepted: {
    source: 'report',
    revision, reportPath: latest.path, reportSha256, reports: [report],
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
  if (accepted.source === 'chat') {
    return { allowed: false, issues: ['Current version requires a delivery acceptance report.'] }
  }
  if (accepted.reportPath !== PROJECT_DELIVERY_REPORT_PATH)
    return { allowed: false, issues: ['Delivery evidence changed after acceptance; revalidation is required.'] }
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
  const currentReport = await readRuntimeAcceptanceReport(workspacePath, PROJECT_DELIVERY_REPORT_PATH)
  if (currentReport?.scope !== 'delivery' || currentReport.status !== 'passed')
    return { allowed: false, issues: ['Delivery acceptance report is not a current delivery PASS.'] }
  if (reportSha256 !== accepted.reportSha256 ||
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
