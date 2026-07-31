import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
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

export const BEEGAME_ASSET_INTEGRATION_MODES = [
  'filesystem',
  'mcp',
  'manual',
] as const
export const BEEGAME_REQUIREMENT_STATUSES = [
  'planned',
  'satisfied',
  'blocked',
] as const
export const BEEGAME_RESOURCE_NO_MATCH_OUTCOMES = [
  'authored-asset',
  'runtime-generated',
  'system-provided',
  'silent',
  'blocked',
] as const

export type BeeGameAssetIntegrationMode =
  (typeof BEEGAME_ASSET_INTEGRATION_MODES)[number]

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
  /** SHA-256 receipts for every materialized project file. */
  local_file_hashes?: Record<string, string>
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
  /** Explicit inventory ceiling chosen from the approved asset plan. */
  import_budget?: number
  /** Exact single outcome when no compatible library candidate is selected. */
  no_match: (typeof BEEGAME_RESOURCE_NO_MATCH_OUTCOMES)[number]
}

export type BeeGameRequirementSourceType =
  | 'resource-library'
  | 'authored-asset'
  | 'runtime-generated'
  | 'system-provided'
  | 'silent'
  | 'unavailable'

export type BeeGameRequirementSourceDecision = {
  type: BeeGameRequirementSourceType
  reasons: string[]
  decided_at: string
  basis?: 'resource-import' | 'catalog-no-match' | 'approved-project-plan'
  discovery_receipt?: BeeGameRequirementDiscoveryReceipt
}

export type BeeGameRequirementDiscoveryReceipt = {
  version: 1
  query_digest: string
  candidate_digest: string
  candidate_ids: string[]
  inspected_pack_ids: string[]
  represented_pack_ids: string[]
  candidate_count: number
  total_compatible: number
  structured_constraint_count: number
  decision_ready: true
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
  const requirementFormats = normalizeFormats(
    requirement.resource_requirement?.accepted_formats,
  )
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
  source_decision?: BeeGameRequirementSourceDecision
  satisfied_by?: {
    import_ids?: string[]
    composition_ids?: string[]
    project_references?: string[]
  }
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

export type BeeGameAssetUploadOptions = {
  persist?: (manifest: BeeGameAssetManifest) => Promise<void>
}

const ASSET_MANIFEST_PATH = 'assets/asset-manifest.json'
export const ASSET_IMPORT_RECEIPTS_PATH =
  '.beegame/resources/import-receipts.json'
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
  requirements: [
    {
      id: '<stable-game-responsibility-id>',
      required: true,
      status: 'planned',
      resource_requirement: {
        accepted_formats: ['<actual-file-extension>'],
        purpose: '<authored-game-purpose>',
        import_budget: 1,
        no_match: 'authored-asset',
      },
      satisfied_by: {
        import_ids: [],
        composition_ids: [],
        project_references: [],
      },
    },
  ],
  imports: [
    {
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
    },
  ],
  compositions: [
    {
      id: '<stable-composition-id>',
      kind: 'scene',
      assembly_mode: 'composed',
      status: 'planned',
      members: [
        { import_id: '<stable-import-id>', role: '<target-native-role>' },
      ],
      recipe: { path: '<workspace-relative-target-native-recipe>' },
    },
  ],
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
  const manifest = mergeImportReceipts(
    root,
    parseCanonicalBeeGameAssetManifest(parsed),
  )
  return reconcileAssetContractFiles(root, manifest)
}

export async function uploadBeeGameAsset(
  workspacePath: string,
  requirementId: string,
  file: File,
  options: BeeGameAssetUploadOptions = {},
): Promise<BeeGameAssetUploadResult> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedRequirementId = normalizeImportId(requirementId)
  const requirementIndex = manifest.requirements.findIndex(
    requirement => requirement.id === normalizedRequirementId,
  )
  if (requirementIndex < 0)
    throw new Error(`Asset requirement not found: ${normalizedRequirementId}`)
  const requirement = manifest.requirements[requirementIndex]!
  assertAssetFormatAllowed(file.name, requirement, manifest.project_target)
  const targetPath = resolveUploadTarget(
    root,
    requirement,
    file.name,
    manifest.project_target,
  )
  const bytes = new Uint8Array(await file.arrayBuffer())
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
      import_ids: [
        ...new Set([
          ...(requirement.satisfied_by?.import_ids ?? []).filter(
            id => id !== importId,
          ),
          importId,
        ]),
      ],
    },
  }
  manifest.requirements[requirementIndex] = updatedRequirement
  manifest.imports = [
    ...(manifest.imports ?? []).filter(entry => entry.id !== importId),
    resourceImport,
  ]
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  const rollback = await commitResourceWrites([
    { targetPath, bytes },
    {
      targetPath: manifestPath,
      bytes: new TextEncoder().encode(serializeAssetManifest(manifest)),
    },
  ])
  try {
    await options.persist?.(manifest)
  } catch (error) {
    await rollback()
    throw error
  }
  return {
    manifest,
    requirement: updatedRequirement,
    path: relativePath,
    message: buildUploadMessage(updatedRequirement, relativePath),
  }
}

