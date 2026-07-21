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

export type BeeGameAssetIntegrationProvider = {
  type?: BeeGameAssetIntegrationMode
  server?: string
  capabilities?: string[]
}

export type BeeGameResourceBinding = {
  pack_id: string
  pack_version: string
  element_id: string
  /** Immutable original resource path; do not infer its format from a signed URL. */
  element_path?: string
  /** Format established from the copied binary, never inferred from the requested slot path. */
  content_format?: string
  source_url: string
  selected_at: string
  selection_reason: string[]
  dependencies?: BeeGameResourceBindingDependency[]
}

export type BeeGameResourceBindingDependency = {
  key: string
  parent_key: string
  element_id: string
  element_path: string
  reference_path: string
  source_url: string
  kind?: string
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
  slot: Pick<BeeGameAssetSlot, 'accepted_formats' | 'resource_requirement'>,
  target?: BeeGameAssetProjectTarget,
): string[] {
  const slotFormats = normalizeFormats(slot.resource_requirement?.accepted_formats?.length
    ? slot.resource_requirement.accepted_formats
    : slot.accepted_formats)
  const runtimeFormats = normalizeFormats(target?.asset_format_capabilities)
  // A Pack can contain files for several engines. A project must therefore
  // declare the formats its own target can consume before it is
  // allowed to select or copy library content. Slot formats further narrow
  // that target contract; they never broaden it.
  if (!runtimeFormats.length) return []
  return slotFormats.length
    ? slotFormats.filter(format => runtimeFormats.includes(format))
    : runtimeFormats
}

export type BeeGameAssetSlot = {
  id: string
  name?: string
  type?: string
  purpose?: string
  required?: boolean
  placeholder?: boolean
  accepted_formats?: string[]
  recommended_specs?: Record<string, unknown>
  target?: {
    path?: string
    integration_notes?: string
  }
  integration_provider?: BeeGameAssetIntegrationProvider
  status?: 'placeholder' | 'uploaded' | 'integrated' | 'missing' | 'failed'
  uploaded_files?: string[]
  uploaded_urls?: string[]
  resource_requirement?: BeeGameResourceRequirement
  satisfied_by?: { import_ids?: string[]; composition_ids?: string[]; project_references?: string[] }
  resource_binding?: BeeGameResourceBinding
  integration_evidence?: { references?: string[]; runtime_event_ids?: string[] }
  integration_error?: string
  updated_at?: string
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
  requirements: BeeGameAssetSlot[]
  /** Independent project inventory selected by Claude Code. */
  imports?: BeeGameResourceImport[]
  compositions?: BeeGameAssetComposition[]
}

export type BeeGameAssetUploadResult = {
  manifest: BeeGameAssetManifest
  requirement: BeeGameAssetSlot
  path: string
  message: string
}

const ASSET_MANIFEST_PATH = 'assets/asset-manifest.json'
const ASSET_UPLOAD_ROOT = 'assets/uploads'
export const CURRENT_ASSET_MANIFEST_VERSION = 5

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
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return reconcileAssetContractFiles(root, normalizeBeeGameAssetManifest(parsed))
}

