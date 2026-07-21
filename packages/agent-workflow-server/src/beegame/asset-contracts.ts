import { existsSync, readFileSync } from 'node:fs'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import {
  RESOURCE_ASSET_KINDS,
  RESOURCE_CAPABILITIES,
  RESOURCE_CATEGORIES,
  RESOURCE_COMPOSITION_KINDS,
  RESOURCE_EMBEDDED_COMPONENT_KINDS,
  RESOURCE_RELATION_KINDS,
  RESOURCE_LIBRARY_USAGE,
  RESOURCE_USAGE_TAGS,
  type ResourceAssetKind,
  type ResourceCapability,
  type ResourceCompositionKind,
  type ResourceEmbeddedComponentKind,
  type ResourceRelationKind,
  type ResourceLibraryUsage,
  type ResourceUsageTag,
} from '@bee-game-studio/beegame-resource-core'

export type BeeGameAssetIntegrationMode = 'filesystem' | 'mcp' | 'manual'

export type BeeGameAssetProjectTarget = {
  platform?: string
  runtime?: string
  integration_mode?: BeeGameAssetIntegrationMode
  mcp_server?: string
  /** Formats supported by the project target, never inferred from a Pack. */
  asset_format_capabilities?: string[]
  /** Availability preference supplied to the authoring Agent, not a selector state machine. */
  resource_library_usage?: ResourceLibraryUsage
  /**
   * Project-relative directory consumed by the target-native asset pipeline.
   * Claude Code derives this from the selected project/toolchain. BeeGame only
   * keeps Resource Library imports inside it; it never assumes a platform.
   */
  runtime_asset_root?: string
}

export type BeeGameResourceImportDependency = {
  key: string
  parent_key: string
  element_id: string
  element_path: string
  reference_path: string
  local_path: string
  kind?: string
}

/**
 * One independently imported Resource Library root. Imports are project
 * inventory, not requirement fulfillment records: the same import may be used
 * by several target-native compositions and one composition may use many
 * imports.
 */
export type BeeGameResourceImport = {
  id: string
  source: {
    type: 'resource-library' | 'user-upload' | 'project-authored'
    pack_id?: string
    pack_version?: string
    element_id?: string
    element_path?: string
  }
  status: 'available' | 'referenced' | 'failed'
  root_path: string
  local_files: string[]
  selected_at: string
  selection_reason: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  /** Objective source-file facts. Target-native importers own their interpretation. */
  technical_facts?: Record<string, string | number | boolean>
  dependencies?: BeeGameResourceImportDependency[]
  usage_evidence?: { references?: string[]; runtime_event_ids?: string[] }
  error?: string
}

/**
 * The machine-readable matching contract for one project asset slot. This is
 * deliberately independent of the project's target engine: the project target
 * declares what it can consume, while selection stays deterministic.
 */
export type BeeGameResourceRequirement = {
  category?: string
  dimension?: '2D' | '3D' | 'agnostic'
  accepted_formats?: string[]
  styles?: string[]
  game_types?: string[]
  tags?: ResourceUsageTag[]
  asset_kinds?: ResourceAssetKind[]
  capabilities?: ResourceCapability[]
  subresources?: BeeGameSubresourceRequirement[]
  relations?: BeeGameResourceRelationRequirement[]
  purpose?: string
}

export type BeeGameSubresourceRequirement = {
  kind: ResourceEmbeddedComponentKind
  role?: string
  skeleton_signature?: string
}

export type BeeGameResourceRelationRequirement = {
  kind: ResourceRelationKind
  /** Resolve against a resource already pinned in this project. */
  target_element_id?: string
  role?: string
}

export function effectiveAssetFormats(
  requirement: Pick<BeeGameAssetRequirement, 'resource_requirement'>,
  target?: BeeGameAssetProjectTarget,
): string[] {
  const requirementFormats = normalizeFormats(requirement.resource_requirement?.accepted_formats)
  const runtimeFormats = normalizeFormats(target?.asset_format_capabilities)
  // A Pack can contain files for several engines. A project must therefore
  // declare the formats its own target can consume before it is
  // allowed to select or copy library content. Slot formats further narrow
  // that target contract; they never broaden it.
  if (!runtimeFormats.length) return []
  return requirementFormats.length
    ? requirementFormats.filter(format => runtimeFormats.includes(format))
    : runtimeFormats
}

export type BeeGameAssetRequirement = {
  id: string
  name?: string
  purpose?: string
  required?: boolean
  resource_requirement?: BeeGameResourceRequirement
  satisfied_by?: { import_ids?: string[]; composition_ids?: string[]; project_references?: string[] }
  status?: 'planned' | 'satisfied' | 'blocked'
}

export type BeeGameAssetCompositionMember = {
  /** Independent imported asset used by the target-native recipe. */
  import_id?: string
  /** Project requirement satisfied or represented by this member. */
  requirement_id?: string
  /** Nested target-native composition. */
  composition_id?: string
  role: string
  required?: boolean
}

export type BeeGameAssetComposition = {
  id: string
  kind: ResourceCompositionKind
  required?: boolean
  members: BeeGameAssetCompositionMember[]
  assembly_mode?: 'direct' | 'composed'
  recipe?: { path?: string; notes?: string }
  status?: 'planned' | 'assembled' | 'integrated' | 'failed'
  integration_evidence?: { references?: string[]; runtime_event_ids?: string[] }
}

export type BeeGameAssetManifest = {
  version: number
  project_target?: BeeGameAssetProjectTarget
  /** Game responsibilities. Independent imports may satisfy several requirements. */
  requirements: BeeGameAssetRequirement[]
  /** Independent project inventory selected by Claude Code. */
  imports?: BeeGameResourceImport[]
  compositions?: BeeGameAssetComposition[]
}

export type BeeGameAssetUploadResult = {
  manifest: BeeGameAssetManifest
  requirement: BeeGameAssetRequirement
  path: string
  message: string
}

const ASSET_MANIFEST_PATH = 'assets/asset-manifest.json'
export const CURRENT_ASSET_MANIFEST_VERSION = 5

export class BeeGameAssetManifestError extends Error {
  readonly code = 'invalid_asset_manifest'

  constructor(readonly issues: string[]) {
    super(`Invalid canonical asset manifest: ${issues.join(' ')}`)
    this.name = 'BeeGameAssetManifestError'
  }
}

/**
 * The single authoring example exposed to Claude Code. It intentionally
 * describes responsibilities, imported inventory, and target-native
 * compositions as separate concepts. BeeGame validates these facts but does
 * not decide which resources to use or how the target project assembles them.
 */
