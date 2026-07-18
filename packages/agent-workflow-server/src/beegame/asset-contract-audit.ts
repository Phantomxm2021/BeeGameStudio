import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import {
  RESOURCE_CATEGORIES,
  RESOURCE_SLOT_DELIVERY_MODES,
  RESOURCE_USAGE_TAGS,
} from '../../../beegame-resource-core/src/types'

export type AssetIntegrationStage =
  | 'declared'
  | 'bound'
  | 'copied'
  | 'referenced'
  | 'failed'

export type AssetSlotAudit = {
  id: string
  required: boolean
  deliveryMode: string
  stage: AssetIntegrationStage
  issues: string[]
  files: string[]
  runtimeEventIds: string[]
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
    if (!isRecord(manifest)) {
      return { present: true, valid: false, manifestPath, slots: [], issues: ['Manifest root must be a JSON object.'] }
    }
    const shapeIssues: string[] = []
    if (!isRecord(manifest.project_target)) {
      shapeIssues.push(`project_target must be an object; received ${jsonType(manifest.project_target)}.`)
    }
    if (!Array.isArray(manifest.slots)) {
      shapeIssues.push(`slots must be an array; received ${jsonType(manifest.slots)}.`)
    }
    if (
      isRecord(manifest.project_target) &&
      !Array.isArray(manifest.project_target.asset_format_capabilities)
    ) {
      shapeIssues.push(`project_target.asset_format_capabilities must be an array of strings; received ${jsonType(manifest.project_target.asset_format_capabilities)}.`)
    }
    if (shapeIssues.length > 0) {
      return { present: true, valid: false, manifestPath, slots: [], issues: shapeIssues }
    }
    // The shape checks above narrow these values for runtime use. Keep the
    // canonical contract local to this audit instead of accepting legacy
    // resource_requirements/slot-map variants implicitly.
    const projectTarget = manifest.project_target as Record<string, unknown>
    const manifestSlots = manifest.slots as unknown[]
    const capabilities = new Set(stringArray(projectTarget.asset_format_capabilities).map(normalizeFormat))
    const ids = new Set<string>()
    const issues: string[] = []
    const slots = manifestSlots.map((value, index) => auditSlot(value, index, workspace, capabilities, ids))
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
  if (!isRecord(value)) return {
    id: `slot-${index}`,
    required: true,
    deliveryMode: 'managed-file',
    stage: 'failed',
    files: [],
    runtimeEventIds: [],
    issues: ['Slot must be an object.'],
  }
  const id = normalizedString(value.id) || `slot-${index}`
  const issues: string[] = []
  const required = value.required !== false
  const deliveryMode = normalizedString(value.delivery_mode) || 'managed-file'
  if (!(RESOURCE_SLOT_DELIVERY_MODES as readonly string[]).includes(deliveryMode)) {
    issues.push(`delivery_mode must be one of ${(RESOURCE_SLOT_DELIVERY_MODES as readonly string[]).join(', ')}.`)
  }
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  const target = isRecord(value.target) ? value.target : {}
  const targetPath = normalizedString(target.path)
  if (!targetPath) issues.push('target.path is required.')
  if (targetPath && !isWorkspaceRelativePath(workspace, targetPath)) {
    issues.push(`target.path escapes the project workspace: ${targetPath}`)
  }
  const uploadedFiles = stringArray(value.uploaded_files)
  const files = uploadedFiles
  const safeFiles = files.filter(file => {
    if (!isWorkspaceRelativePath(workspace, file)) {
      issues.push(`File path escapes the project workspace: ${file}`)
      return false
    }
    return true
  })
  const existingFiles = safeFiles.filter(file => existsSync(resolve(workspace, file)))
  const targetExists = Boolean(
    targetPath &&
    isWorkspaceRelativePath(workspace, targetPath) &&
    existsSync(resolve(workspace, targetPath)),
  )
  if (capabilities.size > 0) {
    for (const file of safeFiles) {
      const format = normalizeFormat(extname(file))
      if (format && !capabilities.has(format)) issues.push(`File format is outside project_target capabilities: ${file}`)
    }
  }
  const bound = isRecord(value.resource_binding)
  const requirement = isRecord(value.resource_requirement) ? value.resource_requirement : undefined
  if (deliveryMode === 'managed-file' && requirement && !bound) {
    auditAutomaticSelectionRequirement(requirement, capabilities, issues)
  }
  if (deliveryMode !== 'managed-file' && bound) {
    issues.push(`${deliveryMode} slots must not declare resource_binding provenance.`)
  }
  const copied = deliveryMode === 'managed-file'
    ? safeFiles.length > 0 && existingFiles.length === safeFiles.length
    : targetExists
  const integrationEvidence = isRecord(value.integration_evidence) ? value.integration_evidence : {}
  const references = stringArray(integrationEvidence.references)
  for (const reference of references) {
    if (!isWorkspaceRelativePath(workspace, reference) || !existsSync(resolve(workspace, reference))) {
      issues.push(`Integration reference does not exist in the project: ${reference}`)
    }
  }
  // These IDs are declarations that help the native Validator locate the
  // intended runtime checks. They are not evidence by themselves: a project
  // must not be able to certify its own runtime behavior by writing an ID into
  // its manifest. Runtime proof is accepted only from the observed native
  // Validator result for the current workspace revision.
  const runtimeEventIds = stringArray(integrationEvidence.runtime_event_ids)
  const referenced = copied && references.length > 0
  const declaredIntegrated = value.status === 'integrated'
  if (declaredIntegrated && deliveryMode === 'managed-file' && !bound) {
    issues.push('Integrated managed-file slot has no resource_binding provenance.')
  }
  if (declaredIntegrated && !copied) issues.push('Integrated slot files are missing from the project.')
  if (declaredIntegrated && !referenced) issues.push('Integrated slot has no code/reference evidence.')
  return {
    id,
    required,
    deliveryMode,
    files: safeFiles,
    runtimeEventIds,
    stage: issues.length > 0 && declaredIntegrated
      ? 'failed'
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

function auditAutomaticSelectionRequirement(
  requirement: Record<string, unknown>,
  capabilities: ReadonlySet<string>,
  issues: string[],
): void {
  const category = normalizedString(requirement.category)
  if (!category) {
    issues.push('Unbound resource_requirement.category is required for safe automatic selection.')
  } else if (!(RESOURCE_CATEGORIES as readonly string[]).includes(category)) {
    issues.push(`Unbound resource_requirement.category is not canonical: ${category}`)
  }

  const dimension = normalizedString(requirement.dimension)
  if (!['2D', '3D', 'agnostic'].includes(dimension)) {
    issues.push('Unbound resource_requirement.dimension must be 2D, 3D, or agnostic.')
  }

  const formats = stringArray(requirement.accepted_formats).map(normalizeFormat)
  if (formats.length === 0) {
    issues.push('Unbound resource_requirement.accepted_formats must not be empty.')
  } else if (capabilities.size > 0 && !formats.some(format => capabilities.has(format))) {
    issues.push('Unbound resource_requirement.accepted_formats has no format supported by project_target.')
  }

  const tags = stringArray(requirement.tags)
  if (tags.length === 0) {
    issues.push('Unbound resource_requirement.tags must include at least one canonical usage tag for safe automatic selection.')
  } else {
    const unsupported = tags.filter(tag => !(RESOURCE_USAGE_TAGS as readonly string[]).includes(tag))
    if (unsupported.length > 0) {
      issues.push([
        `Unbound resource_requirement.tags contains unsupported usage tags: ${unsupported.join(', ')}.`,
        `Allowed canonical values: ${(RESOURCE_USAGE_TAGS as readonly string[]).join(', ')}.`,
      ].join(' '))
    }
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

function jsonType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}