export type BeeGameResolvedResourceImportInput = {
  id: string
  requirement_ids?: string[]
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
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<{
  manifest: BeeGameAssetManifest
  resourceImport: BeeGameResourceImport
}> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const importId = normalizeImportId(input.id)
  if (!importId) throw new Error('Resource import id is required')
  const existingImport = (manifest.imports ?? []).find(
    entry => entry.id === importId,
  )
  if (existingImport && !isSamePinnedLibraryImport(existingImport, input)) {
    throw new Error(
      `Resource import id belongs to a different pinned resource: ${importId}`,
    )
  }
  const filename = sanitizeFilename(input.element_path)
  assertFilenameFormatAllowed(
    filename,
    normalizeFormats(manifest.project_target?.asset_format_capabilities),
  )
  for (const requirementId of input.requirement_ids ?? []) {
    const requirement = manifest.requirements.find(
      candidate => candidate.id === requirementId,
    )
    if (!requirement)
      throw new Error(`Resource requirement does not exist: ${requirementId}`)
    if (!requirement.resource_requirement)
      throw new Error(
        `Resource requirement does not accept imported files: ${requirementId}`,
      )
    assertFilenameFormatAllowed(
      filename,
      effectiveAssetFormats(requirement, manifest.project_target),
    )
  }
  const targetPath = resolveImportTarget(root, input.destination_path, filename)
  assertImportInsideRuntimeAssetRoot(root, targetPath, manifest.project_target)
  const rootPath = normalizeRelativePath(root, targetPath)
  if (existingImport && existingImport.root_path !== rootPath) {
    throw new Error(
      `Resource import destination differs from its pinned project path: ${importId}`,
    )
  }
  if (existsSync(targetPath) && !existingImport) {
    throw new Error(`Resource import target already exists: ${rootPath}`)
  }
  if (
    existingImport &&
    (await importedFilesMatchReceipts(root, existingImport))
  ) {
    const bound = bindImportToRequirements(
      manifest,
      importId,
      input.requirement_ids ?? [],
    )
    if (bound.changed) await writeAssetManifest(root, bound.manifest)
    return { manifest: bound.manifest, resourceImport: existingImport }
  }

  const response = await fetchImpl(input.source_url)
  if (!response.ok)
    throw new Error(`Resource download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const declaredFormat = extensionOf(filename)
  const detectedFormat = detectResourceBinaryFormat(bytes)
  if (
    detectedFormat &&
    declaredFormat &&
    !formatsAgree(declaredFormat, detectedFormat)
  ) {
    throw new Error(
      `Resource binary format mismatch: library declares .${declaredFormat}, received ${detectedFormat}`,
    )
  }
  let writeRoot = true
  if (existingImport && existsSync(targetPath)) {
    const existingBytes = await readExistingResourceFile(targetPath, root)
    if (existingBytes.byteLength > 0 && !bytesEqual(existingBytes, bytes)) {
      throw new Error(
        `Pinned resource file was modified locally and will not be overwritten: ${rootPath}`,
      )
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
  const allTargets = [
    targetPath,
    ...pendingDependencies.map(dependency => dependency.targetPath),
  ]
  const duplicateTarget = allTargets.find(
    (target, index) => allTargets.indexOf(target) !== index,
  )
  if (duplicateTarget)
    throw new Error(
      `Resource import dependency target is duplicated: ${normalizeRelativePath(root, duplicateTarget)}`,
    )
  const dependenciesToWrite: typeof pendingDependencies = []
  for (const dependency of pendingDependencies) {
    if (!existsSync(dependency.targetPath)) {
      dependenciesToWrite.push(dependency)
      continue
    }
    const existingBytes = new Uint8Array(await readFile(dependency.targetPath))
    if (!bytesEqual(existingBytes, dependency.bytes)) {
      throw new Error(
        `Resource import dependency target already exists with different content: ${normalizeRelativePath(root, dependency.targetPath)}`,
      )
    }
  }

  const rollbackFiles = await commitResourceWrites([
    ...(writeRoot ? [{ targetPath, bytes }] : []),
    ...dependenciesToWrite.map(dependency => ({
      targetPath: dependency.targetPath,
      bytes: dependency.bytes,
    })),
  ])
  const dependencies = (input.dependencies ?? []).map(dependency => {
    const copied = pendingDependencies.find(
      candidate => candidate.key === dependency.key,
    )
    return {
      key: dependency.key,
      parent_key: dependency.parent_key,
      element_id: dependency.element_id,
      element_path: dependency.element_path,
      reference_path: dependency.reference_path,
      local_path: copied
        ? normalizeRelativePath(root, copied.targetPath)
        : normalizeRelativePath(
            root,
            resolveDependencyTarget(
              root,
              dirname(targetPath),
              dependency.reference_path,
            ),
          ),
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
    status:
      existingImport?.status === 'referenced' ? 'referenced' : 'available',
    root_path: rootPath,
    local_files: [
      rootPath,
      ...pendingDependencies.map(dependency =>
        normalizeRelativePath(root, dependency.targetPath),
      ),
    ],
    local_file_hashes: Object.fromEntries([
      [rootPath, sha256(bytes)],
      ...pendingDependencies.map(dependency => [
        normalizeRelativePath(root, dependency.targetPath),
        sha256(dependency.bytes),
      ]),
    ]),
    selected_at: new Date().toISOString(),
    selection_reason: input.selection_reason ?? [],
    ...(input.asset_kind ? { asset_kind: input.asset_kind } : {}),
    ...(input.capabilities?.length ? { capabilities: input.capabilities } : {}),
    ...(input.content_profile
      ? { content_profile: input.content_profile }
      : {}),
    ...(input.technical_facts
      ? { technical_facts: input.technical_facts }
      : {}),
    ...(dependencies.length ? { dependencies } : {}),
    ...(existingImport?.usage_evidence
      ? { usage_evidence: existingImport.usage_evidence }
      : {}),
  }
  const inventoryManifest: BeeGameAssetManifest = {
    ...manifest,
    version: Math.max(CURRENT_ASSET_MANIFEST_VERSION, manifest.version),
    imports: [
      ...(manifest.imports ?? []).filter(entry => entry.id !== importId),
      resourceImport,
    ],
  }
  const updatedManifest = bindImportToRequirements(
    inventoryManifest,
    importId,
    input.requirement_ids ?? [],
  ).manifest
  try {
    await writeAssetManifest(root, updatedManifest)
  } catch (error) {
    await rollbackFiles()
    throw error
  }
  return { manifest: updatedManifest, resourceImport }
}

function bindImportToRequirements(
  manifest: BeeGameAssetManifest,
  importId: string,
  requirementIds: readonly string[],
): { manifest: BeeGameAssetManifest; changed: boolean } {
  if (!requirementIds.length) return { manifest, changed: false }
  const selected = new Set(requirementIds)
  let changed = false
  const requirements = manifest.requirements.map(requirement => {
    if (!selected.has(requirement.id)) return requirement
    const existing = requirement.satisfied_by?.import_ids ?? []
    const alreadyBound = existing.includes(importId)
    const alreadyRecorded =
      requirement.source_decision?.type === 'resource-library'
    if (alreadyBound && alreadyRecorded) return requirement
    changed = true
    return {
      ...requirement,
      source_decision: {
        type: 'resource-library' as const,
        reasons: [
          'A compatible Resource Library element was explicitly selected and imported.',
        ],
        decided_at: new Date().toISOString(),
        basis: 'resource-import' as const,
      },
      satisfied_by: {
        ...(requirement.satisfied_by ?? {}),
        import_ids: alreadyBound ? existing : [...existing, importId],
      },
    }
  })
  return changed
    ? { manifest: { ...manifest, requirements }, changed }
    : { manifest, changed }
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
  const imports = await Promise.all(
    (manifest.imports ?? []).map(async resourceImport => {
      const update = updatesById.get(resourceImport.id)
      const localFileHashes = await hashExistingImportFiles(
        root,
        resourceImport,
      )
      if (!update || resourceImport.source.type !== 'resource-library') {
        return {
          ...resourceImport,
          ...(localFileHashes ? { local_file_hashes: localFileHashes } : {}),
        }
      }
      if (
        resourceImport.source.pack_id !== update.pack_id ||
        resourceImport.source.pack_version !== update.pack_version ||
        resourceImport.source.element_id !== update.element_id
      ) {
        return {
          ...resourceImport,
          ...(localFileHashes ? { local_file_hashes: localFileHashes } : {}),
        }
      }
      refreshedImportIds.push(resourceImport.id)
      return {
        ...resourceImport,
        ...(localFileHashes ? { local_file_hashes: localFileHashes } : {}),
        ...(update.asset_kind ? { asset_kind: update.asset_kind } : {}),
        ...(update.capabilities
          ? { capabilities: [...update.capabilities] }
          : {}),
        ...(update.content_profile
          ? { content_profile: update.content_profile }
          : {}),
        ...(update.technical_facts
          ? { technical_facts: { ...update.technical_facts } }
          : {}),
      }
    }),
  )
  const updatedManifest = { ...manifest, imports }
  if (
    refreshedImportIds.length ||
    imports.some(
      (resourceImport, index) =>
        !stringRecordsEqual(
          resourceImport.local_file_hashes,
          manifest.imports?.[index]?.local_file_hashes,
        ),
    )
  )
    await writeAssetManifest(root, updatedManifest)
  return { manifest: updatedManifest, refreshedImportIds }
}

function isSamePinnedLibraryImport(
  resourceImport: BeeGameResourceImport,
  input: BeeGameResolvedResourceImportInput,
): boolean {
  return (
    resourceImport.source.type === 'resource-library' &&
    resourceImport.source.pack_id === input.pack_id &&
    resourceImport.source.pack_version === input.pack_version &&
    resourceImport.source.element_id === input.element_id &&
    resourceImport.source.element_path === input.element_path
  )
}

async function readExistingResourceFile(
  path: string,
  root: string,
): Promise<Uint8Array> {
  try {
    return new Uint8Array(await readFile(path))
  } catch {
    throw new Error(
      `Pinned resource path is not a readable file: ${normalizeRelativePath(root, path)}`,
    )
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

async function importedFilesMatchReceipts(
  root: string,
  resourceImport: BeeGameResourceImport,
): Promise<boolean> {
  const receipts = resourceImport.local_file_hashes
  if (!receipts || resourceImport.local_files.length === 0) return false
  if (resourceImport.local_files.some(path => !isSha256(receipts[path])))
    return false
  for (const path of resourceImport.local_files) {
    try {
      const bytes = new Uint8Array(
        await readFile(resolveInsideWorkspace(root, path)),
      )
      if (sha256(bytes) !== receipts[path]) return false
    } catch {
      return false
    }
  }
  return true
}

async function hashExistingImportFiles(
  root: string,
  resourceImport: BeeGameResourceImport,
): Promise<Record<string, string> | undefined> {
  const hashes: Array<[string, string]> = []
  for (const path of resourceImport.local_files) {
    try {
      hashes.push([
        path,
        sha256(
          new Uint8Array(await readFile(resolveInsideWorkspace(root, path))),
        ),
      ])
    } catch {
      return undefined
    }
  }
  return hashes.length ? Object.fromEntries(hashes) : undefined
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSha256(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 64) return false
  for (const char of value) {
    if (!'0123456789abcdef'.includes(char)) return false
  }
  return true
}

function stringRecordsEqual(
  left?: Record<string, string>,
  right?: Record<string, string>,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  const leftEntries = Object.entries(left)
  return (
    leftEntries.length === Object.keys(right).length &&
    leftEntries.every(([key, value]) => right[key] === value)
  )
}

async function prepareBoundResourceDependencies(
  root: string,
  rootTargetPath: string,
  resource: Pick<BeeGameResolvedResourceImportInput, 'dependencies'>,
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
  allowedFormats: readonly string[],
): Promise<Array<{ key: string; targetPath: string; bytes: Uint8Array }>> {
  const targets = new Map<string, string>([['root', rootTargetPath]])
  const pending: Array<{ key: string; targetPath: string; bytes: Uint8Array }> =
    []
  for (const dependency of resource.dependencies ?? []) {
    assertFilenameFormatAllowed(dependency.element_path, allowedFormats)
    const parentTarget = targets.get(dependency.parent_key)
    if (!parentTarget)
      throw new Error(
        `Resource dependency parent is missing: ${dependency.parent_key}`,
      )
    const targetPath = resolveDependencyTarget(
      root,
      dirname(parentTarget),
      dependency.reference_path,
    )
    const response = await fetchImpl(dependency.source_url)
    if (!response.ok)
      throw new Error(
        `Resource dependency download failed (${response.status}) for ${dependency.element_path}`,
      )
    const bytes = new Uint8Array(await response.arrayBuffer())
    const declaredFormat = extensionOf(dependency.element_path)
    const detectedFormat = detectResourceBinaryFormat(bytes)
    if (
      detectedFormat &&
      declaredFormat &&
      !formatsAgree(declaredFormat, detectedFormat)
    ) {
      throw new Error(
        `Resource dependency binary format mismatch for ${dependency.element_path}`,
      )
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
      snapshots.push({
        targetPath: write.targetPath,
        ...(previous ? { previous } : {}),
      })
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

function resolveDependencyTarget(
  root: string,
  parentDirectory: string,
  referencePath: string,
): string {
  const normalizedReference = referencePath.split('\\').join('/')
  if (
    !normalizedReference ||
    normalizedReference.startsWith('/') ||
    normalizedReference.split('/').includes('')
  ) {
    throw new Error('Resource dependency reference path is unsafe')
  }
  return resolveInsideWorkspace(
    root,
    resolve(parentDirectory, normalizedReference),
  )
}

/** Parses the current authoring contract without repairing or dropping data. */
export function parseCanonicalBeeGameAssetManifest(
  value: unknown,
): BeeGameAssetManifest {
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
  if (!objectValue(record.project_target))
    issues.push('project_target must be an object.')
  if (!Array.isArray(record.requirements))
    issues.push('requirements must be an array.')
  if (!Array.isArray(record.imports)) issues.push('imports must be an array.')
  if (
    record.compositions !== undefined &&
    !Array.isArray(record.compositions)
  ) {
    issues.push('compositions must be an array when present.')
  }
  if (issues.length) return issues

  validateKnownFields(
    record,
    ['version', 'project_target', 'requirements', 'imports', 'compositions'],
    'root',
    issues,
  )

  validateCanonicalProjectTarget(
    record.project_target as Record<string, unknown>,
    issues,
  )
  ;(record.requirements as unknown[]).forEach((entry, index) => {
    validateCanonicalRequirement(entry, `requirements[${index}]`, issues)
  })
  ;(record.imports as unknown[]).forEach((entry, index) => {
    validateCanonicalImport(entry, `imports[${index}]`, issues)
  })
  ;((record.compositions as unknown[] | undefined) ?? []).forEach(
    (entry, index) => {
      validateCanonicalComposition(entry, `compositions[${index}]`, issues)
    },
  )
  return issues
}

function validateCanonicalProjectTarget(
  record: Record<string, unknown>,
  issues: string[],
): void {
  validateKnownFields(
    record,
    [
      'platform',
      'runtime',
      'integration_mode',
      'mcp_server',
      'asset_format_capabilities',
      'resource_library_usage',
      'runtime_asset_root',
    ],
    'project_target',
    issues,
  )
  validateOptionalString(record.platform, 'project_target.platform', issues)
  validateOptionalString(record.runtime, 'project_target.runtime', issues)
  validateOptionalString(record.mcp_server, 'project_target.mcp_server', issues)
  validateOptionalString(
    record.runtime_asset_root,
    'project_target.runtime_asset_root',
    issues,
  )
  validateOptionalEnum(
    record.integration_mode,
    BEEGAME_ASSET_INTEGRATION_MODES,
    'project_target.integration_mode',
    issues,
  )
  validateOptionalEnum(
    record.resource_library_usage,
    RESOURCE_LIBRARY_USAGE,
    'project_target.resource_library_usage',
    issues,
  )
  validateStringArray(
    record.asset_format_capabilities,
    'project_target.asset_format_capabilities',
    issues,
    true,
    true,
  )
  validateFileExtensions(
    record.asset_format_capabilities,
    'project_target.asset_format_capabilities',
    issues,
  )
}

function validateCanonicalRequirement(
  value: unknown,
  path: string,
  issues: string[],
): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateKnownFields(
    record,
    [
      'id',
      'name',
      'purpose',
      'required',
      'resource_requirement',
      'source_decision',
      'satisfied_by',
      'status',
    ],
    path,
    issues,
  )
  validateCanonicalRequirementId(record.id, `${path}.id`, issues)
  validateOptionalString(record.name, `${path}.name`, issues)
  validateOptionalString(record.purpose, `${path}.purpose`, issues)
  if (record.required !== undefined && typeof record.required !== 'boolean')
    issues.push(`${path}.required must be a boolean.`)
  validateOptionalEnum(
    record.status,
    BEEGAME_REQUIREMENT_STATUSES,
    `${path}.status`,
    issues,
  )
  if (record.resource_requirement !== undefined) {
    const requirement = objectValue(record.resource_requirement)
    if (!requirement)
      issues.push(`${path}.resource_requirement must be an object.`)
    else
      validateCanonicalResourceRequirement(
        requirement,
        `${path}.resource_requirement`,
        issues,
      )
  }
  if (record.source_decision !== undefined) {
    const decision = objectValue(record.source_decision)
    if (!decision) issues.push(`${path}.source_decision must be an object.`)
    else {
      validateKnownFields(
        decision,
        ['type', 'reasons', 'decided_at', 'basis', 'discovery_receipt'],
        `${path}.source_decision`,
        issues,
      )
      validateOptionalEnum(
        decision.type,
        [
          'resource-library',
          'authored-asset',
          'runtime-generated',
          'system-provided',
          'silent',
          'unavailable',
        ],
        `${path}.source_decision.type`,
        issues,
        true,
      )
      validateStringArray(
        decision.reasons,
        `${path}.source_decision.reasons`,
        issues,
        true,
      )
      validateRequiredString(
        decision.decided_at,
        `${path}.source_decision.decided_at`,
        issues,
      )
      validateOptionalEnum(
        decision.basis,
        ['resource-import', 'catalog-no-match', 'approved-project-plan'],
        `${path}.source_decision.basis`,
        issues,
      )
      if (decision.discovery_receipt !== undefined) {
        const receipt = objectValue(decision.discovery_receipt)
        if (!receipt)
          issues.push(
            `${path}.source_decision.discovery_receipt must be an object.`,
          )
        else {
          validateKnownFields(
            receipt,
            [
              'version',
              'query_digest',
              'candidate_digest',
              'candidate_ids',
              'inspected_pack_ids',
              'represented_pack_ids',
              'candidate_count',
              'total_compatible',
              'structured_constraint_count',
              'decision_ready',
            ],
            `${path}.source_decision.discovery_receipt`,
            issues,
          )
          if (receipt.version !== 1)
            issues.push(
              `${path}.source_decision.discovery_receipt.version must be 1.`,
            )
          validateRequiredString(
            receipt.query_digest,
            `${path}.source_decision.discovery_receipt.query_digest`,
            issues,
          )
          validateRequiredString(
            receipt.candidate_digest,
            `${path}.source_decision.discovery_receipt.candidate_digest`,
            issues,
          )
          validateStringArray(
            receipt.candidate_ids,
            `${path}.source_decision.discovery_receipt.candidate_ids`,
            issues,
            true,
          )
          validateStringArray(
            receipt.inspected_pack_ids,
            `${path}.source_decision.discovery_receipt.inspected_pack_ids`,
            issues,
            true,
          )
          validateStringArray(
            receipt.represented_pack_ids,
            `${path}.source_decision.discovery_receipt.represented_pack_ids`,
            issues,
            true,
          )
          for (const field of [
            'candidate_count',
            'total_compatible',
            'structured_constraint_count',
          ] as const) {
            if (!Number.isInteger(receipt[field]) || Number(receipt[field]) < 0)
              issues.push(
                `${path}.source_decision.discovery_receipt.${field} must be a non-negative integer.`,
              )
          }
          if (receipt.decision_ready !== true)
            issues.push(
              `${path}.source_decision.discovery_receipt.decision_ready must be true.`,
            )
        }
      }
      if (
        decision.type !== 'resource-library' &&
        record.resource_requirement !== undefined
      )
        issues.push(
          `${path}.source_decision cannot keep a resource_requirement selection lane after a final source decision.`,
        )
      const satisfiedBy = objectValue(record.satisfied_by)
      if (
        decision.type === 'resource-library' &&
        !stringArray(satisfiedBy?.import_ids).length
      )
        issues.push(
          `${path}.source_decision requires at least one satisfied_by.import_ids entry for a resource-library decision.`,
        )
      if (decision.type === 'unavailable' && record.status !== 'blocked')
        issues.push(
          `${path}.status must be blocked when source_decision.type is unavailable.`,
        )
    }
  }
  if (record.satisfied_by !== undefined) {
    const satisfiedBy = objectValue(record.satisfied_by)
    if (!satisfiedBy) issues.push(`${path}.satisfied_by must be an object.`)
    else {
      validateKnownFields(
        satisfiedBy,
        ['import_ids', 'composition_ids', 'project_references'],
        `${path}.satisfied_by`,
        issues,
      )
      validateStringArray(
        satisfiedBy.import_ids,
        `${path}.satisfied_by.import_ids`,
        issues,
      )
      validateStringArray(
        satisfiedBy.composition_ids,
        `${path}.satisfied_by.composition_ids`,
        issues,
      )
      validateStringArray(
        satisfiedBy.project_references,
        `${path}.satisfied_by.project_references`,
        issues,
      )
    }
  }
}

function validateCanonicalResourceRequirement(
  record: Record<string, unknown>,
  path: string,
  issues: string[],
): void {
  validateKnownFields(
    record,
    [
      'category',
      'dimension',
      'accepted_formats',
      'styles',
      'game_types',
      'tags',
      'asset_kinds',
      'capabilities',
      'subresources',
      'relations',
      'purpose',
      'import_budget',
      'no_match',
    ],
    path,
    issues,
  )
  validateOptionalEnum(
    record.category,
    RESOURCE_CATEGORIES,
    `${path}.category`,
    issues,
  )
  validateOptionalEnum(
    record.dimension,
    ['2D', '3D', 'agnostic'],
    `${path}.dimension`,
    issues,
  )
  validateOptionalString(record.purpose, `${path}.purpose`, issues)
  validateOptionalEnum(
    record.no_match,
    BEEGAME_RESOURCE_NO_MATCH_OUTCOMES,
    `${path}.no_match`,
    issues,
    true,
  )
  if (
    record.import_budget !== undefined &&
    (!Number.isInteger(record.import_budget) ||
      Number(record.import_budget) < 0)
  ) {
    issues.push(
      `${path}.import_budget must be a non-negative integer when present.`,
    )
  }
  validateStringArray(
    record.accepted_formats,
    `${path}.accepted_formats`,
    issues,
  )
  validateFileExtensions(
    record.accepted_formats,
    `${path}.accepted_formats`,
    issues,
  )
  validateStringArray(record.styles, `${path}.styles`, issues)
  validateStringArray(record.game_types, `${path}.game_types`, issues)
  validateEnumArray(record.tags, RESOURCE_USAGE_TAGS, `${path}.tags`, issues)
  validateEnumArray(
    record.asset_kinds,
    RESOURCE_ASSET_KINDS,
    `${path}.asset_kinds`,
    issues,
  )
  validateEnumArray(
    record.capabilities,
    RESOURCE_CAPABILITIES,
    `${path}.capabilities`,
    issues,
  )
  validateObjectArray(
    record.subresources,
    `${path}.subresources`,
    issues,
    (entry, itemPath) => {
      validateKnownFields(
        entry,
        ['kind', 'role', 'skeleton_signature'],
        itemPath,
        issues,
      )
      validateOptionalEnum(
        entry.kind,
        RESOURCE_EMBEDDED_COMPONENT_KINDS,
        `${itemPath}.kind`,
        issues,
        true,
      )
      validateOptionalString(entry.role, `${itemPath}.role`, issues)
      validateOptionalString(
        entry.skeleton_signature,
        `${itemPath}.skeleton_signature`,
        issues,
      )
    },
  )
  validateObjectArray(
    record.relations,
    `${path}.relations`,
    issues,
    (entry, itemPath) => {
      validateKnownFields(
        entry,
        ['kind', 'target_element_id', 'role'],
        itemPath,
        issues,
      )
      validateOptionalEnum(
        entry.kind,
        RESOURCE_RELATION_KINDS,
        `${itemPath}.kind`,
        issues,
        true,
      )
      validateOptionalString(
        entry.target_element_id,
        `${itemPath}.target_element_id`,
        issues,
      )
      validateOptionalString(entry.role, `${itemPath}.role`, issues)
    },
  )
}

function validateFileExtensions(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (!Array.isArray(value)) return
  const invalid = value.filter(
    item => typeof item === 'string' && item.includes('/'),
  )
  if (invalid.length) {
    issues.push(
      `${path} must contain file extensions such as glb or ogg, not MIME types.`,
    )
  }
}

function validateCanonicalImport(
  value: unknown,
  path: string,
  issues: string[],
): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateKnownFields(
    record,
    [
      'id',
      'source',
      'status',
      'root_path',
      'local_files',
      'local_file_hashes',
      'selected_at',
      'selection_reason',
      'asset_kind',
      'capabilities',
      'content_profile',
      'technical_facts',
      'dependencies',
      'usage_evidence',
      'error',
    ],
    path,
    issues,
  )
  validateRequiredString(record.id, `${path}.id`, issues)
  validateOptionalEnum(
    record.status,
    ['available', 'referenced', 'failed'],
    `${path}.status`,
    issues,
    true,
  )
  validateRequiredString(record.root_path, `${path}.root_path`, issues)
  validateRequiredString(record.selected_at, `${path}.selected_at`, issues)
  validateStringArray(
    record.local_files,
    `${path}.local_files`,
    issues,
    true,
    true,
  )
  if (record.local_file_hashes !== undefined) {
    const hashes = objectValue(record.local_file_hashes)
    if (!hashes) issues.push(`${path}.local_file_hashes must be an object.`)
    else {
      for (const [file, hash] of Object.entries(hashes)) {
        if (!file.trim() || file !== file.trim()) {
          issues.push(
            `${path}.local_file_hashes keys must be trimmed non-empty paths.`,
          )
        }
        if (!isSha256(hash)) {
          issues.push(
            `${path}.local_file_hashes[${JSON.stringify(file)}] must be a lowercase SHA-256 digest.`,
          )
        }
      }
    }
  }
  validateStringArray(
    record.selection_reason,
    `${path}.selection_reason`,
    issues,
    true,
  )
  validateOptionalString(record.asset_kind, `${path}.asset_kind`, issues)
  validateStringArray(record.capabilities, `${path}.capabilities`, issues)
  validateOptionalString(record.error, `${path}.error`, issues)
  const source = objectValue(record.source)
  if (!source) issues.push(`${path}.source must be an object.`)
  else {
    validateKnownFields(
      source,
      ['type', 'pack_id', 'pack_version', 'element_id', 'element_path'],
      `${path}.source`,
      issues,
    )
    validateOptionalEnum(
      source.type,
      ['resource-library', 'user-upload', 'project-authored'],
      `${path}.source.type`,
      issues,
      true,
    )
    for (const field of [
      'pack_id',
      'pack_version',
      'element_id',
      'element_path',
    ]) {
      validateOptionalString(source[field], `${path}.source.${field}`, issues)
    }
    if (source.type === 'resource-library') {
      validateRequiredString(source.pack_id, `${path}.source.pack_id`, issues)
      validateRequiredString(
        source.pack_version,
        `${path}.source.pack_version`,
        issues,
      )
      validateRequiredString(
        source.element_id,
        `${path}.source.element_id`,
        issues,
      )
      validateRequiredString(
        source.element_path,
        `${path}.source.element_path`,
        issues,
      )
    }
  }
  validateObjectArray(
    record.dependencies,
    `${path}.dependencies`,
    issues,
    (entry, itemPath) => {
      validateKnownFields(
        entry,
        [
          'key',
          'parent_key',
          'element_id',
          'element_path',
          'reference_path',
          'local_path',
          'kind',
        ],
        itemPath,
        issues,
      )
      for (const field of [
        'key',
        'parent_key',
        'element_id',
        'element_path',
        'reference_path',
        'local_path',
      ]) {
        validateRequiredString(entry[field], `${itemPath}.${field}`, issues)
      }
      validateOptionalString(entry.kind, `${itemPath}.kind`, issues)
    },
  )
  if (record.usage_evidence !== undefined) {
    const evidence = objectValue(record.usage_evidence)
    if (!evidence) issues.push(`${path}.usage_evidence must be an object.`)
    else {
      validateKnownFields(
        evidence,
        ['references', 'runtime_event_ids'],
        `${path}.usage_evidence`,
        issues,
      )
      validateStringArray(
        evidence.references,
        `${path}.usage_evidence.references`,
        issues,
      )
      validateStringArray(
        evidence.runtime_event_ids,
        `${path}.usage_evidence.runtime_event_ids`,
        issues,
      )
    }
  }
  if (
    record.content_profile !== undefined &&
    !objectValue(record.content_profile)
  )
    issues.push(`${path}.content_profile must be an object.`)
  if (
    record.technical_facts !== undefined &&
    !isPrimitiveValueRecord(record.technical_facts)
  ) {
    issues.push(
      `${path}.technical_facts must contain only finite string, number, or boolean values.`,
    )
  }
}

function validateCanonicalComposition(
  value: unknown,
  path: string,
  issues: string[],
): void {
  const record = objectValue(value)
  if (!record) {
    issues.push(`${path} must be an object.`)
    return
  }
  validateKnownFields(
    record,
    [
      'id',
      'kind',
      'required',
      'members',
      'assembly_mode',
      'recipe',
      'status',
      'integration_evidence',
    ],
    path,
    issues,
  )
  validateRequiredString(record.id, `${path}.id`, issues)
  validateOptionalEnum(
    record.kind,
    RESOURCE_COMPOSITION_KINDS,
    `${path}.kind`,
    issues,
    true,
  )
  validateOptionalEnum(
    record.assembly_mode,
    ['direct', 'composed'],
    `${path}.assembly_mode`,
    issues,
  )
  validateOptionalEnum(
    record.status,
    ['planned', 'assembled', 'integrated', 'failed'],
    `${path}.status`,
    issues,
  )
  if (record.required !== undefined && typeof record.required !== 'boolean')
    issues.push(`${path}.required must be a boolean.`)
  validateObjectArray(
    record.members,
    `${path}.members`,
    issues,
    (entry, itemPath) => {
      validateKnownFields(
        entry,
        ['import_id', 'requirement_id', 'composition_id', 'role', 'required'],
        itemPath,
        issues,
      )
      const references = [
        'import_id',
        'requirement_id',
        'composition_id',
      ].filter(
        field =>
          typeof entry[field] === 'string' &&
          Boolean(String(entry[field]).trim()),
      )
      if (!references.length)
        issues.push(
          `${itemPath} must identify an import, requirement, or composition.`,
        )
      for (const field of ['import_id', 'requirement_id', 'composition_id'])
        validateOptionalString(entry[field], `${itemPath}.${field}`, issues)
      validateRequiredString(entry.role, `${itemPath}.role`, issues)
      if (entry.required !== undefined && typeof entry.required !== 'boolean')
        issues.push(`${itemPath}.required must be a boolean.`)
    },
    true,
  )
  for (const field of ['recipe', 'integration_evidence'] as const) {
    if (record[field] !== undefined && !objectValue(record[field]))
      issues.push(`${path}.${field} must be an object.`)
  }
  const recipe = objectValue(record.recipe)
  if (recipe) {
    validateKnownFields(recipe, ['path', 'notes'], `${path}.recipe`, issues)
    validateOptionalString(recipe.path, `${path}.recipe.path`, issues)
    validateOptionalString(recipe.notes, `${path}.recipe.notes`, issues)
  }
  const evidence = objectValue(record.integration_evidence)
  if (evidence) {
    validateKnownFields(
      evidence,
      ['references', 'runtime_event_ids'],
      `${path}.integration_evidence`,
      issues,
    )
    validateStringArray(
      evidence.references,
      `${path}.integration_evidence.references`,
      issues,
    )
    validateStringArray(
      evidence.runtime_event_ids,
      `${path}.integration_evidence.runtime_event_ids`,
      issues,
    )
  }
}

function validateCanonicalRequirementId(
  value: unknown,
  path: string,
  issues: string[],
): void {
  validateRequiredString(value, path, issues)
  if (
    typeof value === 'string' &&
    value === value.trim() &&
    normalizeImportId(value) !== value
  ) {
    issues.push(
      `${path} contains characters that are not allowed in a canonical requirement id.`,
    )
  }
}

function validateKnownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  const allowedFields = new Set(allowed)
  const unknown = Object.keys(record).filter(field => !allowedFields.has(field))
  if (unknown.length) {
    issues.push(`${path} contains unknown fields: ${unknown.join(', ')}.`)
  }
}

function validateRequiredString(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    issues.push(`${path} must be a trimmed non-empty string.`)
}

function validateOptionalString(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (
    value !== undefined &&
    (typeof value !== 'string' || !value.trim() || value !== value.trim())
  )
    issues.push(`${path} must be a trimmed non-empty string when present.`)
}

function validateOptionalEnum(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: string[],
  required = false,
): void {
  if (value === undefined && !required) return
  if (typeof value !== 'string' || !allowed.includes(value))
    issues.push(`${path} must be one of ${allowed.join(', ')}.`)
}

function validateStringArray(
  value: unknown,
  path: string,
  issues: string[],
  required = false,
  nonEmpty = false,
): void {
  if (value === undefined && !required) return
  if (
    !Array.isArray(value) ||
    (nonEmpty && value.length === 0) ||
    value.some(
      entry =>
        typeof entry !== 'string' || !entry.trim() || entry !== entry.trim(),
    )
  ) {
    issues.push(`${path} must be an array of non-empty strings.`)
  }
}

function isPrimitiveValueRecord(value: unknown): boolean {
  const record = objectValue(value)
  return (
    Boolean(record) &&
    Object.values(record!).every(
      entry =>
        typeof entry === 'string' ||
        typeof entry === 'boolean' ||
        (typeof entry === 'number' && Number.isFinite(entry)),
    )
  )
}

function validateEnumArray(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: string[],
): void {
  if (value === undefined) return
  if (
    !Array.isArray(value) ||
    value.some(entry => typeof entry !== 'string' || !allowed.includes(entry))
  ) {
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

function primitiveRecord(
  value: unknown,
): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string | number | boolean] => {
      const item = entry[1]
      return (
        typeof item === 'string' ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item))
      )
    },
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function sha256Record(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      Boolean(entry[0].trim()) && isSha256(entry[1]),
  )
  return entries.length ? Object.fromEntries(entries) : undefined
}

function normalizeImportDependency(
  value: unknown,
): BeeGameResourceImportDependency | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined
  const record = value as Record<string, unknown>
  const key = trimString(record.key)
  const parentKey = trimString(record.parent_key)
  const elementId = trimString(record.element_id)
  const elementPath = trimString(record.element_path)
  const referencePath = trimString(record.reference_path)
  const localPath = trimString(record.local_path)
  if (
    !key ||
    !parentKey ||
    !elementId ||
    !elementPath ||
    !referencePath ||
    !localPath
  )
    return undefined
  return {
    key,
    parent_key: parentKey,
    element_id: elementId,
    element_path: elementPath,
    reference_path: referencePath,
    local_path: localPath,
    ...(trimString(record.kind) ? { kind: trimString(record.kind) } : {}),
  }
}

/** Reconcile copied inventory only. Requirements and compositions are authored
 * target-native declarations; filesystem observations must not silently
 * advance or rewrite their lifecycle. */
async function reconcileAssetContractFiles(
  root: string,
  manifest: BeeGameAssetManifest,
): Promise<BeeGameAssetManifest> {
  const imports = await Promise.all(
    (manifest.imports ?? []).map(async resourceImport => {
      const localFiles = [...new Set(resourceImport.local_files ?? [])]
      const missing = localFiles.filter(path => {
        try {
          return !existsSync(resolveInsideWorkspace(root, path))
        } catch {
          return true
        }
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
          const bytes = await readResourceSignature(
            resolveInsideWorkspace(root, localPath),
          )
          const detectedFormat = detectResourceBinaryFormat(bytes)
          if (detectedFormat && !formatsAgree(declaredFormat, detectedFormat)) {
            return {
              ...resourceImport,
              status: 'failed' as const,
              error: `File format mismatch: expected .${declaredFormat}, found ${detectedFormat}`,
            }
          }
        } catch {
          return {
            ...resourceImport,
            status: 'failed' as const,
            error: 'Imported project asset could not be read.',
          }
        }
      }
      return resourceImport
    }),
  )
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

function assertImportInsideRuntimeAssetRoot(
  workspace: string,
  targetPath: string,
  target?: BeeGameAssetProjectTarget,
): void {
  const policy = target?.resource_library_usage
  if (policy !== 'preferred' && policy !== 'required') return
  const runtimeAssetRoot = trimString(target?.runtime_asset_root)
  if (!runtimeAssetRoot || !isConcreteRelativePath(runtimeAssetRoot)) {
    throw new Error(
      'Target runtime project_target.runtime_asset_root must be a concrete project-relative directory before Resource Library import',
    )
  }
  const absoluteRoot = resolveInsideWorkspace(workspace, runtimeAssetRoot)
  const fromRoot = relative(absoluteRoot, targetPath)
  if (
    !fromRoot ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error(
      `Resource import destination must be inside project_target.runtime_asset_root: ${runtimeAssetRoot}`,
    )
  }
}

function assertAssetFormatAllowed(
  filename: string,
  requirement: BeeGameAssetRequirement,
  target?: BeeGameAssetProjectTarget,
): void {
  assertFilenameFormatAllowed(
    filename,
    effectiveAssetFormats(requirement, target),
  )
}

function assertFilenameFormatAllowed(
  filename: string,
  formats: readonly string[],
): void {
  if (!formats.length)
    throw new Error(
      `Target runtime asset format capabilities are required before integrating ${filename}`,
    )
  const extension = normalizeFormat(extname(filename))
  if (!extension || !formats.includes(extension))
    throw new Error(
      `Asset format .${extension || 'unknown'} is not supported by the target runtime contract`,
    )
}

function normalizeFormats(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map(normalizeFormat).filter(Boolean))]
}

function normalizeFormat(value: string): string {
  return value.trim().replace(/^\./, '').toLowerCase()
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
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
    throw new Error(
      'Target runtime project_target.runtime_asset_root must be a concrete project-relative directory before asset upload',
    )
  }
  return resolveInsideWorkspace(
    root,
    join(runtimeAssetRoot, 'uploads', requirement.id, normalizedFilename),
  )
}

function resolveImportTarget(
  root: string,
  destinationPath: string,
  filename: string,
): string {
  const destination = trimString(destinationPath)
  if (!destination || !isConcreteRelativePath(destination))
    throw new Error(
      'Resource import destination_path must be a concrete project-relative path',
    )
  const sourceExtension = extname(filename).toLowerCase()
  const destinationExtension = extname(destination).toLowerCase()
  if (
    destinationExtension &&
    sourceExtension &&
    destinationExtension !== sourceExtension
  ) {
    throw new Error(
      `Resource import destination extension must remain .${sourceExtension.slice(1)}`,
    )
  }
  return resolveInsideWorkspace(
    root,
    destinationExtension ? destination : join(destination, filename),
  )
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
  if (
    ascii.startsWith('ID3') ||
    (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
  )
    return 'mp3'
  if (ascii.startsWith('Kaydara FBX Binary')) return 'fbx'
  if (bytes[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WAVE') return 'wav'
  return undefined
}

function formatsAgree(declaredFormat: string, detectedFormat: string): boolean {
  if (declaredFormat === detectedFormat) return true
  return (
    (declaredFormat === 'jpeg' && detectedFormat === 'jpg') ||
    (declaredFormat === 'jpg' && detectedFormat === 'jpeg')
  )
}

async function writeAssetManifest(
  root: string,
  manifest: BeeGameAssetManifest,
): Promise<void> {
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  const receiptsPath = resolveInsideWorkspace(root, ASSET_IMPORT_RECEIPTS_PATH)
  const serialized = serializeAssetManifest(manifest)
  await mkdir(resolve(manifestPath, '..'), { recursive: true })
  await mkdir(resolve(receiptsPath, '..'), { recursive: true })
  await writeFile(
    receiptsPath,
    JSON.stringify(buildImportReceipts(manifest)),
    'utf8',
  )
  await writeFile(manifestPath, serialized, 'utf8')
}

function serializeAssetManifest(manifest: BeeGameAssetManifest): string {
  const canonical = toCanonicalBeeGameAssetManifest(manifest)
  const imports = Array.isArray(canonical.imports)
    ? canonical.imports.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          return value
        const {
          content_profile: _contentProfile,
          technical_facts: _technicalFacts,
          local_file_hashes: _localFileHashes,
          dependencies: _dependencies,
          ...compact
        } = value as Record<string, unknown>
        return compact
      })
    : []
  const compactCanonical = { ...canonical, imports }
  // Runtime writes must never create a file that the strict runtime reader
  // rejects on its next read. Missing-file/draft snapshots are useful to UI
  // callers, but they are not a persistable canonical contract.
  parseCanonicalBeeGameAssetManifest(compactCanonical)
  return `${JSON.stringify(compactCanonical, null, 2)}\n`
}

type BeeGameImportReceipt = {
  id: string
  source: BeeGameResourceImport['source']
  root_path: string
  local_file_hashes?: Record<string, string>
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  dependencies?: BeeGameResourceImportDependency[]
}

type BeeGameImportReceipts = {
  version: 1
  imports: BeeGameImportReceipt[]
}

function buildImportReceipts(
  manifest: BeeGameAssetManifest,
): BeeGameImportReceipts {
  return {
    version: 1,
    imports: (manifest.imports ?? []).flatMap(resourceImport => {
      const hasReceipt =
        Boolean(resourceImport.local_file_hashes) ||
        Boolean(resourceImport.content_profile) ||
        Boolean(resourceImport.technical_facts) ||
        Boolean(resourceImport.dependencies?.length)
      if (!hasReceipt) return []
      return [
        {
          id: resourceImport.id,
          source: resourceImport.source,
          root_path: resourceImport.root_path,
          ...(resourceImport.local_file_hashes
            ? { local_file_hashes: resourceImport.local_file_hashes }
            : {}),
          ...(resourceImport.content_profile
            ? { content_profile: resourceImport.content_profile }
            : {}),
          ...(resourceImport.technical_facts
            ? { technical_facts: resourceImport.technical_facts }
            : {}),
          ...(resourceImport.dependencies?.length
            ? { dependencies: resourceImport.dependencies }
            : {}),
        },
      ]
    }),
  }
}

function mergeImportReceipts(
  root: string,
  manifest: BeeGameAssetManifest,
): BeeGameAssetManifest {
  const receiptsPath = resolveInsideWorkspace(root, ASSET_IMPORT_RECEIPTS_PATH)
  if (!existsSync(receiptsPath)) return manifest
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(receiptsPath, 'utf8'))
  } catch {
    return manifest
  }
  const record = objectValue(parsed)
  if (record?.version !== 1 || !Array.isArray(record.imports)) return manifest
  const receipts = new Map(
    record.imports.flatMap(value => {
      const receipt = normalizeImportReceipt(value)
      return receipt ? [[receipt.id, receipt] as const] : []
    }),
  )
  return {
    ...manifest,
    imports: (manifest.imports ?? []).map(resourceImport => {
      const receipt = receipts.get(resourceImport.id)
      if (!receipt || !receiptMatchesImport(receipt, resourceImport))
        return resourceImport
      return {
        ...resourceImport,
        ...(receipt.local_file_hashes
          ? { local_file_hashes: receipt.local_file_hashes }
          : {}),
        ...(receipt.content_profile
          ? { content_profile: receipt.content_profile }
          : {}),
        ...(receipt.technical_facts
          ? { technical_facts: receipt.technical_facts }
          : {}),
        ...(receipt.dependencies?.length
          ? { dependencies: receipt.dependencies }
          : {}),
      }
    }),
  }
}

function normalizeImportReceipt(
  value: unknown,
): BeeGameImportReceipt | undefined {
  const record = objectValue(value)
  const source = objectValue(record?.source)
  const id = trimString(record?.id)
  const rootPath = trimString(record?.root_path)
  if (!record || !source || !id || !rootPath) return undefined
  const sourceType =
    source.type === 'resource-library' ||
    source.type === 'user-upload' ||
    source.type === 'project-authored'
      ? source.type
      : undefined
  if (!sourceType) return undefined
  const normalizedSource: BeeGameResourceImport['source'] = {
    type: sourceType,
    ...(trimString(source.pack_id)
      ? { pack_id: trimString(source.pack_id) }
      : {}),
    ...(trimString(source.pack_version)
      ? { pack_version: trimString(source.pack_version) }
      : {}),
    ...(trimString(source.element_id)
      ? { element_id: trimString(source.element_id) }
      : {}),
    ...(trimString(source.element_path)
      ? { element_path: trimString(source.element_path) }
      : {}),
  }
  const hashes = sha256Record(record.local_file_hashes)
  const profile = objectValue(record.content_profile)
  const facts = primitiveRecord(record.technical_facts)
  const dependencies = Array.isArray(record.dependencies)
    ? record.dependencies
        .map(normalizeImportDependency)
        .filter((dependency): dependency is BeeGameResourceImportDependency =>
          Boolean(dependency),
        )
    : []
  return {
    id,
    source: normalizedSource,
    root_path: rootPath,
    ...(hashes ? { local_file_hashes: hashes } : {}),
    ...(profile ? { content_profile: profile } : {}),
    ...(facts ? { technical_facts: facts } : {}),
    ...(dependencies.length ? { dependencies } : {}),
  }
}

function receiptMatchesImport(
  receipt: BeeGameImportReceipt,
  resourceImport: BeeGameResourceImport,
): boolean {
  return (
    receipt.root_path === resourceImport.root_path &&
    receipt.source.type === resourceImport.source.type &&
    receipt.source.pack_id === resourceImport.source.pack_id &&
    receipt.source.pack_version === resourceImport.source.pack_version &&
    receipt.source.element_id === resourceImport.source.element_id &&
    receipt.source.element_path === resourceImport.source.element_path
  )
}

export function toCanonicalBeeGameAssetManifest(
  manifest: BeeGameAssetManifest,
): Record<string, unknown> {
  return {
    version: Math.max(CURRENT_ASSET_MANIFEST_VERSION, manifest.version),
    ...(manifest.project_target
      ? { project_target: manifest.project_target }
      : {}),
    requirements: manifest.requirements.map(requirement => {
      const satisfiedBy = {
        import_ids: [...new Set(requirement.satisfied_by?.import_ids ?? [])],
        composition_ids: [
          ...new Set(requirement.satisfied_by?.composition_ids ?? []),
        ],
        project_references: [
          ...new Set(requirement.satisfied_by?.project_references ?? []),
        ],
      }
      return {
        id: requirement.id,
        ...(requirement.name ? { name: requirement.name } : {}),
        ...(requirement.purpose ? { purpose: requirement.purpose } : {}),
        required: requirement.required !== false,
        ...(requirement.resource_requirement
          ? { resource_requirement: requirement.resource_requirement }
          : {}),
        ...(requirement.source_decision
          ? { source_decision: requirement.source_decision }
          : {}),
        ...(satisfiedBy.import_ids.length ||
        satisfiedBy.composition_ids.length ||
        satisfiedBy.project_references.length
          ? { satisfied_by: satisfiedBy }
          : {}),
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
    "Use the project target's native files and tools to reference it, validate its player-facing contribution, and update assets/asset-manifest.json with current evidence.",
  ]
    .filter(Boolean)
    .join(' ')
}

function normalizeWorkspacePath(path: string): string {
  if (!path || !isAbsolute(path))
    throw new Error('Workspace path must be absolute')
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
    ? value
        .map(item => (typeof item === 'string' ? item.trim() : ''))
        .filter(Boolean)
    : []
}