export const CANONICAL_ASSET_MANIFEST_EXAMPLE = {
  version: CURRENT_ASSET_MANIFEST_VERSION,
  project_target: {
    asset_format_capabilities: ['<actual-file-extension-consumable-by-target>'],
    resource_library_usage: 'preferred',
    runtime_asset_root: '<workspace-relative-target-native-asset-root>',
  },
  requirements: [{
    id: '<stable-game-responsibility-id>',
    required: true,
    status: 'planned',
    resource_requirement: {
      accepted_formats: ['<actual-file-extension>'],
      purpose: '<authored-game-purpose>',
    },
    satisfied_by: {
      import_ids: [],
      composition_ids: [],
      project_references: [],
    },
  }],
  imports: [{
    id: '<stable-import-id>',
    source: {
      type: 'resource-library',
      pack_id: '<pack-id>',
      pack_version: '<locked-version>',
      element_id: '<element-id>',
      element_path: '<immutable-source-path>',
    },
    status: 'available',
    root_path: '<workspace-relative-import-root>',
    local_files: ['<workspace-relative-import-root>'],
    selected_at: '<iso-timestamp>',
    selection_reason: ['<authored-reason>'],
  }],
  compositions: [{
    id: '<stable-composition-id>',
    kind: 'scene',
    assembly_mode: 'composed',
    status: 'planned',
    members: [{ import_id: '<stable-import-id>', role: '<target-native-role>' }],
    recipe: { path: '<workspace-relative-target-native-recipe>' },
  }],
} as const

export async function readBeeGameAssetManifest(
  workspacePath: string,
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  if (!existsSync(manifestPath)) {
    return { version: CURRENT_ASSET_MANIFEST_VERSION, requirements: [] }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new BeeGameAssetManifestError(['manifest must contain valid JSON.'])
  }
  return reconcileAssetContractFiles(root, parseCanonicalBeeGameAssetManifest(parsed))
}

export async function uploadBeeGameAsset(
  workspacePath: string,
  requirementId: string,
  file: File,
): Promise<BeeGameAssetUploadResult> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedRequirementId = normalizeImportId(requirementId)
  const requirementIndex = manifest.requirements.findIndex(requirement => requirement.id === normalizedRequirementId)
  if (requirementIndex < 0) throw new Error(`Asset requirement not found: ${normalizedRequirementId}`)
  const requirement = manifest.requirements[requirementIndex]!
  assertAssetFormatAllowed(file.name, requirement, manifest.project_target)
  const targetPath = resolveUploadTarget(root, requirement, file.name, manifest.project_target)
  await mkdir(resolve(targetPath, '..'), { recursive: true })
  const bytes = new Uint8Array(await file.arrayBuffer())
  await writeFile(targetPath, bytes)
  const relativePath = normalizeRelativePath(root, targetPath)
  const importId = `upload.${normalizeImportId(requirement.id)}`
  const resourceImport: BeeGameResourceImport = {
    id: importId,
    source: { type: 'user-upload' },
    status: 'available',
    root_path: relativePath,
    local_files: [relativePath],
    selected_at: new Date().toISOString(),
    selection_reason: ['user-provided-for-requirement'],
  }
  const updatedRequirement: BeeGameAssetRequirement = {
    ...requirement,
    status: 'planned',
    satisfied_by: {
      ...(requirement.satisfied_by ?? {}),
      import_ids: [...new Set([...(requirement.satisfied_by?.import_ids ?? []).filter(id => id !== importId), importId])],
    },
  }
  manifest.requirements[requirementIndex] = updatedRequirement
  manifest.imports = [...(manifest.imports ?? []).filter(entry => entry.id !== importId), resourceImport]
  await writeAssetManifest(root, manifest)
  return {
    manifest,
    requirement: updatedRequirement,
    path: relativePath,
    message: buildUploadMessage(updatedRequirement, relativePath),
  }
}

export type BeeGameResolvedResourceImportInput = {
  id: string
  destination_path: string
  pack_id: string
  pack_version: string
  element_id: string
  element_path: string
  source_url: string
  selection_reason?: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  dependencies?: Array<{
    key: string
    parent_key: string
    element_id: string
    element_path: string
    reference_path: string
    source_url: string
    kind?: string
  }>
}

/**
 * Copy one explicitly chosen logical root into the project inventory. No
 * requirement or slot is involved; Claude Code decides where and how the
 * resulting import is used by target-native scene/code authoring.
 */
