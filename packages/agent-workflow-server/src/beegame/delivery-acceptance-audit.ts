import { existsSync, readFileSync, readdirSync, statSync, type Dirent } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { auditAssetContract } from './asset-contract-audit'
import { DELIVERY_VALIDATOR_AGENT_TYPES } from './delivery-validation-agents'
import { hasObservedNativeAcceptanceReport } from './native-acceptance-evidence'

const VALIDATION_REPORT_PATH = ['docs', 'acceptance', 'validation-report.json'] as const
const ACCEPTANCE_CHECKLIST_PATH = ['docs', 'acceptance', 'gameplay-checklist.md'] as const
const ACCEPTANCE_SKILL_CAPABILITY = 'skill:beegame-game-acceptance'
const REQUIRED_PROJECT_DOCUMENTS = [
  'docs/GDD.md',
  'docs/TECHNICAL_DESIGN.md',
  'docs/ART_DIRECTION.md',
  'docs/UI_UX_SPEC.md',
  'docs/AUDIO_DESIGN.md',
  'docs/ASSET_PLAN.md',
] as const

export type PersistedDeliveryAcceptance = {
  allowed: boolean
  outcome: 'passed' | 'blocked' | 'rejected'
  issues: string[]
}

type ChecklistKind = 'requirement' | 'player-path'

type ChecklistEntry = {
  kind: ChecklistKind
  id: string
  checked: boolean
}

/**
 * Audits persisted delivery artifacts at the deployment boundary. This never
 * controls, resumes, or rejects a Claude Code turn.
 */
export function evaluatePersistedDeliveryAcceptance(
  workspacePath: string,
  provenance?: { dataRoot: string; sessionId: string },
): PersistedDeliveryAcceptance {
  const workspace = resolve(workspacePath)
  const reportPath = resolve(workspace, ...VALIDATION_REPORT_PATH)
  if (!existsSync(reportPath)) {
    return rejected('Deployment requires docs/acceptance/validation-report.json.')
  }

  let report: unknown
  try {
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as unknown
  } catch (error) {
    return rejected(`The validation report is not valid JSON: ${toErrorMessage(error)}`)
  }
  if (!isRecord(report)) return rejected('The validation report root must be a JSON object.')

  const issues: string[] = []
  issues.push(...auditReportFreshness(workspace, reportPath))
  for (const document of REQUIRED_PROJECT_DOCUMENTS) {
    if (!safeExistingPath(workspace, document)) issues.push(`Required approved project document is missing: ${document}.`)
  }
  const status = stringValue(report.status)
  if (stringValue(report.validatorId) !== DELIVERY_VALIDATOR_AGENT_TYPES[0]) {
    issues.push(`validatorId must equal ${DELIVERY_VALIDATOR_AGENT_TYPES[0]}.`)
  }
  if (!['passed', 'failed', 'blocked'].includes(status)) {
    issues.push('status must be passed, failed, or blocked.')
  }
  if (!stringValue(report.summary)) issues.push('summary must describe the observed acceptance result.')
  if (!stringArray(report.verifiedCapabilities).includes(ACCEPTANCE_SKILL_CAPABILITY)) {
    issues.push(`verifiedCapabilities must include ${ACCEPTANCE_SKILL_CAPABILITY}.`)
  }
  if (!provenance || !hasObservedNativeAcceptanceReport({ ...provenance, workspacePath: workspace, report })) {
    issues.push('The validation report is not the terminal result of an observed native acceptance Validator call.')
  }

  const checklist = readChecklist(workspace)
  issues.push(...checklist.issues)
  const requirements = recordArray(report.requirements)
  const playerPaths = recordArray(report.playerPaths)
  const findings = recordArray(report.findings)
  if (typeof report.assetsRequired !== 'boolean') {
    issues.push('assetsRequired must explicitly state whether the approved project requires an asset contract.')
  }
  const evidenceIds = new Set<string>()
  const runtimeEvidenceIds = new Set<string>()
  auditReportedItems({
    workspace,
    label: 'requirement',
    items: requirements,
    expected: checklist.entries.filter(entry => entry.kind === 'requirement'),
    reportStatus: status,
    evidenceIds,
    runtimeEvidenceIds,
    issues,
  })
  auditReportedItems({
    workspace,
    label: 'player path',
    items: playerPaths,
    expected: checklist.entries.filter(entry => entry.kind === 'player-path'),
    reportStatus: status,
    requireRuntimeEvidence: true,
    evidenceIds,
    runtimeEvidenceIds,
    issues,
  })

  if (status === 'passed' && findings.length > 0) {
    issues.push('A passed report must not contain unresolved findings.')
  }
  if (status === 'blocked') {
    const blockers = findings.filter(finding =>
      stringValue(finding.status) === 'blocked' && Boolean(stringValue(finding.detail)),
    )
    if (blockers.length === 0) issues.push('A blocked report must contain a concrete blocked finding.')
  }

  const assetAudit = auditAssetContract(workspace)
  if (report.assetsRequired === true && !assetAudit.present) {
    issues.push('The approved project requires assets/asset-manifest.json, but the manifest is missing.')
  }
  if (assetAudit.present && !assetAudit.valid) {
    issues.push(...assetAudit.issues.map(issue => `Asset contract: ${issue}`))
  }
  if (assetAudit.present && status === 'passed') {
    for (const slot of assetAudit.slots) {
      if (slot.required && slot.stage !== 'runtime_loaded') {
        issues.push(`Asset contract: required slot ${slot.id} is only ${slot.stage}, not runtime_loaded.`)
      }
      if (
        slot.required &&
        slot.stage === 'runtime_loaded' &&
        !slot.runtimeEventIds.some(id => runtimeEvidenceIds.has(id))
      ) {
        issues.push(`Asset contract: required slot ${slot.id} has no runtime_event_id present in the acceptance report.`)
      }
    }
  }

  if (issues.length > 0) return { allowed: false, outcome: 'rejected', issues }
  return {
    allowed: status === 'passed',
    outcome: status === 'blocked' ? 'blocked' : status === 'passed' ? 'passed' : 'rejected',
    issues: status === 'failed' ? ['Acceptance report is failed.'] : [],
  }
}

