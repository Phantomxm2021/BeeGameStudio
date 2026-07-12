import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'

export type AssetIntegrationStage =
  | 'declared'
  | 'bound'
  | 'copied'
  | 'referenced'
  | 'runtime_loaded'
  | 'failed'

export type AssetSlotAudit = {
  id: string
  stage: AssetIntegrationStage
  issues: string[]
  files: string[]
}

export type AssetContractAudit = {
  present: boolean
  valid: boolean
  manifestPath: string
  slots: AssetSlotAudit[]
  issues: string[]
}

export function auditAssetContract(workspacePath: string): AssetContractAudit {
  const workspace = resolve(workspacePath)
  const manifestPath = resolve(workspace, 'assets', 'asset-manifest.json')
  if (!existsSync(manifestPath)) {
    return { present: false, valid: true, manifestPath, slots: [], issues: [] }
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    if (!isRecord(manifest) || !Array.isArray(manifest.slots) || !isRecord(manifest.project_target)) {
      return { present: true, valid: false, manifestPath, slots: [], issues: ['Manifest must contain project_target and slots.'] }
    }
    const capabilities = new Set(stringArray(manifest.project_target.asset_format_capabilities).map(normalizeFormat))
    const ids = new Set<string>()
    const issues: string[] = []
    const slots = manifest.slots.map((value, index) => auditSlot(value, index, workspace, capabilities, ids))
    for (const slot of slots) issues.push(...slot.issues.map(issue => `${slot.id}: ${issue}`))
    return { present: true, valid: issues.length === 0, manifestPath, slots, issues }
  } catch (error) {
    return {
      present: true,
      valid: false,
      manifestPath,
      slots: [],
      issues: [`Manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function auditSlot(
  value: unknown,
  index: number,
  workspace: string,
  capabilities: Set<string>,
  ids: Set<string>,
): AssetSlotAudit {
  if (!isRecord(value)) return { id: `slot-${index}`, stage: 'failed', files: [], issues: ['Slot must be an object.'] }
  const id = normalizedString(value.id) || `slot-${index}`
  const issues: string[] = []
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  const target = isRecord(value.target) ? value.target : {}
  const targetPath = normalizedString(target.path)
  if (!targetPath) issues.push('target.path is required.')
  const uploadedFiles = stringArray(value.uploaded_files)
  const files = uploadedFiles.length > 0 ? uploadedFiles : targetPath ? [targetPath] : []
  const safeFiles = files.filter(file => {
    if (!isWorkspaceRelativePath(workspace, file)) {
      issues.push(`File path escapes the project workspace: ${file}`)
      return false
    }
    return true
  })
  const existingFiles = safeFiles.filter(file => existsSync(resolve(workspace, file)))
  if (capabilities.size > 0) {
    for (const file of safeFiles) {
      const format = normalizeFormat(extname(file))
      if (format && !capabilities.has(format)) issues.push(`File format is outside project_target capabilities: ${file}`)
    }
  }
  const bound = isRecord(value.resource_binding)
  const copied = safeFiles.length > 0 && existingFiles.length === safeFiles.length
  const integrationEvidence = isRecord(value.integration_evidence) ? value.integration_evidence : {}
  const referenced = copied && stringArray(integrationEvidence.references).length > 0
  const runtimeLoaded = referenced && stringArray(integrationEvidence.runtime_event_ids).length > 0
  const declaredIntegrated = value.status === 'integrated'
  if (declaredIntegrated && !bound) issues.push('Integrated slot has no resource_binding provenance.')
  if (declaredIntegrated && !copied) issues.push('Integrated slot files are missing from the project.')
  if (declaredIntegrated && !referenced) issues.push('Integrated slot has no code/reference evidence.')
  if (declaredIntegrated && !runtimeLoaded) issues.push('Integrated slot has no runtime load evidence.')
  return {
    id,
    files: safeFiles,
    stage: issues.length > 0 && declaredIntegrated
      ? 'failed'
      : runtimeLoaded
        ? 'runtime_loaded'
        : referenced
          ? 'referenced'
          : copied
            ? 'copied'
            : bound
              ? 'bound'
              : 'declared',
    issues,
  }
}

function isWorkspaceRelativePath(workspace: string, value: string): boolean {
  if (!value || isAbsolute(value)) return false
  const resolved = resolve(workspace, value)
  const pathFromWorkspace = relative(workspace, resolved)
  return pathFromWorkspace !== '..' && !pathFromWorkspace.startsWith('../') && !pathFromWorkspace.startsWith('..\\')
}

function normalizeFormat(value: string): string {
  const normalized = value.trim().toLowerCase()
  return normalized.startsWith('.') ? normalized.slice(1) : normalized
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(normalizedString).filter(Boolean)
    : []
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