export async function importBeeGameLibraryResourceInWorkspace(
  workspacePath: string,
  input: BeeGameResolvedResourceImportInput,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ manifest: BeeGameAssetManifest; resourceImport: BeeGameResourceImport }> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const importId = normalizeImportId(input.id)
  if (!importId) throw new Error('Resource import id is required')
  const existingImport = (manifest.imports ?? []).find(entry => entry.id === importId)
  if (existingImport && !isSamePinnedLibraryImport(existingImport, input)) {
    throw new Error(`Resource import id belongs to a different pinned resource: ${importId}`)
  }
  const filename = sanitizeFilename(input.element_path)
  assertFilenameFormatAllowed(filename, normalizeFormats(manifest.project_target?.asset_format_capabilities))
  const targetPath = resolveImportTarget(root, input.destination_path, filename)
  assertImportInsideRuntimeAssetRoot(root, targetPath, manifest.project_target)
  const rootPath = normalizeRelativePath(root, targetPath)
  if (existingImport && existingImport.root_path !== rootPath) {
    throw new Error(`Resource import destination differs from its pinned project path: ${importId}`)
  }
  if (existsSync(targetPath) && !existingImport) {
    throw new Error(`Resource import target already exists: ${rootPath}`)
  }

  const response = await fetchImpl(input.source_url)
  if (!response.ok) throw new Error(`Resource download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const declaredFormat = extensionOf(filename)
  const detectedFormat = detectResourceBinaryFormat(bytes)
  if (detectedFormat && declaredFormat && !formatsAgree(declaredFormat, detectedFormat)) {
    throw new Error(`Resource binary format mismatch: library declares .${declaredFormat}, received ${detectedFormat}`)
  }
  let writeRoot = true
  if (existingImport && existsSync(targetPath)) {
    const existingBytes = await readExistingResourceFile(targetPath, root)
    if (existingBytes.byteLength > 0 && !bytesEqual(existingBytes, bytes)) {
      throw new Error(`Pinned resource file was modified locally and will not be overwritten: ${rootPath}`)
    }
    writeRoot = existingBytes.byteLength === 0
  }

  const pendingDependencies = await prepareBoundResourceDependencies(
    root,
    targetPath,
    input,
    fetchImpl,
    normalizeFormats(manifest.project_target?.asset_format_capabilities),
  )
  const allTargets = [targetPath, ...pendingDependencies.map(dependency => dependency.targetPath)]
  const duplicateTarget = allTargets.find((target, index) => allTargets.indexOf(target) !== index)
  if (duplicateTarget) throw new Error(`Resource import dependency target is duplicated: ${normalizeRelativePath(root, duplicateTarget)}`)
  const dependenciesToWrite: typeof pendingDependencies = []
  for (const dependency of pendingDependencies) {
    if (!existsSync(dependency.targetPath)) {
      dependenciesToWrite.push(dependency)
      continue
    }
    const existingBytes = new Uint8Array(await readFile(dependency.targetPath))
    if (!bytesEqual(existingBytes, dependency.bytes)) {
      throw new Error(`Resource import dependency target already exists with different content: ${normalizeRelativePath(root, dependency.targetPath)}`)
    }
  }

  const rollbackFiles = await commitResourceWrites([
    ...(writeRoot ? [{ targetPath, bytes }] : []),
    ...dependenciesToWrite.map(dependency => ({ targetPath: dependency.targetPath, bytes: dependency.bytes })),
  ])
  const dependencies = (input.dependencies ?? []).map(dependency => {
    const copied = pendingDependencies.find(candidate => candidate.key === dependency.key)
    return {
      key: dependency.key,
      parent_key: dependency.parent_key,
      element_id: dependency.element_id,
      element_path: dependency.element_path,
      reference_path: dependency.reference_path,
      local_path: copied ? normalizeRelativePath(root, copied.targetPath) : normalizeRelativePath(root, resolveDependencyTarget(root, dirname(targetPath), dependency.reference_path)),
      ...(dependency.kind ? { kind: dependency.kind } : {}),
    }
  })
  const resourceImport: BeeGameResourceImport = {
    id: importId,
    source: {
      type: 'resource-library',
      pack_id: input.pack_id,
      pack_version: input.pack_version,
      element_id: input.element_id,
      element_path: input.element_path,
    },
    status: existingImport?.status === 'referenced' ? 'referenced' : 'available',
    root_path: rootPath,
    local_files: [rootPath, ...pendingDependencies.map(dependency => normalizeRelativePath(root, dependency.targetPath))],
    selected_at: new Date().toISOString(),
    selection_reason: input.selection_reason ?? [],
    ...(input.asset_kind ? { asset_kind: input.asset_kind } : {}),
    ...(input.capabilities?.length ? { capabilities: input.capabilities } : {}),
    ...(input.content_profile ? { content_profile: input.content_profile } : {}),
    ...(input.technical_facts ? { technical_facts: input.technical_facts } : {}),
    ...(dependencies.length ? { dependencies } : {}),
    ...(existingImport?.usage_evidence ? { usage_evidence: existingImport.usage_evidence } : {}),
  }
  const updatedManifest: BeeGameAssetManifest = {
    ...manifest,
    version: Math.max(CURRENT_ASSET_MANIFEST_VERSION, manifest.version),
    imports: [...(manifest.imports ?? []).filter(entry => entry.id !== importId), resourceImport],
  }
  try {
    await writeAssetManifest(root, updatedManifest)
  } catch (error) {
    await rollbackFiles()
    throw error
  }
  return { manifest: updatedManifest, resourceImport }
}

export type BeeGameResolvedResourceMetadataUpdate = {
  import_id: string
  pack_id: string
  pack_version: string
  element_id: string
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
}

/**
 * Refresh objective catalog metadata for roots that are already present in a
 * project. This never selects a replacement, downloads a file, changes usage
 * evidence, or interprets target-runtime settings.
 */
export async function refreshBeeGameLibraryImportMetadataInWorkspace(
  workspacePath: string,
  updates: readonly BeeGameResolvedResourceMetadataUpdate[],
): Promise<{ manifest: BeeGameAssetManifest; refreshedImportIds: string[] }> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const updatesById = new Map(updates.map(update => [update.import_id, update]))
  const refreshedImportIds: string[] = []
  const imports = (manifest.imports ?? []).map(resourceImport => {
    const update = updatesById.get(resourceImport.id)
    if (!update || resourceImport.source.type !== 'resource-library') return resourceImport
    if (
      resourceImport.source.pack_id !== update.pack_id ||
      resourceImport.source.pack_version !== update.pack_version ||
      resourceImport.source.element_id !== update.element_id
    ) return resourceImport
    refreshedImportIds.push(resourceImport.id)
    return {
      ...resourceImport,
      ...(update.asset_kind ? { asset_kind: update.asset_kind } : {}),
      ...(update.capabilities ? { capabilities: [...update.capabilities] } : {}),
      ...(update.content_profile ? { content_profile: update.content_profile } : {}),
      ...(update.technical_facts ? { technical_facts: { ...update.technical_facts } } : {}),
    }
  })
  const updatedManifest = { ...manifest, imports }
  if (refreshedImportIds.length) await writeAssetManifest(root, updatedManifest)
  return { manifest: updatedManifest, refreshedImportIds }
}

function isSamePinnedLibraryImport(
  resourceImport: BeeGameResourceImport,
  input: BeeGameResolvedResourceImportInput,
): boolean {
  return resourceImport.source.type === 'resource-library' &&
    resourceImport.source.pack_id === input.pack_id &&
    resourceImport.source.pack_version === input.pack_version &&
    resourceImport.source.element_id === input.element_id &&
    resourceImport.source.element_path === input.element_path
}

async function readExistingResourceFile(path: string, root: string): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    throw new Error(`Pinned resource path is not a readable file: ${normalizeRelativePath(root, path)}`)
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function prepareBoundResourceDependencies(
  root: string,
  rootTargetPath: string,
  resource: Pick<BeeGameResolvedResourceImportInput, 'dependencies'>,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  allowedFormats: readonly string[],
): Promise<Array<{ key: string; targetPath: string; bytes: Uint8Array }>> {
  const targets = new Map<string, string>([['root', rootTargetPath]])
  const pending: Array<{ key: string; targetPath: string; bytes: Uint8Array }> = []
  for (const dependency of resource.dependencies ?? []) {
    assertFilenameFormatAllowed(dependency.element_path, allowedFormats)
    const parentTarget = targets.get(dependency.parent_key)
    if (!parentTarget) throw new Error(`Resource dependency parent is missing: ${dependency.parent_key}`)
    const targetPath = resolveDependencyTarget(root, dirname(parentTarget), dependency.reference_path)
    const response = await fetchImpl(dependency.source_url)
    if (!response.ok) throw new Error(`Resource dependency download failed (${response.status}) for ${dependency.element_path}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    const declaredFormat = extensionOf(dependency.element_path)
    const detectedFormat = detectResourceBinaryFormat(bytes)
    if (detectedFormat && declaredFormat && !formatsAgree(declaredFormat, detectedFormat)) {
      throw new Error(`Resource dependency binary format mismatch for ${dependency.element_path}`)
    }
    targets.set(dependency.key, targetPath)
    pending.push({ key: dependency.key, targetPath, bytes })
  }
  return pending
}

async function commitResourceWrites(
  writes: Array<{ targetPath: string; bytes: Uint8Array }>,
): Promise<() => Promise<void>> {
  const snapshots: Array<{
    targetPath: string
    previous?: Uint8Array
  }> = []
  try {
    for (const write of writes) {
      const previous = existsSync(write.targetPath)
        ? new Uint8Array(await readFile(write.targetPath))
        : undefined
      snapshots.push({ targetPath: write.targetPath, ...(previous ? { previous } : {}) })
      await mkdir(resolve(write.targetPath, '..'), { recursive: true })
      await writeFile(write.targetPath, write.bytes)
    }
  } catch (error) {
    await rollbackResourceWrites(snapshots)
    throw error
  }
  return () => rollbackResourceWrites(snapshots)
}

async function rollbackResourceWrites(
  snapshots: Array<{ targetPath: string; previous?: Uint8Array }>,
): Promise<void> {
  for (const snapshot of snapshots.reverse()) {
    if (snapshot.previous) {
      await writeFile(snapshot.targetPath, snapshot.previous)
    } else {
      await rm(snapshot.targetPath, { force: true })
    }
  }
}