function readChecklist(workspace: string): { entries: ChecklistEntry[]; issues: string[] } {
  const checklistPath = resolve(workspace, ...ACCEPTANCE_CHECKLIST_PATH)
  if (!existsSync(checklistPath)) {
    return { entries: [], issues: ['Deployment requires docs/acceptance/gameplay-checklist.md.'] }
  }
  const entries: ChecklistEntry[] = []
  const issues: string[] = []
  const ids = new Set<string>()
  let taskItems = 0
  for (const rawLine of readFileSync(checklistPath, 'utf8').split('\n')) {
    const line = rawLine.trimStart()
    if (!line.startsWith('- [') || line.length < 6 || line[4] !== ']') continue
    const marker = line[3]
    if (marker !== ' ' && marker !== 'x' && marker !== 'X') continue
    taskItems += 1
    const content = line.slice(5).trimStart()
    if (!content.startsWith('[')) continue
    const closing = content.indexOf(']')
    if (closing < 0) continue
    const declaration = content.slice(1, closing)
    const separator = declaration.indexOf(':')
    if (separator < 1) continue
    const kind = declaration.slice(0, separator)
    const id = declaration.slice(separator + 1).trim()
    if ((kind !== 'requirement' && kind !== 'player-path') || !id) continue
    if (ids.has(id)) issues.push(`Acceptance checklist id is duplicated: ${id}.`)
    ids.add(id)
    entries.push({ kind, id, checked: marker !== ' ' })
  }
  if (taskItems === 0) issues.push('The acceptance checklist contains no task items.')
  if (entries.length !== taskItems) {
    issues.push('Every acceptance checklist item must start with [requirement:ID] or [player-path:ID].')
  }
  if (!entries.some(entry => entry.kind === 'requirement')) {
    issues.push('The acceptance checklist contains no identified requirements.')
  }
  if (!entries.some(entry => entry.kind === 'player-path')) {
    issues.push('The acceptance checklist contains no identified player paths.')
  }
  return { entries, issues }
}

function auditReportedItems(input: {
  workspace: string
  label: string
  items: Record<string, unknown>[]
  expected: ChecklistEntry[]
  reportStatus: string
  requireRuntimeEvidence?: boolean
  evidenceIds: Set<string>
  runtimeEvidenceIds: Set<string>
  issues: string[]
}): void {
  const byId = new Map(input.items.map(item => [stringValue(item.id), item]))
  const expectedIds = new Set(input.expected.map(entry => entry.id))
  for (const entry of input.expected) {
    const item = byId.get(entry.id)
    if (!item) {
      input.issues.push(`The report omits ${input.label} ${entry.id}.`)
      continue
    }
    const itemStatus = stringValue(item.status)
    if (!['passed', 'failed', 'blocked', 'untested'].includes(itemStatus)) {
      input.issues.push(`${entry.id} has an invalid status.`)
    }
    if (input.reportStatus === 'passed' && itemStatus !== 'passed') {
      input.issues.push(`${entry.id} is not passed while the report claims passed.`)
    }
    if (input.reportStatus === 'passed' && !entry.checked) {
      input.issues.push(`${entry.id} is still unchecked in the acceptance checklist.`)
    }
    const evidence = recordArray(item.evidence)
    if (itemStatus === 'passed' && evidence.length === 0) {
      input.issues.push(`${entry.id} passed without evidence.`)
    }
    for (const observation of evidence) {
      auditEvidence(
        input.workspace,
        entry.id,
        observation,
        Boolean(input.requireRuntimeEvidence),
        input.evidenceIds,
        input.runtimeEvidenceIds,
        input.issues,
      )
    }
    if (
      itemStatus === 'passed' &&
      evidence.some(observation => stringValue(observation.result) !== 'passed')
    ) {
      input.issues.push(`${entry.id} is passed but contains non-passing evidence.`)
    }
    if (
      input.requireRuntimeEvidence &&
      itemStatus === 'passed' &&
      !evidence.some(observation => stringValue(observation.kind) === 'runtime')
    ) {
      input.issues.push(`${entry.id} passed without runtime evidence.`)
    }
  }
  for (const id of byId.keys()) {
    if (id && !expectedIds.has(id)) input.issues.push(`The report contains undeclared ${input.label} ${id}.`)
  }
}