export async function uploadBeeGameAsset(
  workspacePath: string,
  requirementId: string,
  file: File,
): Promise<BeeGameAssetUploadResult> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedSlotId = normalizeSlotId(requirementId)
  const slotIndex = manifest.requirements.findIndex(requirement => requirement.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset requirement not found: ${normalizedSlotId}`)
  const slot = manifest.requirements[slotIndex]
  assertAssetFormatAllowed(file.name, slot, manifest.project_target)
  const targetPath = resolveUploadTarget(root, slot, file.name)
  await mkdir(resolve(targetPath, '..'), { recursive: true })
  const bytes = new Uint8Array(await file.arrayBuffer())
  await writeFile(targetPath, bytes)
  const relativePath = normalizeRelativePath(root, targetPath)
  const importId = `upload.${normalizeImportId(slot.id)}`
  const resourceImport: BeeGameResourceImport = {
    id: importId,
    source: { type: 'user-upload' },
    status: 'available',
    root_path: relativePath,
    local_files: [relativePath],
    selected_at: new Date().toISOString(),
    selection_reason: ['user-provided-for-requirement'],
  }
  const updatedSlot: BeeGameAssetSlot = {
    ...slot,
    status: 'placeholder',
    placeholder: true,
    satisfied_by: {
      ...(slot.satisfied_by ?? {}),
      import_ids: [...new Set([...(slot.satisfied_by?.import_ids ?? []).filter(id => id !== importId), importId])],
    },
    updated_at: new Date().toISOString(),
  }
  manifest.requirements[slotIndex] = updatedSlot
  manifest.imports = [...(manifest.imports ?? []).filter(entry => entry.id !== importId), resourceImport]
  await writeAssetManifest(root, manifest)
  return {
    manifest,
    requirement: updatedSlot,
    path: relativePath,
    message: buildUploadMessage(updatedSlot, relativePath, manifest.project_target),
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

  const dependencyInput: BeeGameResourceBinding = {
    pack_id: input.pack_id,
    pack_version: input.pack_version,
    element_id: input.element_id,
    element_path: input.element_path,
    source_url: input.source_url,
    selected_at: new Date().toISOString(),
    selection_reason: input.selection_reason ?? [],
    dependencies: input.dependencies?.map(dependency => ({
      key: dependency.key,
      parent_key: dependency.parent_key,
      element_id: dependency.element_id,
      element_path: dependency.element_path,
      reference_path: dependency.reference_path,
      source_url: dependency.source_url,
      ...(dependency.kind ? { kind: dependency.kind } : {}),
    })),
  }
  const pendingDependencies = await prepareBoundResourceDependencies(
    root,
    targetPath,
    dependencyInput,
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
  binding: BeeGameResourceBinding,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  allowedFormats: readonly string[],
): Promise<Array<{ key: string; targetPath: string; bytes: Uint8Array }>> {
  const targets = new Map<string, string>([['root', rootTargetPath]])
  const pending: Array<{ key: string; targetPath: string; bytes: Uint8Array }> = []
  for (const dependency of binding.dependencies ?? []) {
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
  const requirements = record.requirements
    .map(requirement => normalizeAssetSlot(requirement))
    .filter(Boolean) as BeeGameAssetSlot[]
  const explicitImports = normalizeResourceImports(record.imports)
  return {
    version: normalizeManifestVersion(record.version),
    project_target: normalizeProjectTarget(record.project_target ?? record),
    requirements,
    imports: explicitImports,
    compositions: normalizeAssetCompositions(record.compositions),
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

/**
 * Legacy generated projects may claim an asset is integrated even if a copied
 * binary contradicts its filename. Only objective container signatures are
 * reconciled here; normal missing-file and runtime concerns stay with adapters.
 */
async function reconcileAssetContractFiles(
  root: string,
  manifest: BeeGameAssetManifest,
): Promise<BeeGameAssetManifest> {
  const requirements = await Promise.all(manifest.requirements.map(async slot => {
    // The manifest is only a record of an integration attempt; it cannot be
    // used as proof that a local file still exists. Reconcile every uploaded
    // or integrated slot against its declared target, whether it originated
    // from the resource library or from a manual upload.
    const expectedPaths = expectedAssetPaths(root, slot)
    if ((slot.status === 'uploaded' || slot.status === 'integrated') && expectedPaths.length) {
      const missingPaths = expectedPaths.filter(path => !existsSync(path))
      if (missingPaths.length) {
        return {
          ...slot,
          status: 'missing' as const,
          placeholder: true,
          integration_error: 'One or more project asset files are missing.',
          updated_at: new Date().toISOString(),
        }
      }
    }
    const candidatePaths = [slot.target?.path, ...(slot.uploaded_files ?? [])]
      .filter((path): path is string => Boolean(path?.trim()))
    for (const candidatePath of candidatePaths) {
      const declaredFormat = extensionOf(candidatePath)
      if (!declaredFormat) continue
      try {
        const bytes = await readResourceSignature(resolveInsideWorkspace(root, candidatePath))
        const detectedFormat = detectResourceBinaryFormat(bytes)
        if (detectedFormat && !formatsAgree(declaredFormat, detectedFormat)) {
          return {
            ...slot,
            status: 'failed' as const,
            placeholder: true,
            integration_error: `File format mismatch: expected .${declaredFormat}, found ${detectedFormat}`,
            updated_at: new Date().toISOString(),
          }
        }
      } catch {
        // Missing files are handled by the normal project asset workflow.
      }
    }
    return slot
  }))
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
  return { ...manifest, requirements, imports }
}

function expectedAssetPaths(root: string, slot: BeeGameAssetSlot): string[] {
  const declaredPaths = slot.target?.path ? [slot.target.path] : slot.uploaded_files ?? []
  if (!declaredPaths.length) return []
  try {
    const paths = declaredPaths.map(path => resolveInsideWorkspace(root, path))
    const rootTargetPath = paths[0]
    for (const dependency of slot.resource_binding?.dependencies ?? []) {
      paths.push(resolveDependencyTarget(root, dirname(rootTargetPath), dependency.reference_path))
    }
    return [...new Set(paths)]
  } catch {
    // An unsafe or malformed historical path is reported as missing. The
    // integration executor will retain the binding and return a precise error.
    return declaredPaths
  }
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

function normalizeAssetSlot(
  value: unknown,
  fallbackId = '',
  fallback?: { type?: string; purpose?: string },
): BeeGameAssetSlot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const replacement = objectValue(record.replacement) ?? {}
  const id = normalizeSlotId(String(record.id || record.slot_id || fallbackId))
  if (!id) return undefined
  const target = record.target && typeof record.target === 'object' && !Array.isArray(record.target)
    ? record.target as Record<string, unknown>
    : {}
  const provider = record.integration_provider &&
    typeof record.integration_provider === 'object' &&
    !Array.isArray(record.integration_provider)
    ? record.integration_provider as Record<string, unknown>
    : {}
  const specs = objectValue(record.recommended_specs) || objectValue(record.specs) || objectValue(replacement.specs)
  const legacySpecs = collectLegacySpecs(record)
  const formats = stringArray(record.accepted_formats)
  const legacyFormats = normalizeLegacyFormats(record.format)
  const satisfiedBy = objectValue(record.satisfied_by)
  const evidence = objectValue(record.integration_evidence)
  return {
    id,
    name: trimString(record.name),
    type: trimString(record.type) || trimString(fallback?.type),
    purpose: trimString(record.purpose) || trimString(record.description) || trimString(fallback?.purpose),
    required: Boolean(record.required),
    placeholder: record.placeholder !== false &&
      record.status !== 'implemented' &&
      record.placeholder_status !== 'implemented',
    accepted_formats: formats.length ? formats : legacyFormats,
    recommended_specs: specs || legacySpecs,
    target: {
      path: trimString(target.path) || trimString(record.path) || trimString(record.target_path) || trimString(replacement.target_path),
      integration_notes: trimString(target.integration_notes),
    },
    integration_provider: {
      type: normalizeIntegrationMode(provider.type),
      server: trimString(provider.server),
      capabilities: stringArray(provider.capabilities),
    },
    status: normalizeSlotStatus(record.status ?? record.placeholder_status),
    uploaded_files: stringArray(record.uploaded_files),
    uploaded_urls: stringArray(record.uploaded_urls),
    resource_requirement: normalizeResourceRequirement(record.resource_requirement ?? replacement.resource_requirement),
    ...(satisfiedBy ? { satisfied_by: { import_ids: stringArray(satisfiedBy.import_ids), composition_ids: stringArray(satisfiedBy.composition_ids), project_references: stringArray(satisfiedBy.project_references) } } : {}),
    resource_binding: normalizeResourceBinding(record.resource_binding),
    ...(evidence ? { integration_evidence: { references: stringArray(evidence.references), runtime_event_ids: stringArray(evidence.runtime_event_ids) } } : {}),
    integration_error: trimString(record.integration_error),
    updated_at: trimString(record.updated_at),
  }
}

function normalizeResourceRequirement(value: unknown): BeeGameResourceRequirement | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const category = normalizeResourceCategory(record.category)
  const dimension = record.dimension === '2D' || record.dimension === '3D' || record.dimension === 'agnostic'
    ? record.dimension
    : undefined
  const acceptedFormats = stringArray(record.accepted_formats ?? record.acceptedFormats)
  const styles = stringArray(record.styles)
  const gameTypes = stringArray(record.game_types ?? record.gameTypes)
  const tags = stringArray(record.tags).filter((tag): tag is ResourceUsageTag =>
    (RESOURCE_USAGE_TAGS as readonly string[]).includes(tag),
  )
  const assetKinds = stringArray(record.asset_kinds ?? record.assetKinds).filter((kind): kind is ResourceAssetKind =>
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
  const signature = trimString(record.skeleton_signature ?? record.skeletonSignature)
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
  const targetElementId = trimString(record.target_element_id ?? record.targetElementId)
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
  const assemblyMode = record.assembly_mode === 'direct' || record.assemblyMode === 'direct'
    ? 'direct'
    : record.assembly_mode === 'composed' || record.assemblyMode === 'composed'
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
  const importId = trimString(record.import_id ?? record.importId)
  const requirementId = trimString(record.requirement_id ?? record.requirementId ?? record.slot_id ?? record.slotId)
  const compositionId = trimString(record.composition_id ?? record.compositionId)
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

function normalizeResourceBinding(value: unknown): BeeGameResourceBinding | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const packId = trimString(record.pack_id)
  const packVersion = trimString(record.pack_version)
  const elementId = trimString(record.element_id)
  const sourceUrl = trimString(record.source_url)
  const selectedAt = trimString(record.selected_at)
  if (!packId || !packVersion || !elementId || !sourceUrl || !selectedAt) return undefined
  return {
    pack_id: packId,
    pack_version: packVersion,
    element_id: elementId,
    ...(trimString(record.element_path) ? { element_path: trimString(record.element_path) } : {}),
    ...(trimString(record.content_format) ? { content_format: trimString(record.content_format) } : {}),
    source_url: sourceUrl,
    selected_at: selectedAt,
    selection_reason: stringArray(record.selection_reason),
    ...(Array.isArray(record.dependencies) ? { dependencies: record.dependencies.map(normalizeBindingDependency).filter((dependency): dependency is BeeGameResourceBindingDependency => Boolean(dependency)) } : {}),
  }
}

function normalizeBindingDependency(value: unknown): BeeGameResourceBindingDependency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const key = trimString(record.key)
  const parentKey = trimString(record.parent_key)
  const elementId = trimString(record.element_id)
  const elementPath = trimString(record.element_path)
  const referencePath = trimString(record.reference_path)
  const sourceUrl = trimString(record.source_url)
  if (!key || !parentKey || !elementId || !elementPath || !referencePath || !sourceUrl) return undefined
  return { key, parent_key: parentKey, element_id: elementId, element_path: elementPath, reference_path: referencePath, source_url: sourceUrl, ...(trimString(record.kind) ? { kind: trimString(record.kind) } : {}) }
}

function normalizeProjectTarget(value: unknown): BeeGameAssetProjectTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    platform: trimString(record.platform) || trimString(record.kind),
    runtime: trimString(record.runtime) || trimString(record.engine),
    integration_mode: normalizeIntegrationMode(record.integration_mode),
    mcp_server: trimString(record.mcp_server),
    asset_format_capabilities: stringArray(record.asset_format_capabilities ?? record.supported_asset_formats),
    resource_library_usage: normalizeResourceLibraryUsage(record.resource_library_usage ?? migrateLegacyResourceUsage(record.resource_sourcing_policy)),
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

function migrateLegacyResourceUsage(value: unknown): ResourceLibraryUsage | undefined {
  const legacy = trimString(value)
  if (legacy === 'library_required') return 'required'
  if (legacy === 'library_first') return 'preferred'
  if (legacy === 'author_choice') return 'optional'
  return undefined
}

function assertAssetFormatAllowed(filename: string, slot: BeeGameAssetSlot, target?: BeeGameAssetProjectTarget): void {
  assertFilenameFormatAllowed(filename, effectiveAssetFormats(slot, target))
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

function normalizeSlotStatus(value: unknown): BeeGameAssetSlot['status'] {
  if (value === 'satisfied') return 'integrated'
  if (value === 'blocked') return 'missing'
  if (value === 'planned') return 'placeholder'
  return value === 'uploaded' ||
    value === 'integrated' ||
    value === 'implemented' ||
    value === 'missing' ||
    value === 'failed'
    ? value === 'implemented' ? 'integrated' : value
    : value === 'not_implemented'
      ? 'missing'
    : 'placeholder'
}

function normalizeLegacyFormats(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean)
  return stringArray(value)
}

function collectLegacySpecs(record: Record<string, unknown>): Record<string, unknown> | undefined {
  const specs: Record<string, unknown> = {}
  for (const key of ['dimensions', 'loop', 'category', 'note']) {
    if (record[key] !== undefined) specs[key] = record[key]
  }
  if (record.spec !== undefined) specs.description = record.spec
  return Object.keys(specs).length ? specs : undefined
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function resolveUploadTarget(root: string, slot: BeeGameAssetSlot, filename: string): string {
  const normalizedFilename = sanitizeFilename(filename)
  const targetPath = trimString(slot.target?.path)
  if (targetPath && isConcreteRelativePath(targetPath)) {
    const extension = extname(targetPath)
    const sourceExtension = extname(normalizedFilename)
    const target = extension && sourceExtension && extension.toLocaleLowerCase() !== sourceExtension.toLocaleLowerCase()
      ? join(dirname(targetPath), `${basename(targetPath, extension)}${sourceExtension}`)
      : extension
      ? targetPath
      : join(targetPath, normalizedFilename)
    return resolveInsideWorkspace(root, target)
  }
  return resolveInsideWorkspace(root, join(ASSET_UPLOAD_ROOT, slot.id, normalizedFilename))
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
    requirements: manifest.requirements.map(slot => {
      const satisfiedBy = {
        import_ids: [...new Set(slot.satisfied_by?.import_ids ?? [])],
        composition_ids: slot.satisfied_by?.composition_ids ?? [],
        project_references: [...new Set([...(slot.satisfied_by?.project_references ?? []), ...(slot.integration_evidence?.references ?? [])])],
      }
      return {
        id: slot.id,
        ...(slot.name ? { name: slot.name } : {}),
        ...(slot.purpose ? { purpose: slot.purpose } : {}),
        required: slot.required !== false,
        ...(slot.resource_requirement ? { resource_requirement: slot.resource_requirement } : {}),
        ...(satisfiedBy.import_ids.length || satisfiedBy.composition_ids.length || satisfiedBy.project_references.length ? { satisfied_by: satisfiedBy } : {}),
        status: slot.status === 'integrated' ? 'satisfied' : slot.status === 'failed' || slot.status === 'missing' ? 'blocked' : 'planned',
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
  slot: BeeGameAssetSlot,
  path: string,
  target?: BeeGameAssetProjectTarget,
): string {
  const mode = slot.integration_provider?.type || target?.integration_mode || 'filesystem'
  const provider = mode === 'mcp'
    ? ` Use the configured MCP integration${slot.integration_provider?.server ? ` (${slot.integration_provider.server})` : ''} if it is available.`
    : ' Use normal project files and commands to integrate it.'
  return [
    `Asset imported for requirement "${slot.id}".`,
    `File: ${path}.`,
    slot.purpose ? `Purpose: ${slot.purpose}.` : '',
    slot.target?.integration_notes ? `Integration notes: ${slot.target.integration_notes}.` : '',
    'The import remains available inventory until target-native project code or a composition references it and runtime verification succeeds.',
    `${provider} Update project references, validate that the asset works in the game, and update assets/asset-manifest.json with the real integration status.`,
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

function normalizeSlotId(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_.:-]+/g, '_')
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