function resolveDependencyTarget(root: string, parentDirectory: string, referencePath: string): string {
  const normalizedReference = referencePath.split('\\').join('/')
  if (!normalizedReference || normalizedReference.startsWith('/') || normalizedReference.split('/').includes('')) {
    throw new Error('Resource dependency reference path is unsafe')
  }
  return resolveInsideWorkspace(root, resolve(parentDirectory, normalizedReference))
}

export function normalizeBeeGameAssetManifest(value: unknown): BeeGameAssetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid asset manifest')
  }
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.requirements)) {
    throw new Error('Invalid asset manifest: requirements must be an array; legacy slots manifests require explicit migration')
  }
  assertNoLegacyManifestFields(record)
  const requirements = record.requirements
    .map(requirement => normalizeAssetRequirement(requirement))
    .filter(Boolean) as BeeGameAssetRequirement[]
  const explicitImports = normalizeResourceImports(record.imports)
  return {
    version: normalizeManifestVersion(record.version),
    project_target: normalizeProjectTarget(record.project_target ?? record),
    requirements,
    imports: explicitImports,
    compositions: normalizeAssetCompositions(record.compositions),
  }
}

/**
 * Parses the current authoring contract without repairing or dropping data.
 * Runtime callers must use this parser. The normalizer remains available only
 * for explicit offline migration and non-authoritative historical snapshots.
 */
export function parseCanonicalBeeGameAssetManifest(value: unknown): BeeGameAssetManifest {
  const issues = canonicalManifestShapeIssues(value)
  if (issues.length) {
    throw new BeeGameAssetManifestError(issues)
  }
  return value as BeeGameAssetManifest
}

function canonicalManifestShapeIssues(value: unknown): string[] {
  if (!objectValue(value)) return ['root must be an object.']
  const record = value as Record<string, unknown>
  const issues: string[] = []
  if (record.version !== CURRENT_ASSET_MANIFEST_VERSION) {
    issues.push(`version must be ${CURRENT_ASSET_MANIFEST_VERSION}.`)
  }
  if (!objectValue(record.project_target)) issues.push('project_target must be an object.')
  if (!Array.isArray(record.requirements)) issues.push('requirements must be an array.')
  if (!Array.isArray(record.imports)) issues.push('imports must be an array.')
  if (record.compositions !== undefined && !Array.isArray(record.compositions)) {
    issues.push('compositions must be an array when present.')
  }
  if (issues.length) return issues

  try {
    assertNoLegacyManifestFields(record)
  } catch (error) {
    issues.push(error instanceof Error ? error.message : 'legacy fields require explicit offline migration.')
  }
  validateCanonicalProjectTarget(record.project_target as Record<string, unknown>, issues)
  ;(record.requirements as unknown[]).forEach((entry, index) => {
    validateCanonicalRequirement(entry, `requirements[${index}]`, issues)
  })
  ;(record.imports as unknown[]).forEach((entry, index) => {
    validateCanonicalImport(entry, `imports[${index}]`, issues)
  })
  ;((record.compositions as unknown[] | undefined) ?? []).forEach((entry, index) => {
    validateCanonicalComposition(entry, `compositions[${index}]`, issues)
  })
  return issues
}

function validateCanonicalProjectTarget(record: Record<string, unknown>, issues: string[]): void {
  validateOptionalString(record.platform, 'project_target.platform', issues)
  validateOptionalString(record.runtime, 'project_target.runtime', issues)
  validateOptionalString(record.mcp_server, 'project_target.mcp_server', issues)
  validateOptionalString(record.runtime_asset_root, 'project_target.runtime_asset_root', issues)
  validateOptionalEnum(record.integration_mode, ['filesystem', 'mcp', 'manual'], 'project_target.integration_mode', issues)
  validateOptionalEnum(record.resource_library_usage, RESOURCE_LIBRARY_USAGE, 'project_target.resource_library_usage', issues)
  validateStringArray(record.asset_format_capabilities, 'project_target.asset_format_capabilities', issues, true, true)
}

function validateCanonicalRequirement(value: unknown, path: string, issues: string[]): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateCanonicalRequirementId(record.id, `${path}.id`, issues)
  validateOptionalString(record.name, `${path}.name`, issues)
  validateOptionalString(record.purpose, `${path}.purpose`, issues)
  if (record.required !== undefined && typeof record.required !== 'boolean') issues.push(`${path}.required must be a boolean.`)
  validateOptionalEnum(record.status, ['planned', 'satisfied', 'blocked'], `${path}.status`, issues)
  if (record.resource_requirement !== undefined) {
    const requirement = objectValue(record.resource_requirement)
    if (!requirement) issues.push(`${path}.resource_requirement must be an object.`)
    else validateCanonicalResourceRequirement(requirement, `${path}.resource_requirement`, issues)
  }
  if (record.satisfied_by !== undefined) {
    const satisfiedBy = objectValue(record.satisfied_by)
    if (!satisfiedBy) issues.push(`${path}.satisfied_by must be an object.`)
    else {
      validateStringArray(satisfiedBy.import_ids, `${path}.satisfied_by.import_ids`, issues)
      validateStringArray(satisfiedBy.composition_ids, `${path}.satisfied_by.composition_ids`, issues)
      validateStringArray(satisfiedBy.project_references, `${path}.satisfied_by.project_references`, issues)
    }
  }
}

function validateCanonicalResourceRequirement(record: Record<string, unknown>, path: string, issues: string[]): void {
  validateOptionalEnum(record.category, RESOURCE_CATEGORIES, `${path}.category`, issues)
  validateOptionalEnum(record.dimension, ['2D', '3D', 'agnostic'], `${path}.dimension`, issues)
  validateOptionalString(record.purpose, `${path}.purpose`, issues)
  validateStringArray(record.accepted_formats, `${path}.accepted_formats`, issues)
  validateStringArray(record.styles, `${path}.styles`, issues)
  validateStringArray(record.game_types, `${path}.game_types`, issues)
  validateEnumArray(record.tags, RESOURCE_USAGE_TAGS, `${path}.tags`, issues)
  validateEnumArray(record.asset_kinds, RESOURCE_ASSET_KINDS, `${path}.asset_kinds`, issues)
  validateEnumArray(record.capabilities, RESOURCE_CAPABILITIES, `${path}.capabilities`, issues)
  validateObjectArray(record.subresources, `${path}.subresources`, issues, (entry, itemPath) => {
    validateOptionalEnum(entry.kind, RESOURCE_EMBEDDED_COMPONENT_KINDS, `${itemPath}.kind`, issues, true)
    validateOptionalString(entry.role, `${itemPath}.role`, issues)
    validateOptionalString(entry.skeleton_signature, `${itemPath}.skeleton_signature`, issues)
  })
  validateObjectArray(record.relations, `${path}.relations`, issues, (entry, itemPath) => {
    validateOptionalEnum(entry.kind, RESOURCE_RELATION_KINDS, `${itemPath}.kind`, issues, true)
    validateOptionalString(entry.target_element_id, `${itemPath}.target_element_id`, issues)
    validateOptionalString(entry.role, `${itemPath}.role`, issues)
  })
}

