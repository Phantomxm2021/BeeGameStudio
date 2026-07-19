import { existsSync, readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_COMPOSITION_KINDS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  LEGACY_RESOURCE_SLOT_DELIVERY_MODES,
  RESOURCE_LIBRARY_USAGE,
  RESOURCE_USAGE_TAGS,
} from '@bee-game-studio/beegame-resource-core'

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
  imports?: AssetImportAudit[]
  compositions: AssetCompositionAudit[]
  issues: string[]
}

export type AssetImportAudit = {
  id: string
  status: string
  rootPath: string
  files: string[]
  issues: string[]
}

export type AssetCompositionAudit = {
  id: string
  kind: string
  status: string
  memberSlotIds: string[]
  issues: string[]
}

export function auditAssetContract(workspacePath: string): AssetContractAudit {
  const workspace = resolve(workspacePath)
  const manifestPath = resolve(workspace, 'assets', 'asset-manifest.json')
  if (!existsSync(manifestPath)) {
    return { present: false, valid: true, manifestPath, slots: [], compositions: [], issues: [] }
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    if (!isRecord(manifest)) {
      return { present: true, valid: false, manifestPath, slots: [], compositions: [], issues: ['Manifest root must be a JSON object.'] }
    }
    if (Array.isArray(manifest.requirements)) {
      return auditCanonicalAssetContract(manifest, workspace, manifestPath)
    }
    const shapeIssues: string[] = []
    if (!isRecord(manifest.project_target)) {
      shapeIssues.push(`project_target must be an object; received ${jsonType(manifest.project_target)}.`)
    }
    if (!Array.isArray(manifest.slots)) {
      shapeIssues.push(`slots must be an array; received ${jsonType(manifest.slots)}.`)
    }
    if (manifest.compositions !== undefined && !Array.isArray(manifest.compositions)) {
      shapeIssues.push(`compositions must be an array; received ${jsonType(manifest.compositions)}.`)
    }
    if (
      isRecord(manifest.project_target) &&
      !Array.isArray(manifest.project_target.asset_format_capabilities)
    ) {
      shapeIssues.push(`project_target.asset_format_capabilities must be an array of strings; received ${jsonType(manifest.project_target.asset_format_capabilities)}.`)
    }
    if (
      isRecord(manifest.project_target) &&
      manifest.project_target.resource_library_usage !== undefined &&
      !RESOURCE_LIBRARY_USAGE.includes(
        manifest.project_target.resource_library_usage as never,
      )
    ) {
      shapeIssues.push(
        `project_target.resource_library_usage must be one of ${RESOURCE_LIBRARY_USAGE.join(', ')}; received ${JSON.stringify(manifest.project_target.resource_library_usage)}.`,
      )
    }
    if (shapeIssues.length > 0) {
      return { present: true, valid: false, manifestPath, slots: [], compositions: [], issues: shapeIssues }
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
    const compositionIds = new Set<string>()
    const compositions = Array.isArray(manifest.compositions)
      ? manifest.compositions.map((value, index) => auditComposition(value, index, workspace, slots, compositionIds))
      : []
    for (const composition of compositions) issues.push(...composition.issues.map(issue => `${composition.id}: ${issue}`))
    return { present: true, valid: issues.length === 0, manifestPath, slots, compositions, issues }
  } catch (error) {
    return {
      present: true,
      valid: false,
      manifestPath,
      slots: [],
      compositions: [],
      issues: [`Manifest could not be parsed: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
}

function auditCanonicalAssetContract(
  manifest: Record<string, unknown>,
  workspace: string,
  manifestPath: string,
): AssetContractAudit {
  const issues: string[] = []
  if (!isRecord(manifest.project_target)) issues.push(`project_target must be an object; received ${jsonType(manifest.project_target)}.`)
  if (!Array.isArray(manifest.imports)) issues.push(`imports must be an array; received ${jsonType(manifest.imports)}.`)
  if (manifest.compositions !== undefined && !Array.isArray(manifest.compositions)) issues.push(`compositions must be an array; received ${jsonType(manifest.compositions)}.`)
  if (issues.length) return { present: true, valid: false, manifestPath, slots: [], imports: [], compositions: [], issues }

  const target = manifest.project_target as Record<string, unknown>
  if (!Array.isArray(target.asset_format_capabilities) || !stringArray(target.asset_format_capabilities).length) {
    issues.push(`project_target.asset_format_capabilities must be a non-empty array of strings; received ${jsonType(target.asset_format_capabilities)}.`)
  }
  if (target.resource_library_usage !== undefined && !RESOURCE_LIBRARY_USAGE.includes(target.resource_library_usage as never)) {
    issues.push(`project_target.resource_library_usage must be one of ${RESOURCE_LIBRARY_USAGE.join(', ')}; received ${JSON.stringify(target.resource_library_usage)}.`)
  }
  const capabilities = new Set(stringArray(target.asset_format_capabilities).map(normalizeFormat))

  const requirementIds = new Set<string>()
  const requirements = (manifest.requirements as unknown[]).map((value, index) => auditCanonicalRequirement(value, index, workspace, capabilities, requirementIds))
  for (const requirement of requirements) issues.push(...requirement.issues.map(issue => `${requirement.id}: ${issue}`))

  const importIds = new Set<string>()
  const imports = (manifest.imports as unknown[]).map((value, index) => auditCanonicalImport(value, index, workspace, importIds))
  for (const resourceImport of imports) issues.push(...resourceImport.issues.map(issue => `${resourceImport.id}: ${issue}`))

  const compositionIds = new Set<string>()
  const compositions = Array.isArray(manifest.compositions)
    ? manifest.compositions.map((value, index) => auditCanonicalComposition(value, index, workspace, requirementIds, new Map(imports.map(entry => [entry.id, entry])), compositionIds))
    : []
  for (const composition of compositions) issues.push(...composition.issues.map(issue => `${composition.id}: ${issue}`))
  const compositionGraph = new Map<string, string[]>()
  for (const [index, value] of ((manifest.compositions as unknown[] | undefined) ?? []).entries()) {
    if (!isRecord(value)) continue
    const id = normalizedString(value.id) || `composition-${index}`
    const nested = (Array.isArray(value.members) ? value.members : [])
      .filter(isRecord)
      .map(member => normalizedString(member.composition_id))
      .filter(Boolean)
    compositionGraph.set(id, nested)
    for (const nestedId of nested) {
      if (!compositionIds.has(nestedId)) issues.push(`${id}: Member references an unknown composition: ${nestedId}`)
      if (nestedId === id) issues.push(`${id}: Composition cannot include itself.`)
    }
  }
  for (const cycle of compositionCycles(compositionGraph)) issues.push(`Composition cycle is not allowed: ${cycle.join(' -> ')}`)

  const importsById = new Map(imports.map(resourceImport => [resourceImport.id, resourceImport]))
  const compositionsById = new Map(compositions.map(composition => [composition.id, composition]))
  for (const [index, value] of (manifest.requirements as unknown[]).entries()) {
    if (!isRecord(value)) continue
    const id = normalizedString(value.id) || `requirement-${index}`
    const satisfiedBy = isRecord(value.satisfied_by) ? value.satisfied_by : undefined
    for (const importId of stringArray(satisfiedBy?.import_ids)) {
      if (!importIds.has(importId)) issues.push(`${id}: satisfied_by references an unknown import: ${importId}`)
      else if (value.status === 'satisfied' && importsById.get(importId)?.status !== 'referenced') issues.push(`${id}: A copied import cannot satisfy a requirement until project usage is evidenced: ${importId}`)
    }
    for (const compositionId of stringArray(satisfiedBy?.composition_ids)) {
      if (!compositionIds.has(compositionId)) issues.push(`${id}: satisfied_by references an unknown composition: ${compositionId}`)
      else if (value.status === 'satisfied' && compositionsById.get(compositionId)?.status !== 'integrated') issues.push(`${id}: A composition cannot satisfy a requirement until target-native integration is evidenced: ${compositionId}`)
    }
    if (value.status === 'satisfied' && !stringArray(satisfiedBy?.import_ids).length && !stringArray(satisfiedBy?.composition_ids).length && !stringArray(satisfiedBy?.project_references).length) {
      issues.push(`${id}: A satisfied requirement must identify an import, composition, or project reference.`)
    }
  }

  return { present: true, valid: issues.length === 0, manifestPath, slots: requirements, imports, compositions, issues }
}

function auditCanonicalRequirement(value: unknown, index: number, workspace: string, capabilities: ReadonlySet<string>, ids: Set<string>): AssetSlotAudit {
  if (!isRecord(value)) return { id: `requirement-${index}`, required: true, deliveryMode: 'requirement', stage: 'failed', issues: ['Requirement must be an object.'], files: [], runtimeEventIds: [] }
  const id = normalizedString(value.id) || `requirement-${index}`
  const issues: string[] = []
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  if (value.resource_requirement !== undefined && !isRecord(value.resource_requirement)) issues.push('resource_requirement must be an object when present.')
  else if (isRecord(value.resource_requirement)) auditResourceExplorationRequirement(value.resource_requirement, capabilities, issues)
  if (!['planned', 'satisfied', 'blocked'].includes(normalizedString(value.status) || 'planned')) issues.push('status must be planned, satisfied, or blocked.')
  const satisfiedBy = isRecord(value.satisfied_by) ? value.satisfied_by : undefined
  const files = stringArray(satisfiedBy?.project_references)
  for (const path of files) if (!isWorkspaceRelativePath(workspace, path) || !existsSync(resolve(workspace, path))) issues.push(`Project reference does not exist: ${path}`)
  const status = normalizedString(value.status) || 'planned'
  return { id, required: value.required !== false, deliveryMode: 'requirement', stage: status === 'satisfied' ? 'referenced' : status === 'blocked' ? 'failed' : 'declared', issues, files, runtimeEventIds: [] }
}

function auditCanonicalImport(value: unknown, index: number, workspace: string, ids: Set<string>): AssetImportAudit {
  if (!isRecord(value)) return { id: `import-${index}`, status: 'failed', rootPath: '', files: [], issues: ['Import must be an object.'] }
  const id = normalizedString(value.id) || `import-${index}`
  const status = normalizedString(value.status) || 'available'
  const rootPath = normalizedString(value.root_path)
  const files = stringArray(value.local_files)
  const source = isRecord(value.source) ? value.source : undefined
  const issues: string[] = []
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  if (!source || !['resource-library', 'user-upload', 'project-authored'].includes(normalizedString(source.type))) issues.push('source.type is invalid.')
  if (source?.type === 'resource-library' && (!normalizedString(source.pack_id) || !normalizedString(source.pack_version) || !normalizedString(source.element_id) || !normalizedString(source.element_path))) issues.push('Resource Library source provenance is incomplete.')
  if (source?.type === 'resource-library' && !stringArray(value.selection_reason).length) issues.push('Resource Library import must retain its authored selection_reason.')
  if (value.technical_facts !== undefined && !isPrimitiveRecord(value.technical_facts)) issues.push('technical_facts must contain only finite primitive source-file facts.')
  if (!['available', 'referenced', 'failed'].includes(status)) issues.push('status must be available, referenced, or failed.')
  if (!rootPath) issues.push('root_path is required.')
  if (!files.length) issues.push('local_files must contain the imported root.')
  if (rootPath && !files.includes(rootPath)) issues.push('local_files must include root_path.')
  for (const path of files) if (!isWorkspaceRelativePath(workspace, path) || ((status === 'available' || status === 'referenced') && !existsSync(resolve(workspace, path)))) issues.push(`Imported file does not exist: ${path}`)
  const dependencies = Array.isArray(value.dependencies) ? value.dependencies : []
  for (const [dependencyIndex, dependency] of dependencies.entries()) {
    if (!isRecord(dependency)) { issues.push(`Dependency ${dependencyIndex + 1} must be an object.`); continue }
    const localPath = normalizedString(dependency.local_path)
    if (!localPath) issues.push(`Dependency ${dependencyIndex + 1} local_path is required.`)
    else if (!files.includes(localPath)) issues.push(`Dependency ${dependencyIndex + 1} local_path must be listed in local_files: ${localPath}`)
  }
  const evidence = isRecord(value.usage_evidence) ? value.usage_evidence : undefined
  const evidenceReferences = stringArray(evidence?.references)
  const runtimeEventIds = stringArray(evidence?.runtime_event_ids)
  for (const reference of evidenceReferences) if (!isWorkspaceRelativePath(workspace, reference) || !existsSync(resolve(workspace, reference))) issues.push(`Usage reference does not exist in the project: ${reference}`)
  if (status === 'referenced' && !evidenceReferences.length && !runtimeEventIds.length) issues.push('A referenced import must include usage_evidence.')
  return { id, status, rootPath, files, issues }
}

function isPrimitiveRecord(value: unknown): value is Record<string, string | number | boolean> {
  return isRecord(value) && Object.values(value).every(item => typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)))
}

function auditCanonicalComposition(
  value: unknown,
  index: number,
  workspace: string,
  requirementIds: ReadonlySet<string>,
  imports: ReadonlyMap<string, AssetImportAudit>,
  ids: Set<string>,
): AssetCompositionAudit {
  if (!isRecord(value)) return { id: `composition-${index}`, kind: '', status: 'failed', memberSlotIds: [], issues: ['Composition must be an object.'] }
  const id = normalizedString(value.id) || `composition-${index}`
  const kind = normalizedString(value.kind)
  const status = normalizedString(value.status) || 'planned'
  const assemblyMode = normalizedString(value.assembly_mode) || 'composed'
  const issues: string[] = []
  const memberIds: string[] = []
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  if (!(RESOURCE_COMPOSITION_KINDS as readonly string[]).includes(kind)) issues.push(`kind must be one of ${(RESOURCE_COMPOSITION_KINDS as readonly string[]).join(', ')}.`)
  if (!['planned', 'assembled', 'integrated', 'failed'].includes(status)) issues.push('status must be planned, assembled, integrated, or failed.')
  if (!['direct', 'composed'].includes(assemblyMode)) issues.push('assembly_mode must be direct or composed.')
  const members = Array.isArray(value.members) ? value.members : []
  if (!members.length) issues.push('At least one member is required.')
  if (assemblyMode === 'direct' && (members.length !== 1 || !isRecord(members[0]) || !normalizedString(members[0].import_id))) issues.push('A direct composition must contain exactly one imported logical root.')
  for (const [memberIndex, member] of members.entries()) {
    if (!isRecord(member)) { issues.push(`Member ${memberIndex + 1} must be an object.`); continue }
    const importId = normalizedString(member.import_id)
    const requirementId = normalizedString(member.requirement_id)
    const compositionId = normalizedString(member.composition_id)
    const referenceCount = [importId, requirementId, compositionId].filter(Boolean).length
    if (referenceCount !== 1) issues.push(`Member ${memberIndex + 1} must reference exactly one import_id, requirement_id, or composition_id.`)
    if (!normalizedString(member.role)) issues.push(`Member ${memberIndex + 1} role is required.`)
    if (importId) {
      memberIds.push(importId)
      const resourceImport = imports.get(importId)
      if (!resourceImport) issues.push(`Member references an unknown import: ${importId}`)
      if (status === 'integrated' && member.required !== false && resourceImport?.status !== 'referenced') issues.push(`Integrated composition member has no usage evidence: ${importId}`)
    }
    if (requirementId && !requirementIds.has(requirementId)) issues.push(`Member references an unknown requirement: ${requirementId}`)
  }
  const recipe = isRecord(value.recipe) ? value.recipe : undefined
  const recipePath = normalizedString(recipe?.path)
  if ((status === 'assembled' || status === 'integrated') && !recipePath) issues.push('Assembled composition must declare its target-native recipe.path.')
  if (recipePath && (!isWorkspaceRelativePath(workspace, recipePath) || !existsSync(resolve(workspace, recipePath)))) issues.push(`recipe.path does not exist in the project: ${recipePath}`)
  const evidence = isRecord(value.integration_evidence) ? value.integration_evidence : undefined
  const evidenceReferences = stringArray(evidence?.references)
  const runtimeEventIds = stringArray(evidence?.runtime_event_ids)
  for (const reference of evidenceReferences) if (!isWorkspaceRelativePath(workspace, reference) || !existsSync(resolve(workspace, reference))) issues.push(`Integration reference does not exist in the project: ${reference}`)
  if (status === 'integrated' && !evidenceReferences.length && !runtimeEventIds.length) issues.push('An integrated composition must include integration_evidence.')
  return { id, kind, status, memberSlotIds: memberIds, issues }
}

function compositionCycles(graph: ReadonlyMap<string, string[]>): string[][] {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const active = new Set<string>()
  const path: string[] = []
  const visit = (id: string) => {
    if (active.has(id)) {
      const start = path.indexOf(id)
      cycles.push([...path.slice(Math.max(0, start)), id])
      return
    }
    if (visited.has(id)) return
    active.add(id)
    path.push(id)
    for (const next of graph.get(id) ?? []) if (graph.has(next)) visit(next)
    path.pop()
    active.delete(id)
    visited.add(id)
  }
  for (const id of graph.keys()) visit(id)
  return cycles
}

function auditComposition(
  value: unknown,
  index: number,
  workspace: string,
  slots: AssetSlotAudit[],
  ids: Set<string>,
): AssetCompositionAudit {
  if (!isRecord(value)) return { id: `composition-${index}`, kind: '', status: 'failed', memberSlotIds: [], issues: ['Composition must be an object.'] }
  const id = normalizedString(value.id) || `composition-${index}`
  const kind = normalizedString(value.kind)
  const status = normalizedString(value.status) || 'planned'
  const assemblyMode = normalizedString(value.assembly_mode) || 'composed'
  const issues: string[] = []
  if (!normalizedString(value.id)) issues.push('Stable id is required.')
  if (ids.has(id)) issues.push('Stable id is duplicated.')
  ids.add(id)
  if (!(RESOURCE_COMPOSITION_KINDS as readonly string[]).includes(kind)) {
    issues.push(`kind must be one of ${(RESOURCE_COMPOSITION_KINDS as readonly string[]).join(', ')}.`)
  }
  if (!['planned', 'assembled', 'integrated', 'failed'].includes(status)) {
    issues.push('status must be planned, assembled, integrated, or failed.')
  }
  if (!['direct', 'composed'].includes(assemblyMode)) issues.push('assembly_mode must be direct or composed.')
  const members = Array.isArray(value.members) ? value.members : []
  if (!members.length) issues.push('At least one member is required.')
  if (assemblyMode === 'direct' && members.length !== 1) issues.push('A direct composition must contain exactly one member slot.')
  const knownSlots = new Map(slots.map(slot => [slot.id, slot]))
  const memberSlotIds: string[] = []
  for (const [memberIndex, member] of members.entries()) {
    if (!isRecord(member)) {
      issues.push(`Member ${memberIndex + 1} must be an object.`)
      continue
    }
    const slotId = normalizedString(member.slot_id)
    const role = normalizedString(member.role)
    if (!slotId) issues.push(`Member ${memberIndex + 1} slot_id is required.`)
    if (!role) issues.push(`Member ${memberIndex + 1} role is required.`)
    if (slotId) {
      memberSlotIds.push(slotId)
      const slot = knownSlots.get(slotId)
      if (!slot) issues.push(`Member references an unknown slot: ${slotId}`)
      if ((status === 'assembled' || status === 'integrated') && member.required !== false && slot?.stage !== 'referenced') {
        issues.push(`Required member is not referenced by the project: ${slotId}`)
      }
    }
  }
  const recipe = isRecord(value.recipe) ? value.recipe : undefined
  const recipePath = normalizedString(recipe?.path)
  if (recipePath && (!isWorkspaceRelativePath(workspace, recipePath) || !existsSync(resolve(workspace, recipePath)))) {
    issues.push(`recipe.path does not exist in the project: ${recipePath}`)
  }
  if (assemblyMode === 'composed' && (status === 'assembled' || status === 'integrated') && !recipePath) {
    issues.push('Assembled composition must declare recipe.path.')
  }
  const evidence = isRecord(value.integration_evidence) ? value.integration_evidence : undefined
  for (const reference of stringArray(evidence?.references)) {
    if (!isWorkspaceRelativePath(workspace, reference) || !existsSync(resolve(workspace, reference))) {
      issues.push(`Integration reference does not exist in the project: ${reference}`)
    }
  }
  return { id, kind, status, memberSlotIds, issues }
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
  if (!(LEGACY_RESOURCE_SLOT_DELIVERY_MODES as readonly string[]).includes(deliveryMode)) {
    issues.push(`delivery_mode must be one of ${(LEGACY_RESOURCE_SLOT_DELIVERY_MODES as readonly string[]).join(', ')}.`)
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
    auditResourceExplorationRequirement(requirement, capabilities, issues)
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

function auditResourceExplorationRequirement(
  requirement: Record<string, unknown>,
  capabilities: ReadonlySet<string>,
  issues: string[],
): void {
  const category = normalizedString(requirement.category)
  if (category && !(RESOURCE_CATEGORIES as readonly string[]).includes(category)) {
    issues.push(`Unbound resource_requirement.category is not canonical: ${category}`)
  }

  const dimension = normalizedString(requirement.dimension)
  if (dimension && !['2D', '3D', 'agnostic'].includes(dimension)) {
    issues.push('Unbound resource_requirement.dimension must be 2D, 3D, or agnostic.')
  }

  const formats = stringArray(requirement.accepted_formats).map(normalizeFormat)
  if (formats.length === 0) {
    issues.push('Unbound resource_requirement.accepted_formats must not be empty.')
  } else if (capabilities.size > 0 && !formats.some(format => capabilities.has(format))) {
    issues.push('Unbound resource_requirement.accepted_formats has no format supported by project_target.')
  }

  const tags = stringArray(requirement.tags)
  if (tags.length > 0) {
    const unsupported = tags.filter(tag => !(RESOURCE_USAGE_TAGS as readonly string[]).includes(tag))
    if (unsupported.length > 0) {
      issues.push([
        `Unbound resource_requirement.tags contains unsupported usage tags: ${unsupported.join(', ')}.`,
        `Allowed canonical values: ${(RESOURCE_USAGE_TAGS as readonly string[]).join(', ')}.`,
      ].join(' '))
    }
  }

  const assetKinds = stringArray(requirement.asset_kinds)
  const unsupportedAssetKinds = assetKinds.filter(kind => !(RESOURCE_ASSET_KINDS as readonly string[]).includes(kind))
  if (unsupportedAssetKinds.length) issues.push(`Unbound resource_requirement.asset_kinds contains unsupported values: ${unsupportedAssetKinds.join(', ')}.`)

  const requiredCapabilities = stringArray(requirement.capabilities)
  const unsupportedCapabilities = requiredCapabilities.filter(capability => !(RESOURCE_CAPABILITIES as readonly string[]).includes(capability))
  if (unsupportedCapabilities.length) issues.push(`Unbound resource_requirement.capabilities contains unsupported values: ${unsupportedCapabilities.join(', ')}.`)

  if (requirement.subresources !== undefined && !Array.isArray(requirement.subresources)) {
    issues.push('Unbound resource_requirement.subresources must be an array.')
  } else {
    for (const [index, component] of (requirement.subresources as unknown[] | undefined ?? []).entries()) {
      if (!isRecord(component) || !(RESOURCE_EMBEDDED_COMPONENT_KINDS as readonly string[]).includes(normalizedString(component.kind))) {
        issues.push(`Unbound resource_requirement.subresources[${index}] is invalid.`)
      }
    }
  }

  if (requirement.relations !== undefined && !Array.isArray(requirement.relations)) {
    issues.push('Unbound resource_requirement.relations must be an array.')
  } else {
    for (const [index, relation] of (requirement.relations as unknown[] | undefined ?? []).entries()) {
      if (!isRecord(relation) || !(RESOURCE_RELATION_KINDS as readonly string[]).includes(normalizedString(relation.kind))) {
        issues.push(`Unbound resource_requirement.relations[${index}] is invalid.`)
      }
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