function auditEvidence(
  workspace: string,
  ownerId: string,
  evidence: Record<string, unknown>,
  playerPath: boolean,
  evidenceIds: Set<string>,
  runtimeEvidenceIds: Set<string>,
  issues: string[],
): void {
  const evidenceId = stringValue(evidence.id)
  if (!evidenceId) {
    issues.push(`${ownerId} evidence is missing a stable id.`)
  } else if (evidenceIds.has(evidenceId)) {
    issues.push(`Evidence id is duplicated: ${evidenceId}.`)
  } else {
    evidenceIds.add(evidenceId)
  }
  const kind = stringValue(evidence.kind)
  const result = stringValue(evidence.result)
  if (!kind) issues.push(`${ownerId} evidence is missing kind.`)
  if (result !== 'passed' && result !== 'failed' && result !== 'blocked') {
    issues.push(`${ownerId} evidence is missing a valid result.`)
  }
  if (!stringValue(evidence.detail)) issues.push(`${ownerId} evidence is missing detail.`)
  if (kind === 'runtime') {
    if (evidenceId) runtimeEvidenceIds.add(evidenceId)
    if (playerPath && stringValue(evidence.source) !== ownerId) {
      issues.push(`${ownerId} runtime evidence source must equal its declared player-path id.`)
    }
    for (const field of ['workingDirectory', 'action', 'assertion']) {
      if (!stringValue(evidence[field])) issues.push(`${ownerId} runtime evidence is missing ${field}.`)
    }
    const workingDirectory = stringValue(evidence.workingDirectory)
    if (workingDirectory && !safeExistingPath(workspace, workingDirectory)) {
      issues.push(`${ownerId} runtime evidence workingDirectory does not exist in the project: ${workingDirectory}.`)
    }
    const artifact = stringValue(evidence.artifact)
    if (artifact && !safeExistingPath(workspace, artifact)) {
      issues.push(`${ownerId} runtime evidence artifact does not exist in the project: ${artifact}.`)
    }
    return
  }
  if (['implementation', 'document', 'asset', 'test'].includes(kind)) {
    const source = stringValue(evidence.source)
    if (!source || !safeExistingPath(workspace, source)) {
      issues.push(`${ownerId} ${kind} evidence source does not exist in the project: ${source || '<missing>'}.`)
    }
  }
}

function auditReportFreshness(workspace: string, reportPath: string): string[] {
  const reportMtime = statSync(reportPath).mtimeMs
  const ignoredDirectories = new Set([
    '.git', 'node_modules', 'dist', 'build', 'out', 'coverage', '.cache', '.vite',
  ])
  const ignoredRootDirectories = new Set(['logs', 'transcripts', '.beegame-attachments'])
  const newerFiles: string[] = []
  const visit = (directory: string): void => {
    let entries: Dirent<string>[]
    try {
      entries = readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) {
        if (
          ignoredDirectories.has(entry.name) ||
          (directory === workspace && ignoredRootDirectories.has(entry.name))
        ) continue
        visit(path)
        continue
      }
      if (!entry.isFile() || path === reportPath) continue
      try {
        if (statSync(path).mtimeMs > reportMtime) newerFiles.push(relative(workspace, path))
      } catch {
        newerFiles.push(relative(workspace, path))
      }
    }
  }
  visit(workspace)
  return newerFiles.length > 0
    ? [`The validation report is stale; project files changed afterward: ${newerFiles.slice(0, 8).join(', ')}${newerFiles.length > 8 ? ', …' : ''}.`]
    : []
}

function safeExistingPath(workspace: string, path: string): boolean {
  if (!path || isAbsolute(path)) return false
  const resolved = resolve(workspace, path)
  const fromWorkspace = relative(workspace, resolved)
  if (fromWorkspace === '..' || fromWorkspace.startsWith('../') || fromWorkspace.startsWith('..\\')) return false
  return existsSync(resolved)
}

function rejected(issue: string): PersistedDeliveryAcceptance {
  return { allowed: false, outcome: 'rejected', issues: [issue] }
}

function recordArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : []
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