function validateCanonicalImport(value: unknown, path: string, issues: string[]): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateRequiredString(record.id, `${path}.id`, issues)
  validateOptionalEnum(record.status, ['available', 'referenced', 'failed'], `${path}.status`, issues, true)
  validateRequiredString(record.root_path, `${path}.root_path`, issues)
  validateRequiredString(record.selected_at, `${path}.selected_at`, issues)
  validateStringArray(record.local_files, `${path}.local_files`, issues, true, true)
  validateStringArray(record.selection_reason, `${path}.selection_reason`, issues, true)
  validateOptionalString(record.asset_kind, `${path}.asset_kind`, issues)
  validateStringArray(record.capabilities, `${path}.capabilities`, issues)
  validateOptionalString(record.error, `${path}.error`, issues)
  const source = objectValue(record.source)
  if (!source) issues.push(`${path}.source must be an object.`)
  else {
    validateOptionalEnum(source.type, ['resource-library', 'user-upload', 'project-authored'], `${path}.source.type`, issues, true)
    for (const field of ['pack_id', 'pack_version', 'element_id', 'element_path']) {
      validateOptionalString(source[field], `${path}.source.${field}`, issues)
    }
    if (source.type === 'resource-library') {
      validateRequiredString(source.pack_id, `${path}.source.pack_id`, issues)
      validateRequiredString(source.pack_version, `${path}.source.pack_version`, issues)
      validateRequiredString(source.element_id, `${path}.source.element_id`, issues)
      validateRequiredString(source.element_path, `${path}.source.element_path`, issues)
    }
  }
  validateObjectArray(record.dependencies, `${path}.dependencies`, issues, (entry, itemPath) => {
    for (const field of ['key', 'parent_key', 'element_id', 'element_path', 'reference_path', 'local_path']) {
      validateRequiredString(entry[field], `${itemPath}.${field}`, issues)
    }
    validateOptionalString(entry.kind, `${itemPath}.kind`, issues)
  })
  if (record.usage_evidence !== undefined) {
    const evidence = objectValue(record.usage_evidence)
    if (!evidence) issues.push(`${path}.usage_evidence must be an object.`)
    else {
      validateStringArray(evidence.references, `${path}.usage_evidence.references`, issues)
      validateStringArray(evidence.runtime_event_ids, `${path}.usage_evidence.runtime_event_ids`, issues)
    }
  }
  if (record.content_profile !== undefined && !objectValue(record.content_profile)) issues.push(`${path}.content_profile must be an object.`)
  if (record.technical_facts !== undefined && !isPrimitiveValueRecord(record.technical_facts)) {
    issues.push(`${path}.technical_facts must contain only finite string, number, or boolean values.`)
  }
}

function validateCanonicalComposition(value: unknown, path: string, issues: string[]): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateRequiredString(record.id, `${path}.id`, issues)
  validateOptionalEnum(record.kind, RESOURCE_COMPOSITION_KINDS, `${path}.kind`, issues, true)
  validateOptionalEnum(record.assembly_mode, ['direct', 'composed'], `${path}.assembly_mode`, issues)
  validateOptionalEnum(record.status, ['planned', 'assembled', 'integrated', 'failed'], `${path}.status`, issues)
  if (record.required !== undefined && typeof record.required !== 'boolean') issues.push(`${path}.required must be a boolean.`)
  validateObjectArray(record.members, `${path}.members`, issues, (entry, itemPath) => {
    const references = ['import_id', 'requirement_id', 'composition_id'].filter(field => typeof entry[field] === 'string' && Boolean(String(entry[field]).trim()))
    if (!references.length) issues.push(`${itemPath} must identify an import, requirement, or composition.`)
    for (const field of ['import_id', 'requirement_id', 'composition_id']) validateOptionalString(entry[field], `${itemPath}.${field}`, issues)
    validateRequiredString(entry.role, `${itemPath}.role`, issues)
    if (entry.required !== undefined && typeof entry.required !== 'boolean') issues.push(`${itemPath}.required must be a boolean.`)
  }, true)
  for (const field of ['recipe', 'integration_evidence'] as const) {
    if (record[field] !== undefined && !objectValue(record[field])) issues.push(`${path}.${field} must be an object.`)
  }
  const recipe = objectValue(record.recipe)
  if (recipe) {
    validateOptionalString(recipe.path, `${path}.recipe.path`, issues)
    validateOptionalString(recipe.notes, `${path}.recipe.notes`, issues)
  }
  const evidence = objectValue(record.integration_evidence)
  if (evidence) {
    validateStringArray(evidence.references, `${path}.integration_evidence.references`, issues)
    validateStringArray(evidence.runtime_event_ids, `${path}.integration_evidence.runtime_event_ids`, issues)
  }
}

function validateCanonicalRequirementId(value: unknown, path: string, issues: string[]): void {
  validateRequiredString(value, path, issues)
  if (typeof value === 'string' && value === value.trim() && normalizeImportId(value) !== value) {
    issues.push(`${path} contains characters that are not allowed in a canonical requirement id.`)
  }
}

function validateRequiredString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) issues.push(`${path} must be a trimmed non-empty string.`)
}

function validateOptionalString(value: unknown, path: string, issues: string[]): void {
  if (value !== undefined && (typeof value !== 'string' || !value.trim() || value !== value.trim())) issues.push(`${path} must be a trimmed non-empty string when present.`)
}

function validateOptionalEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: string[],
  required = false,
): void {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || !allowed.includes(value)) issues.push(`${path} must be one of ${allowed.join(', ')}.`)
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: string[],
  required = false,
  nonEmpty = false,
): void {
  if (value === undefined && !required) return
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || value.some(entry => typeof entry !== 'string' || !entry.trim() || entry !== entry.trim())) {
    issues.push(`${path} must be an array of non-empty strings.`)
  }
}

function isPrimitiveValueRecord(value: unknown): boolean {
  const record = objectValue(value)
  return Boolean(record) && Object.values(record!).every(entry =>
    typeof entry === 'string' ||
    typeof entry === 'boolean' ||
    (typeof entry === 'number' && Number.isFinite(entry)),
  )
}

function validateEnumArray(value: unknown, allowed: readonly string[], path: string, issues: string[]): void {
  if (value === undefined) return
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string' || !allowed.includes(entry))) {
    issues.push(`${path} must contain only ${allowed.join(', ')}.`)
  }
}

function validateObjectArray(
  value: unknown,
  path: string,
  issues: string[],
  validate: (entry: Record<string, unknown>, path: string) => void,
  required = false,
): void {
  if (value === undefined && !required) return
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`)
    return
  }
  value.forEach((entry, index) => {
    const record = objectValue(entry)
    if (!record) issues.push(`${path}[${index}] must be an object.`)
    else validate(record, `${path}[${index}]`)
  })
}

function assertNoLegacyManifestFields(record: Record<string, unknown>): void {
  const rootLegacy = ['slots', 'confirmedResourceLibraryUsage', 'asset_contract']
    .filter(field => record[field] !== undefined)
  const target = objectValue(record.project_target)
  const targetLegacy = ['kind', 'engine', 'supported_asset_formats', 'resource_sourcing_policy']
    .filter(field => target?.[field] !== undefined)
  const requirementLegacy = (record.requirements as unknown[])
    .flatMap((value, index) => {
      if (!objectValue(value)) return []
      const requirement = value as Record<string, unknown>
      return [
        'slot_id', 'type', 'description', 'placeholder', 'placeholder_status',
        'accepted_formats', 'recommended_specs', 'target', 'target_path',
        'integration_provider', 'uploaded_files', 'uploaded_urls',
        'resource_binding', 'integration_evidence', 'integration_error',
        'replacement', 'updated_at',
      ].filter(field => requirement[field] !== undefined).map(field => `requirements[${index}].${field}`)
    })
  const legacy = [...rootLegacy, ...targetLegacy.map(field => `project_target.${field}`), ...requirementLegacy]
  if (legacy.length) {
    throw new Error(`Invalid asset manifest: legacy fields require explicit offline migration: ${legacy.join(', ')}`)
  }
}

function normalizeResourceImports(value: unknown): BeeGameResourceImport[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeResourceImport).filter((entry): entry is BeeGameResourceImport => Boolean(entry))
}

function normalizeResourceImport(value: unknown): BeeGameResourceImport | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const source = objectValue(record.source)
  const id = trimString(record.id)
  const sourceType = source?.type === 'resource-library' || source?.type === 'user-upload' || source?.type === 'project-authored' ? source.type : undefined
  const packId = trimString(source?.pack_id)
  const packVersion = trimString(source?.pack_version)
  const elementId = trimString(source?.element_id)
  const elementPath = trimString(source?.element_path)
  const rootPath = trimString(record.root_path)
  const selectedAt = trimString(record.selected_at)
  if (!id || !sourceType || !rootPath || !selectedAt) return undefined
  if (sourceType === 'resource-library' && (!packId || !packVersion || !elementId || !elementPath)) return undefined
  const status = record.status === 'referenced' || record.status === 'failed' ? record.status : 'available'
  const evidence = objectValue(record.usage_evidence)
  const contentProfile = objectValue(record.content_profile)
  const technicalFacts = primitiveRecord(record.technical_facts)
  return {
    id,
    source: {
      type: sourceType,
      ...(packId ? { pack_id: packId } : {}),
      ...(packVersion ? { pack_version: packVersion } : {}),
      ...(elementId ? { element_id: elementId } : {}),
      ...(elementPath ? { element_path: elementPath } : {}),
    },
    status,
    root_path: rootPath,
    local_files: stringArray(record.local_files),
    selected_at: selectedAt,
    selection_reason: stringArray(record.selection_reason),
    ...(trimString(record.asset_kind) ? { asset_kind: trimString(record.asset_kind) } : {}),
    ...(stringArray(record.capabilities).length ? { capabilities: stringArray(record.capabilities) } : {}),
    ...(contentProfile ? { content_profile: contentProfile } : {}),
    ...(technicalFacts ? { technical_facts: technicalFacts } : {}),
    ...(Array.isArray(record.dependencies) ? { dependencies: record.dependencies.map(normalizeImportDependency).filter((entry): entry is BeeGameResourceImportDependency => Boolean(entry)) } : {}),
    ...(evidence ? { usage_evidence: { references: stringArray(evidence.references), runtime_event_ids: stringArray(evidence.runtime_event_ids) } } : {}),
    ...(trimString(record.error) ? { error: trimString(record.error) } : {}),
  }
}

function primitiveRecord(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value).filter((entry): entry is [string, string | number | boolean] => {
    const item = entry[1]
    return typeof item === 'string' || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
  })
  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeImportDependency(value: unknown): BeeGameResourceImportDependency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const key = trimString(record.key)
  const parentKey = trimString(record.parent_key)
  const elementId = trimString(record.element_id)
  const elementPath = trimString(record.element_path)
  const referencePath = trimString(record.reference_path)
  const localPath = trimString(record.local_path)
  if (!key || !parentKey || !elementId || !elementPath || !referencePath || !localPath) return undefined
  return { key, parent_key: parentKey, element_id: elementId, element_path: elementPath, reference_path: referencePath, local_path: localPath, ...(trimString(record.kind) ? { kind: trimString(record.kind) } : {}) }
}

/** Reconcile copied inventory only. Requirements and compositions are authored
 * target-native declarations; filesystem observations must not silently
 * advance or rewrite their lifecycle. */
async function reconcileAssetContractFiles(
  root: string,
  manifest: BeeGameAssetManifest,
): Promise<BeeGameAssetManifest> {
  const imports = await Promise.all((manifest.imports ?? []).map(async resourceImport => {
    const localFiles = [...new Set(resourceImport.local_files ?? [])]
    const missing = localFiles.filter(path => {
      try { return !existsSync(resolveInsideWorkspace(root, path)) } catch { return true }
    })
    if (missing.length) {
      return {
        ...resourceImport,
        status: 'failed' as const,
        error: 'One or more imported project asset files are missing.',
      }
    }
    for (const localPath of localFiles) {
      const declaredFormat = extensionOf(localPath)
      if (!declaredFormat) continue
      try {
        const bytes = await readResourceSignature(resolveInsideWorkspace(root, localPath))
        const detectedFormat = detectResourceBinaryFormat(bytes)
        if (detectedFormat && !formatsAgree(declaredFormat, detectedFormat)) {
          return {
            ...resourceImport,
            status: 'failed' as const,
            error: `File format mismatch: expected .${declaredFormat}, found ${detectedFormat}`,
          }
        }
      } catch {
        return { ...resourceImport, status: 'failed' as const, error: 'Imported project asset could not be read.' }
      }
    }
    return resourceImport
  }))
  return { ...manifest, imports }
}

async function readResourceSignature(path: string): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const bytes = new Uint8Array(32)
    const { bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0)
    return bytes.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function normalizeAssetRequirement(value: unknown): BeeGameAssetRequirement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = normalizeImportId(String(record.id ?? ''))
  if (!id) return undefined
  const satisfiedBy = objectValue(record.satisfied_by)
  const status = record.status === 'satisfied' || record.status === 'blocked'
    ? record.status
    : 'planned'
  return {
    id,
    name: trimString(record.name),
    purpose: trimString(record.purpose),
    required: record.required !== false,
    status,
    resource_requirement: normalizeResourceRequirement(record.resource_requirement),
    ...(satisfiedBy ? { satisfied_by: { import_ids: stringArray(satisfiedBy.import_ids), composition_ids: stringArray(satisfiedBy.composition_ids), project_references: stringArray(satisfiedBy.project_references) } } : {}),
  }
}

function normalizeResourceRequirement(value: unknown): BeeGameResourceRequirement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const category = normalizeResourceCategory(record.category)
  const dimension = record.dimension === '2D' || record.dimension === '3D' || record.dimension === 'agnostic'
    ? record.dimension
    : undefined
  const acceptedFormats = stringArray(record.accepted_formats)
  const styles = stringArray(record.styles)
  const gameTypes = stringArray(record.game_types)
  const tags = stringArray(record.tags).filter((tag): tag is ResourceUsageTag =>
    (RESOURCE_USAGE_TAGS as readonly string[]).includes(tag),
  )
  const assetKinds = stringArray(record.asset_kinds).filter((kind): kind is ResourceAssetKind =>
    (RESOURCE_ASSET_KINDS as readonly string[]).includes(kind),
  )
  const capabilities = stringArray(record.capabilities).filter((capability): capability is ResourceCapability =>
    (RESOURCE_CAPABILITIES as readonly string[]).includes(capability),
  )
  const subresources = Array.isArray(record.subresources)
    ? record.subresources.map(normalizeSubresourceRequirement).filter((entry): entry is BeeGameSubresourceRequirement => Boolean(entry))
    : []
  const relations = Array.isArray(record.relations)
    ? record.relations.map(normalizeResourceRelationRequirement).filter((relation): relation is BeeGameResourceRelationRequirement => Boolean(relation))
    : []
  const purpose = trimString(record.purpose)
  if (!category && !dimension && !acceptedFormats.length && !styles.length && !gameTypes.length && !tags.length && !assetKinds.length && !capabilities.length && !subresources.length && !relations.length && !purpose) return undefined
  return {
    category: category || undefined,
    dimension,
    accepted_formats: acceptedFormats,
    styles,
    game_types: gameTypes,
    ...(tags.length ? { tags } : {}),
    ...(assetKinds.length ? { asset_kinds: assetKinds } : {}),
    ...(capabilities.length ? { capabilities } : {}),
    ...(subresources.length ? { subresources } : {}),
    ...(relations.length ? { relations } : {}),
    purpose: purpose || undefined,
  }
}

function normalizeSubresourceRequirement(value: unknown): BeeGameSubresourceRequirement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = trimString(record.kind) ?? ''
  if (!(RESOURCE_EMBEDDED_COMPONENT_KINDS as readonly string[]).includes(kind)) return undefined
  const role = trimString(record.role)
  const signature = trimString(record.skeleton_signature)
  return {
    kind: kind as ResourceEmbeddedComponentKind,
    ...(role ? { role } : {}),
    ...(signature ? { skeleton_signature: signature } : {}),
  }
}

function normalizeResourceRelationRequirement(value: unknown): BeeGameResourceRelationRequirement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const kind = trimString(record.kind) ?? ''
  if (!(RESOURCE_RELATION_KINDS as readonly string[]).includes(kind)) return undefined
  const targetElementId = trimString(record.target_element_id)
  const role = trimString(record.role)
  return {
    kind: kind as ResourceRelationKind,
    ...(targetElementId ? { target_element_id: targetElementId } : {}),
    ...(role ? { role } : {}),
  }
}

function normalizeAssetCompositions(value: unknown): BeeGameAssetComposition[] {
  if (!Array.isArray(value)) return []
  return value.map(normalizeAssetComposition).filter((composition): composition is BeeGameAssetComposition => Boolean(composition))
}

function normalizeAssetComposition(value: unknown): BeeGameAssetComposition | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = trimString(record.id)
  const kind = trimString(record.kind) ?? ''
  if (!id || !(RESOURCE_COMPOSITION_KINDS as readonly string[]).includes(kind) || !Array.isArray(record.members)) return undefined
  const members = record.members.map(normalizeCompositionMember).filter((member): member is BeeGameAssetCompositionMember => Boolean(member))
  if (!members.length) return undefined
  const recipe = objectValue(record.recipe)
  const evidence = objectValue(record.integration_evidence)
  const normalizedStatus = trimString(record.status) ?? ''
  const assemblyMode = record.assembly_mode === 'direct'
    ? 'direct'
    : record.assembly_mode === 'composed'
      ? 'composed'
      : 'composed'
  const status = ['planned', 'assembled', 'integrated', 'failed'].includes(normalizedStatus)
    ? normalizedStatus as BeeGameAssetComposition['status']
    : undefined
  return {
    id,
    kind: kind as ResourceCompositionKind,
    required: record.required !== false,
    members,
    ...(assemblyMode ? { assembly_mode: assemblyMode } : {}),
    ...(recipe ? { recipe: { path: trimString(recipe.path), notes: trimString(recipe.notes) } } : {}),
    ...(status ? { status } : {}),
    ...(evidence ? { integration_evidence: { references: stringArray(evidence.references), runtime_event_ids: stringArray(evidence.runtime_event_ids) } } : {}),
  }
}

function normalizeCompositionMember(value: unknown): BeeGameAssetCompositionMember | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const importId = trimString(record.import_id)
  const requirementId = trimString(record.requirement_id)
  const compositionId = trimString(record.composition_id)
  const role = trimString(record.role)
  if ((!importId && !requirementId && !compositionId) || !role) return undefined
  return {
    ...(importId ? { import_id: importId } : {}),
    ...(requirementId ? { requirement_id: requirementId } : {}),
    ...(compositionId ? { composition_id: compositionId } : {}),
    role,
    required: record.required !== false,
  }
}

/**
 * A category is a hard compatibility constraint. Legacy manifests may contain
 * domain labels that do not exist in the resource library taxonomy; omit those
 * rather than converting them through name heuristics and silently excluding
 * compatible Pack elements.
 */
function normalizeResourceCategory(value: unknown): string | undefined {
  const category = trimString(value)
  return category && (RESOURCE_CATEGORIES as readonly string[]).includes(category)
    ? category
    : undefined
}

function normalizeProjectTarget(value: unknown): BeeGameAssetProjectTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    platform: trimString(record.platform),
    runtime: trimString(record.runtime),
    integration_mode: normalizeIntegrationMode(record.integration_mode),
    mcp_server: trimString(record.mcp_server),
    asset_format_capabilities: stringArray(record.asset_format_capabilities),
    resource_library_usage: normalizeResourceLibraryUsage(record.resource_library_usage),
    runtime_asset_root: trimString(record.runtime_asset_root),
  }
}

function assertImportInsideRuntimeAssetRoot(
  workspace: string,
  targetPath: string,
  target?: BeeGameAssetProjectTarget,
): void {
  const policy = target?.resource_library_usage
  if (policy !== 'preferred' && policy !== 'required') return
  const runtimeAssetRoot = trimString(target?.runtime_asset_root)
  if (!runtimeAssetRoot || !isConcreteRelativePath(runtimeAssetRoot)) {
    throw new Error('Target runtime project_target.runtime_asset_root must be a concrete project-relative directory before Resource Library import')
  }
  const absoluteRoot = resolveInsideWorkspace(workspace, runtimeAssetRoot)
  const fromRoot = relative(absoluteRoot, targetPath)
  if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Resource import destination must be inside project_target.runtime_asset_root: ${runtimeAssetRoot}`)
  }
}

function normalizeResourceLibraryUsage(value: unknown): ResourceLibraryUsage | undefined {
  const usage = trimString(value)
  return usage && (RESOURCE_LIBRARY_USAGE as readonly string[]).includes(usage)
    ? usage as ResourceLibraryUsage
    : undefined
}

function assertAssetFormatAllowed(filename: string, requirement: BeeGameAssetRequirement, target?: BeeGameAssetProjectTarget): void {
  assertFilenameFormatAllowed(filename, effectiveAssetFormats(requirement, target))
}

function assertFilenameFormatAllowed(filename: string, formats: readonly string[]): void {
  if (!formats.length) throw new Error(`Target runtime asset format capabilities are required before integrating ${filename}`)
  const extension = normalizeFormat(extname(filename))
  if (!extension || !formats.includes(extension)) throw new Error(`Asset format .${extension || 'unknown'} is not supported by the target runtime contract`)
}

function normalizeFormats(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeFormat).filter(Boolean))]
}

function normalizeFormat(value: string): string {
  return value.trim().replace(/^\./, '').toLowerCase()
}

function normalizeIntegrationMode(value: unknown): BeeGameAssetIntegrationMode | undefined {
  return value === 'filesystem' || value === 'mcp' || value === 'manual' ? value : undefined
}

function normalizeManifestVersion(value: unknown): number {
  const parsed = typeof value === 'string'
    ? Number.parseInt(value, 10)
    : Number(value || CURRENT_ASSET_MANIFEST_VERSION)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : CURRENT_ASSET_MANIFEST_VERSION
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function resolveUploadTarget(
  root: string,
  requirement: BeeGameAssetRequirement,
  filename: string,
  target?: BeeGameAssetProjectTarget,
): string {
  const normalizedFilename = sanitizeFilename(filename)
  const runtimeAssetRoot = trimString(target?.runtime_asset_root)
  if (!runtimeAssetRoot || !isConcreteRelativePath(runtimeAssetRoot)) {
    throw new Error('Target runtime project_target.runtime_asset_root must be a concrete project-relative directory before asset upload')
  }
  return resolveInsideWorkspace(root, join(runtimeAssetRoot, 'uploads', requirement.id, normalizedFilename))
}

function resolveImportTarget(root: string, destinationPath: string, filename: string): string {
  const destination = trimString(destinationPath)
  if (!destination || !isConcreteRelativePath(destination)) throw new Error('Resource import destination_path must be a concrete project-relative path')
  const sourceExtension = extname(filename).toLowerCase()
  const destinationExtension = extname(destination).toLowerCase()
  if (destinationExtension && sourceExtension && destinationExtension !== sourceExtension) {
    throw new Error(`Resource import destination extension must remain .${sourceExtension.slice(1)}`)
  }
  return resolveInsideWorkspace(root, destinationExtension ? destination : join(destination, filename))
}

function extensionOf(filename: string): string {
  return extname(filename).slice(1).trim().toLowerCase()
}

/**
 * Checks only self-identifying binary container signatures. This is a safety
 * check for copy-time integrity, not a semantic classifier.
 */
function detectResourceBinaryFormat(bytes: Uint8Array): string | undefined {
  const ascii = new TextDecoder('latin1').decode(bytes.subarray(0, 32))
  if (ascii.startsWith('glTF')) return 'glb'
  if (ascii.startsWith('OggS')) return 'ogg'
  if (ascii.startsWith('ID3') || (bytes[0] === 0xff && (((bytes[1] ?? 0) & 0xe0) === 0xe0))) return 'mp3'
  if (ascii.startsWith('Kaydara FBX Binary')) return 'fbx'
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'wav'
  return undefined
}

function formatsAgree(declaredFormat: string, detectedFormat: string): boolean {
  if (declaredFormat === detectedFormat) return true
  return (declaredFormat === 'jpeg' && detectedFormat === 'jpg') ||
    (declaredFormat === 'jpg' && detectedFormat === 'jpeg')
}

async function writeAssetManifest(root: string, manifest: BeeGameAssetManifest): Promise<void> {
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  await mkdir(resolve(manifestPath, '..'), { recursive: true })
  await writeFile(manifestPath, `${JSON.stringify(toCanonicalBeeGameAssetManifest(manifest), null, 2)}\n`, 'utf8')
}

export function toCanonicalBeeGameAssetManifest(manifest: BeeGameAssetManifest): Record<string, unknown> {
  return {
    version: Math.max(CURRENT_ASSET_MANIFEST_VERSION, manifest.version),
    ...(manifest.project_target ? { project_target: manifest.project_target } : {}),
    requirements: manifest.requirements.map(requirement => {
      const satisfiedBy = {
        import_ids: [...new Set(requirement.satisfied_by?.import_ids ?? [])],
        composition_ids: [...new Set(requirement.satisfied_by?.composition_ids ?? [])],
        project_references: [...new Set(requirement.satisfied_by?.project_references ?? [])],
      }
      return {
        id: requirement.id,
        ...(requirement.name ? { name: requirement.name } : {}),
        ...(requirement.purpose ? { purpose: requirement.purpose } : {}),
        required: requirement.required !== false,
        ...(requirement.resource_requirement ? { resource_requirement: requirement.resource_requirement } : {}),
        ...(satisfiedBy.import_ids.length || satisfiedBy.composition_ids.length || satisfiedBy.project_references.length ? { satisfied_by: satisfiedBy } : {}),
        status: requirement.status ?? 'planned',
      }
    }),
    imports: manifest.imports ?? [],
    compositions: manifest.compositions ?? [],
  }
}

export async function writeBeeGameAssetManifest(
  workspacePath: string,
  manifest: BeeGameAssetManifest,
): Promise<void> {
  await writeAssetManifest(normalizeWorkspacePath(workspacePath), manifest)
}

function buildUploadMessage(
  requirement: BeeGameAssetRequirement,
  path: string,
): string {
  return [
    `Asset imported for requirement "${requirement.id}".`,
    `File: ${path}.`,
    requirement.purpose ? `Purpose: ${requirement.purpose}.` : '',
    'The import remains available inventory until target-native project code or a composition references it and runtime verification succeeds.',
    'Use the project target\'s native files and tools to reference it, validate its player-facing contribution, and update assets/asset-manifest.json with current evidence.',
  ].filter(Boolean).join(' ')
}

function normalizeWorkspacePath(path: string): string {
  if (!path || !isAbsolute(path)) throw new Error('Workspace path must be absolute')
  return resolve(path)
}

function resolveInsideWorkspace(root: string, path: string): string {
  const target = isAbsolute(path) ? resolve(path) : resolve(root, path)
  const rel = relative(root, target)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('Asset path must stay inside the session workspace')
  }
  return target
}

function normalizeRelativePath(root: string, path: string): string {
  return relative(root, path).split('/').join('/')
}

function isConcreteRelativePath(path: string): boolean {
  if (!path || isAbsolute(path)) return false
  if (path.includes('..')) return false
  if (/[{}<>*?]/.test(path)) return false
  return true
}

function normalizeImportId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '_')
}

function sanitizeFilename(value: string): string {
  const name = basename(value || 'asset')
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
  return name || 'asset'
}

function trimString(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(item => typeof item === 'string' ? item.trim() : '').filter(Boolean)
    : []
}
