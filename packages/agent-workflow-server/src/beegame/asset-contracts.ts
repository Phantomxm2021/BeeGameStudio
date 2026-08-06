import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  RESOURCE_DIMENSIONS,
  RESOURCE_LIBRARY_USAGE,
  RESOURCE_USAGE_TAGS,
  type ResourceAcquisitionProfile,
  type ResourceLibraryUsage,
} from '@bee-game-studio/beegame-resource-core'
import {
  parseBeeGameProgrammaticAudioText,
  type BeeGameProgrammaticAudioResource,
} from './programmatic-audio-resource'
import { auditBeeGameContent } from './content-contracts'

export const BEEGAME_RESOURCE_STATUSES = [
  'available',
  'verified',
  'failed',
] as const
const AUDIO_ASSET_KINDS = new Set([
  'audio-clip',
  'audio-cue',
  'audio-bank',
  'music',
  'ambience',
  'voice',
])
const PLAYABLE_AUDIO_ASSET_KINDS = new Set([
  'audio-clip',
  'music',
  'ambience',
  'voice',
])
const AUDIO_FILE_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.opus',
  '.wav',
])

export type BeeGameResourceStatus = (typeof BEEGAME_RESOURCE_STATUSES)[number]

export type BeeGameAssetProjectTarget = {
  platform?: string
  runtime?: string
  asset_format_capabilities: string[]
  resource_library_usage?: ResourceLibraryUsage
  runtime_asset_root: string
  content_root: string
  generated_asset_root: string
}

export type BeeGameAssetRequirement = {
  id: string
  name?: string
  purpose?: string
  required?: boolean
  acquisition_profile: {
    dimensions: ResourceAcquisitionProfile['dimensions']
    asset_kinds: ResourceAcquisitionProfile['assetKinds']
    usage_tags: ResourceAcquisitionProfile['usageTags']
    capabilities: ResourceAcquisitionProfile['capabilities']
    styles: ResourceAcquisitionProfile['styles']
  }
}

export type BeeGameResourceDependency = {
  key: string
  parent_key: string
  element_id: string
  element_path: string
  reference_path: string
  local_path: string
  kind?: string
}

export type BeeGameProjectResourceSource =
  | {
      type: 'resource-library'
      pack_id: string
      pack_version: string
      element_id: string
      element_path: string
    }
  | {
      type: 'agent-authored'
      created_at: string
      reason: string
    }
  | {
      type: 'user-provided'
      created_at: string
      filename: string
    }

export type BeeGameProjectResource = {
  id: string
  source: BeeGameProjectResourceSource
  root_path: string
  file_paths: string[]
  local_file_hashes?: Record<string, string>
  provisional: boolean
  status: BeeGameResourceStatus
  selected_at: string
  selection_reason: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  dependencies?: BeeGameResourceDependency[]
  error?: string
}

export type BeeGameAssetManifest = {
  version: 8
  project_target?: BeeGameAssetProjectTarget
  requirements: BeeGameAssetRequirement[]
  resources: BeeGameProjectResource[]
}

type BeeGameAssetManifestIndex = {
  version: 8
  project_target?: BeeGameAssetProjectTarget
  modules: {
    requirements: string
    resources: string[]
  }
}

export const BEEGAME_RESOURCE_ROOTS = {
  runtime: 'assets/runtime',
  content: 'assets/content',
  generated: 'assets/generated',
} as const

export type BeeGameAssetUploadResult = {
  manifest: BeeGameAssetManifest
  resource: BeeGameProjectResource
  path: string
  message: string
}

export type BeeGameAssetUploadOptions = {
  persist?: (manifest: BeeGameAssetManifest) => Promise<void>
}

export type BeeGameResolvedLibraryResourceInput = {
  id: string
  destination_path: string
  pack_id: string
  pack_version: string
  element_id: string
  element_path: string
  source_url: string
  source_hash: string
  selection_reason: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  delivery?: {
    disposition: 'direct' | 'convert'
    source_format: string
    target_format: string
    adapter_id?: string
  }
  dependencies?: Array<{
    key: string
    parent_key: string
    element_id: string
    element_path: string
    reference_path: string
    source_url: string
    source_hash: string
    kind?: string
  }>
}

export type BeeGameAuthoredResourceInput = {
  id: string
  root_path: string
  file_paths: string[]
  provisional: boolean
  reason: string
  selection_reason: string[]
  asset_kind?: string
  capabilities?: string[]
  content_profile?: Record<string, unknown>
  technical_facts?: Record<string, string | number | boolean>
  replace_existing_provisional?: boolean
}
const ASSET_MANIFEST_PATH = 'assets/asset-manifest.json'
const ASSET_REQUIREMENTS_MODULE_ROOT = 'assets/manifest/requirements'
const ASSET_RESOURCE_MODULE_ROOT = 'assets/manifest/resources'
export const CURRENT_ASSET_MANIFEST_VERSION = 8

export class BeeGameAssetManifestError extends Error {
  readonly code = 'invalid_asset_manifest'

  constructor(readonly issues: string[]) {
    super(`Invalid canonical asset manifest: ${issues.join(' ')}`)
    this.name = 'BeeGameAssetManifestError'
  }
}

export const CANONICAL_ASSET_MANIFEST_EXAMPLE = {
  version: CURRENT_ASSET_MANIFEST_VERSION,
  project_target: {
    asset_format_capabilities: ['<actual-target-supported-format>'],
    resource_library_usage: 'preferred',
    runtime_asset_root: BEEGAME_RESOURCE_ROOTS.runtime,
    content_root: BEEGAME_RESOURCE_ROOTS.content,
    generated_asset_root: BEEGAME_RESOURCE_ROOTS.generated,
  },
  modules: {
    requirements:
      'assets/manifest/requirements/<content-addressed-record>.json',
    resources: [
      'assets/manifest/resources/<identity-and-content-addressed-record>.json',
    ],
  },
} as const

export async function readBeeGameAssetManifest(
  workspacePath: string,
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  return readBeeGameAssetManifestSync(root)
}

export function readBeeGameAssetManifestSync(
  workspacePath: string,
): BeeGameAssetManifest {
  const root = normalizeWorkspacePath(workspacePath)
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  if (!existsSync(manifestPath)) return emptyManifest()
  let indexValue: unknown
  try {
    indexValue = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    throw new BeeGameAssetManifestError(['manifest must contain valid JSON.'])
  }
  const index = parseManifestIndex(indexValue)
  let requirementsValue: unknown
  const resources: unknown[] = []
  try {
    requirementsValue = JSON.parse(
      readFileSync(
        resolveInsideWorkspace(root, index.modules.requirements),
        'utf8',
      ),
    )
    for (const path of index.modules.resources)
      resources.push(
        JSON.parse(readFileSync(resolveInsideWorkspace(root, path), 'utf8')),
      )
  } catch {
    throw new BeeGameAssetManifestError([
      'every registered manifest module must exist and contain valid JSON.',
    ])
  }
  if (!isRecord(requirementsValue))
    throw new BeeGameAssetManifestError([
      'requirements module root must be an object.',
    ])
  const requirementModuleIssues: string[] = []
  rejectUnknownKeys(
    requirementsValue,
    ['requirements'],
    'requirements module',
    requirementModuleIssues,
  )
  if (requirementModuleIssues.length)
    throw new BeeGameAssetManifestError(requirementModuleIssues)
  return parseCanonicalBeeGameAssetManifest({
    version: index.version,
    ...(index.project_target ? { project_target: index.project_target } : {}),
    requirements: requirementsValue.requirements,
    resources,
  })
}

export function readBeeGameAssetManifestModulePathsSync(
  workspacePath: string,
): string[] {
  const root = normalizeWorkspacePath(workspacePath)
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  if (!existsSync(manifestPath)) return []
  const index = parseManifestIndex(
    JSON.parse(readFileSync(manifestPath, 'utf8')),
  )
  return [
    ASSET_MANIFEST_PATH,
    index.modules.requirements,
    ...index.modules.resources,
  ]
}

export function parseCanonicalBeeGameAssetManifest(
  value: unknown,
): BeeGameAssetManifest {
  const issues = validateManifest(value)
  if (issues.length) throw new BeeGameAssetManifestError(issues)
  return structuredClone(value as BeeGameAssetManifest)
}

function parseManifestIndex(value: unknown): BeeGameAssetManifestIndex {
  const issues: string[] = []
  if (!isRecord(value))
    throw new BeeGameAssetManifestError([
      'manifest index root must be an object.',
    ])
  rejectUnknownKeys(
    value,
    ['version', 'project_target', 'modules'],
    'manifest index',
    issues,
  )
  if (value.version !== CURRENT_ASSET_MANIFEST_VERSION)
    issues.push(`version must be ${CURRENT_ASSET_MANIFEST_VERSION}.`)
  validateTarget(value.project_target, issues)
  if (!isRecord(value.modules)) {
    issues.push('manifest index modules must be an object.')
  } else {
    rejectUnknownKeys(
      value.modules,
      ['requirements', 'resources'],
      'manifest index modules',
      issues,
    )
    if (
      typeof value.modules.requirements !== 'string' ||
      dirname(value.modules.requirements) !== ASSET_REQUIREMENTS_MODULE_ROOT ||
      extname(value.modules.requirements) !== '.json'
    )
      issues.push(
        `manifest index requirements module must be a JSON file directly under ${ASSET_REQUIREMENTS_MODULE_ROOT}.`,
      )
    if (
      !Array.isArray(value.modules.resources) ||
      !value.modules.resources.every(
        path => typeof path === 'string' && path.trim().length > 0,
      )
    )
      issues.push('manifest index resources must be an array of module paths.')
    else {
      const paths = value.modules.resources
      if (new Set(paths).size !== paths.length)
        issues.push('manifest index resource module paths must be unique.')
      for (const path of paths)
        if (
          dirname(path) !== ASSET_RESOURCE_MODULE_ROOT ||
          extname(path) !== '.json'
        )
          issues.push(
            `manifest resource module must be a JSON file directly under ${ASSET_RESOURCE_MODULE_ROOT}: ${path}.`,
          )
    }
  }
  if (issues.length) throw new BeeGameAssetManifestError(issues)
  return structuredClone(value as BeeGameAssetManifestIndex)
}

export function toCanonicalBeeGameAssetManifest(
  manifest: BeeGameAssetManifest,
): Record<string, unknown> {
  return structuredClone(
    parseCanonicalBeeGameAssetManifest(manifest),
  ) as unknown as Record<string, unknown>
}

export async function writeBeeGameAssetManifest(
  workspacePath: string,
  manifest: BeeGameAssetManifest,
): Promise<void> {
  await writeManifestAtomically(
    normalizeWorkspacePath(workspacePath),
    parseCanonicalBeeGameAssetManifest(manifest),
  )
}

export async function publishBeeGameResourceInventoryFromStaging(
  workspacePath: string,
  stagingWorkspacePath: string,
  resourceIds: readonly string[],
  frozenOutputHashes: Readonly<Record<string, Readonly<Record<string, string>>>>,
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  const stagingRoot = normalizeWorkspacePath(stagingWorkspacePath)
  const current = await readBeeGameAssetManifest(root)
  const staged = await readBeeGameAssetManifest(stagingRoot)
  if (
    JSON.stringify({
      project_target: current.project_target,
      requirements: current.requirements,
    }) !==
    JSON.stringify({
      project_target: staged.project_target,
      requirements: staged.requirements,
    })
  ) {
    throw new Error('Staged resource inventory does not match the current canonical resource plan')
  }
  const ids = uniqueStrings(resourceIds)
  if (ids.length !== resourceIds.length)
    throw new Error('Staged resource inventory IDs must be unique')
  const stagedById = new Map(staged.resources.map(resource => [resource.id, resource]))
  const currentOwnerByPath = new Map(
    current.resources.flatMap(resource =>
      resource.file_paths.map(path => [path, resource.id] as const),
    ),
  )
  const selected = ids.map(id => {
    const resource = stagedById.get(id)
    if (!resource || resource.status !== 'verified')
      throw new Error(`Staged resource is not verified: ${id}`)
    if (!resource.local_file_hashes)
      throw new Error(`Staged resource has no local file hashes: ${id}`)
    if (JSON.stringify(resource.local_file_hashes) !== JSON.stringify(frozenOutputHashes[id]))
      throw new Error(`Staged resource output hashes differ from the durable receipt: ${id}`)
    const currentResource = current.resources.find(item => item.id === id)
    if (
      currentResource &&
      (currentResource.root_path !== resource.root_path ||
        currentResource.file_paths.length !== resource.file_paths.length ||
        currentResource.file_paths.some(path => !resource.file_paths.includes(path)))
    ) {
      throw new Error(`Staged resource paths differ from the current stable resource: ${id}`)
    }
    return resource
  })
  const targetPaths = new Set<string>()
  const writes: Array<{ targetPath: string; bytes: Uint8Array }> = []
  for (const resource of selected) {
    for (const path of resource.file_paths) {
      if (targetPaths.has(path))
        throw new Error(`Staged resource file path is shared by multiple resources: ${path}`)
      targetPaths.add(path)
      const expected = resource.local_file_hashes?.[path]
      if (!isSha256(expected))
        throw new Error(`Staged resource file hash is invalid: ${path}`)
      const bytes = new Uint8Array(
        await readFile(resolveInsideWorkspace(stagingRoot, path)),
      )
      if (sha256(bytes) !== expected)
        throw new Error(`Staged resource file differs from its canonical hash: ${path}`)
      const targetPath = resolveInsideWorkspace(root, path)
      const currentOwner = currentOwnerByPath.get(path)
      if (currentOwner && currentOwner !== resource.id)
        throw new Error(`Staged resource file path belongs to another resource: ${path}`)
      if (existsSync(targetPath) && !currentOwner) {
        const existingHash = sha256(new Uint8Array(await readFile(targetPath)))
        if (existingHash !== expected)
          throw new Error(`Staged resource file conflicts with an unrelated workspace file: ${path}`)
      }
      writes.push({ targetPath, bytes })
    }
  }
  const updated = selected.reduce(replaceResource, current)
  const rollback = await commitResourceWrites(writes)
  try {
    await writeManifestAtomically(root, updated)
  } catch (error) {
    await rollback()
    await writeManifestAtomically(root, current)
    throw error
  }
  return updated
}

export async function uploadBeeGameAsset(
  workspacePath: string,
  resourceId: string,
  file: File,
  options: BeeGameAssetUploadOptions = {},
): Promise<BeeGameAssetUploadResult> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const target = requireProjectTarget(manifest)
  const id = normalizeId(resourceId)
  if (!id) throw new Error('Resource id is required')
  const filename = sanitizeFilename(file.name)
  assertFilenameFormatAllowed(filename, target.asset_format_capabilities)
  const targetPath = resolveInsideDeclaredRoot(
    root,
    target.runtime_asset_root,
    join(target.runtime_asset_root, 'user-provided', id, filename),
  )
  const relativePath = normalizeRelativePath(root, targetPath)
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!bytes.byteLength) throw new Error('Uploaded resource must not be empty')
  const now = new Date().toISOString()
  const resource: BeeGameProjectResource = {
    id,
    source: { type: 'user-provided', created_at: now, filename },
    root_path: relativePath,
    file_paths: [relativePath],
    local_file_hashes: { [relativePath]: sha256(bytes) },
    provisional: false,
    status: 'verified',
    selected_at: now,
    selection_reason: ['User provided this project resource.'],
  }
  const updated = replaceResource(manifest, resource)
  const rollback = await commitResourceWrites([{ targetPath, bytes }])
  try {
    await writeManifestAtomically(root, updated)
    await options.persist?.(updated)
  } catch (error) {
    await rollback()
    await writeManifestAtomically(root, manifest)
    throw error
  }
  return {
    manifest: updated,
    resource,
    path: relativePath,
    message: `Project resource ${id} was added at ${relativePath}.`,
  }
}

export async function addBeeGameLibraryResourceToWorkspace(
  workspacePath: string,
  input: BeeGameResolvedLibraryResourceInput,
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
  deliveryOptions: {
    convert?: (
      files: Array<{ name: string; bytes: Uint8Array }>,
      delivery: NonNullable<BeeGameResolvedLibraryResourceInput['delivery']>,
    ) => Promise<{ filename: string; bytes: Uint8Array }>
  } = {},
): Promise<{
  manifest: BeeGameAssetManifest
  resource: BeeGameProjectResource
}> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const target = requireProjectTarget(manifest)
  const id = normalizeId(input.id)
  if (!id) throw new Error('Resource id is required')
  const existing = manifest.resources.find(resource => resource.id === id)
  if (existing && !isSamePinnedLibraryResource(existing, input))
    throw new Error(`Resource id belongs to a different source: ${id}`)

  const filename = sanitizeFilename(input.element_path)
  const delivery = input.delivery
  const converts = delivery?.disposition === 'convert'
  if (!converts) assertFilenameFormatAllowed(filename, target.asset_format_capabilities)
  if (delivery && normalizeFormat(extname(filename).slice(1)) !== normalizeFormat(delivery.source_format))
    throw new Error(`Resource source format differs from the selected delivery capability: ${filename}`)
  if (delivery && !target.asset_format_capabilities.includes(normalizeFormat(delivery.target_format)))
    throw new Error(`Resource delivery target format is not supported by the target: ${delivery.target_format}`)
  const sourceTargetPath = converts
    ? resolveInsideDeclaredRoot(
        root,
        target.generated_asset_root,
        join(target.generated_asset_root, id, 'source', filename),
      )
    : resolveResourceDestination(
        root,
        target.runtime_asset_root,
        input.destination_path,
        filename,
      )
  if (existing && (await resourceFilesMatchHashes(root, existing)))
    return { manifest, resource: existing }

  const rootBytes = await downloadResource(input.source_url, fetchImpl)
  if (!isSha256(input.source_hash) || sha256(rootBytes) !== input.source_hash)
    throw new Error(`Resource source differs from the frozen Catalog content hash: ${input.element_id}`)
  assertDetectedFormat(filename, rootBytes)
  const dependencies = await prepareDependencies({
    root,
    declaredAssetRoot: converts ? target.generated_asset_root : target.runtime_asset_root,
    rootTargetPath: sourceTargetPath,
    dependencies: input.dependencies ?? [],
    ...(converts ? {} : { allowedFormats: target.asset_format_capabilities }),
    fetchImpl,
  })
  const converted = converts
    ? await (() => {
        if (!deliveryOptions.convert || !delivery)
          throw new Error(`Resource delivery adapter is unavailable: ${delivery?.adapter_id ?? 'unknown'}`)
        return deliveryOptions.convert(
          [
            { name: filename, bytes: rootBytes },
            ...dependencies.map(dependency => ({
              name: dependency.input.element_path,
              bytes: dependency.bytes,
            })),
          ],
          delivery,
        )
      })()
    : undefined
  if (converted) {
    assertFilenameFormatAllowed(converted.filename, target.asset_format_capabilities)
    assertDetectedFormat(converted.filename, converted.bytes)
  }
  const deliveredTargetPath = converted
    ? resolveInsideDeclaredRoot(
        root,
        target.generated_asset_root,
        join(target.generated_asset_root, id, 'delivery', sanitizeFilename(converted.filename)),
      )
    : sourceTargetPath
  const rootPath = normalizeRelativePath(root, deliveredTargetPath)
  if (existing && existing.root_path !== rootPath)
    throw new Error(`Resource destination changed for pinned resource: ${id}`)
  const sourcePath = normalizeRelativePath(root, sourceTargetPath)
  const filePaths = [
    rootPath,
    ...(sourcePath === rootPath ? [] : [sourcePath]),
    ...dependencies.map(dependency =>
      normalizeRelativePath(root, dependency.targetPath),
    ),
  ]
  const localFileHashes = Object.fromEntries([
    [rootPath, sha256(converted?.bytes ?? rootBytes)],
    ...(sourcePath === rootPath ? [] : [[sourcePath, sha256(rootBytes)]]),
    ...dependencies.map(
      dependency =>
        [
          normalizeRelativePath(root, dependency.targetPath),
          sha256(dependency.bytes),
        ] as const,
    ),
  ])
  if (existsSync(deliveredTargetPath) && !existing) {
    const existingHash = sha256(new Uint8Array(await readFile(deliveredTargetPath)))
    if (existingHash !== localFileHashes[rootPath])
      throw new Error(`Resource target already exists with different content: ${rootPath}`)
  }
  const resource: BeeGameProjectResource = {
    id,
    source: {
      type: 'resource-library',
      pack_id: requiredString(input.pack_id, 'Pack id'),
      pack_version: requiredString(input.pack_version, 'Pack version'),
      element_id: requiredString(input.element_id, 'Element id'),
      element_path: requiredString(input.element_path, 'Element path'),
    },
    root_path: rootPath,
    file_paths: filePaths,
    local_file_hashes: localFileHashes,
    provisional: false,
    status: 'verified',
    selected_at: new Date().toISOString(),
    selection_reason: nonEmptyStrings(
      input.selection_reason,
      'Resource selection reasons',
    ),
    ...(input.asset_kind ? { asset_kind: input.asset_kind } : {}),
    ...(input.capabilities?.length
      ? { capabilities: uniqueStrings(input.capabilities) }
      : {}),
    ...(input.content_profile
      ? { content_profile: structuredClone(input.content_profile) }
      : {}),
    ...(input.technical_facts
      ? { technical_facts: { ...input.technical_facts } }
      : {}),
    ...(dependencies.length
      ? {
          dependencies: dependencies.map(dependency => ({
            key: dependency.input.key,
            parent_key: dependency.input.parent_key,
            element_id: dependency.input.element_id,
            element_path: dependency.input.element_path,
            reference_path: dependency.input.reference_path,
            local_path: normalizeRelativePath(root, dependency.targetPath),
            ...(dependency.input.kind ? { kind: dependency.input.kind } : {}),
          })),
        }
      : {}),
  }
  const updated = replaceResource(manifest, resource)
  const rollback = await commitResourceWrites([
    { targetPath: sourceTargetPath, bytes: rootBytes },
    ...(converted ? [{ targetPath: deliveredTargetPath, bytes: converted.bytes }] : []),
    ...dependencies.map(dependency => ({
      targetPath: dependency.targetPath,
      bytes: dependency.bytes,
    })),
  ])
  try {
    await writeManifestAtomically(root, updated)
  } catch (error) {
    await rollback()
    throw error
  }
  return { manifest: updated, resource }
}

export async function registerBeeGameAuthoredResources(
  workspacePath: string,
  inputs: readonly BeeGameAuthoredResourceInput[],
  options: { additionalFormatCapabilities?: readonly string[] } = {},
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const establishedTarget = requireProjectTarget(manifest)
  const additionalFormatCapabilities = uniqueStrings(
    options.additionalFormatCapabilities ?? [],
  )
  const target = additionalFormatCapabilities.length
    ? validateTarget(
        {
          ...establishedTarget,
          asset_format_capabilities: uniqueStrings([
            ...establishedTarget.asset_format_capabilities,
            ...additionalFormatCapabilities,
          ]),
        },
        [],
      )
    : establishedTarget
  if (!target)
    throw new Error('Additional authored resource formats are invalid.')
  let updated = additionalFormatCapabilities.length
    ? parseCanonicalBeeGameAssetManifest({
        ...manifest,
        project_target: target,
      })
    : manifest
  const now = new Date().toISOString()
  const obsoletePaths = new Set<string>()
  for (const input of inputs) {
    const id = normalizeId(input.id)
    if (!id) throw new Error('Authored resource id is required')
    const rootPath = normalizedProjectPath(input.root_path)
    const filePaths = uniqueStrings(input.file_paths.map(normalizedProjectPath))
    const existing = updated.resources.find(resource => resource.id === id)
    if (existing && existing.source.type !== 'agent-authored')
      throw new Error(
        `Authored resource id belongs to a different source: ${id}`,
      )
    const changesPaths = Boolean(
      existing &&
        (existing.root_path !== rootPath ||
          existing.file_paths.length !== filePaths.length ||
          existing.file_paths.some(path => !filePaths.includes(path))),
    )
    if (changesPaths && !input.replace_existing_provisional)
      throw new Error(
        `Authored resource paths are immutable for stable id ${id}; revise the existing files in place or use the explicit replacement operation.`,
      )
    if (
      changesPaths &&
      (!existing?.provisional ||
        !input.provisional ||
        existing.source.type !== 'agent-authored')
    )
      throw new Error(
        `Only an agent-authored provisional resource can be replaced in place: ${id}`,
      )
    if (!filePaths.includes(rootPath))
      throw new Error(
        `Authored resource root must be listed in file_paths: ${id}`,
      )
    const programmaticAudio = validateAuthoredProgrammaticAudio(
      root,
      input,
      rootPath,
      filePaths,
    )
    for (const path of filePaths) {
      assertPathInDeclaredRoot(path, target.runtime_asset_root)
      const absolute = resolveInsideWorkspace(root, path)
      if (!existsSync(absolute))
        throw new Error(`Authored resource file does not exist: ${path}`)
      if (!programmaticAudio)
        assertFilenameFormatAllowed(path, target.asset_format_capabilities)
      assertAuthoredResourceMediaFile(
        resolveInsideWorkspace(root, path),
        path,
        input.asset_kind,
        Boolean(programmaticAudio),
      )
    }
    const hashes = Object.fromEntries(
      await Promise.all(
        filePaths.map(async path => [
          path,
          sha256(
            new Uint8Array(await readFile(resolveInsideWorkspace(root, path))),
          ),
        ]),
      ),
    )
    const resource: BeeGameProjectResource = {
      id,
      source: {
        type: 'agent-authored',
        created_at:
          existing?.source.type === 'agent-authored'
            ? existing.source.created_at
            : now,
        reason: requiredString(input.reason, 'Authored resource reason'),
      },
      root_path: rootPath,
      file_paths: filePaths,
      local_file_hashes: hashes,
      provisional: input.provisional,
      status: 'verified',
      selected_at: now,
      selection_reason: nonEmptyStrings(
        input.selection_reason,
        'Authored resource selection reasons',
      ),
      ...(input.asset_kind ? { asset_kind: input.asset_kind } : {}),
      ...(input.capabilities?.length
        ? { capabilities: uniqueStrings(input.capabilities) }
        : {}),
      ...(input.content_profile
        ? { content_profile: structuredClone(input.content_profile) }
        : {}),
      ...(input.technical_facts
        ? { technical_facts: { ...input.technical_facts } }
        : {}),
    }
    if (changesPaths)
      existing?.file_paths
        .filter(path => !filePaths.includes(path))
        .forEach(path => obsoletePaths.add(path))
    updated = replaceResource(updated, resource)
  }
  await writeManifestAtomically(root, updated)
  const retainedPaths = new Set(
    updated.resources.flatMap(resource => resource.file_paths),
  )
  await Promise.all(
    [...obsoletePaths]
      .filter(path => !retainedPaths.has(path))
      .map(path => rm(resolveInsideWorkspace(root, path), { force: true })),
  )
  return updated
}

export async function removeBeeGameUnboundResources(
  workspacePath: string,
  resourceIds: readonly string[],
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  requireProjectTarget(manifest)
  const ids = uniqueStrings(resourceIds.map(normalizeId))
  if (!ids.length) throw new Error('At least one resource id is required.')
  const requirementIds = new Set(manifest.requirements.map(item => item.id))
  const protectedIds = ids.filter(id => requirementIds.has(id))
  if (protectedIds.length)
    throw new Error(
      `Requirement resource identities must be repaired in place: ${protectedIds.join(', ')}.`,
    )
  const existingIds = new Set(manifest.resources.map(item => item.id))
  const missingIds = ids.filter(id => !existingIds.has(id))
  if (missingIds.length)
    throw new Error(
      `Resource identities do not exist: ${missingIds.join(', ')}.`,
    )
  const referencedIds = new Set(
    auditBeeGameContent(root, manifest).referencedResourceIds,
  )
  const stillReferenced = ids.filter(id => referencedIds.has(id))
  if (stillReferenced.length)
    throw new Error(
      `Remove resource references from JSON/YAML before pruning inventory: ${stillReferenced.join(', ')}.`,
    )
  const removed = manifest.resources.filter(resource =>
    ids.includes(resource.id),
  )
  const updated = parseCanonicalBeeGameAssetManifest({
    ...manifest,
    resources: manifest.resources.filter(
      resource => !ids.includes(resource.id),
    ),
  })
  const retainedPaths = new Set(
    updated.resources.flatMap(resource => resource.file_paths),
  )
  const obsoletePaths = [
    ...new Set(
      removed
        .flatMap(resource => resource.file_paths)
        .filter(path => !retainedPaths.has(path)),
    ),
  ]
  const snapshots = await Promise.all(
    obsoletePaths.map(async path => {
      try {
        return {
          path,
          bytes: await readFile(resolveInsideWorkspace(root, path)),
        }
      } catch {
        return { path }
      }
    }),
  )
  await writeManifestAtomically(root, updated)
  try {
    await Promise.all(
      obsoletePaths.map(path =>
        rm(resolveInsideWorkspace(root, path), { force: true }),
      ),
    )
  } catch (error) {
    await Promise.all(
      snapshots.map(async snapshot => {
        if (!snapshot.bytes) return
        const absolute = resolveInsideWorkspace(root, snapshot.path)
        await mkdir(dirname(absolute), { recursive: true })
        await writeFile(absolute, snapshot.bytes)
      }),
    )
    await writeManifestAtomically(root, manifest)
    throw error
  }
  return updated
}

function validateManifest(value: unknown): string[] {
  const issues: string[] = []
  if (!isRecord(value)) return ['manifest root must be an object.']
  rejectUnknownKeys(
    value,
    ['version', 'project_target', 'requirements', 'resources'],
    'manifest',
    issues,
  )
  if (value.version !== CURRENT_ASSET_MANIFEST_VERSION)
    issues.push(`version must be ${CURRENT_ASSET_MANIFEST_VERSION}.`)
  const target = validateTarget(value.project_target, issues)
  const requirements = Array.isArray(value.requirements)
    ? value.requirements
    : []
  const resources = Array.isArray(value.resources) ? value.resources : []
  if (!Array.isArray(value.requirements))
    issues.push('requirements must be an array.')
  if (!Array.isArray(value.resources))
    issues.push('resources must be an array.')

  const requirementIds = new Set<string>()
  requirements.forEach((item, index) =>
    validateRequirement(item, index, requirementIds, issues),
  )
  const resourceIds = new Set<string>()
  resources.forEach((item, index) =>
    validateResource(item, index, target, resourceIds, issues),
  )
  return issues
}

function validateTarget(
  value: unknown,
  issues: string[],
): BeeGameAssetProjectTarget | undefined {
  if (value === undefined) return undefined
  if (!isRecord(value)) {
    issues.push('project_target must be an object.')
    return undefined
  }
  rejectUnknownKeys(
    value,
    [
      'platform',
      'runtime',
      'asset_format_capabilities',
      'resource_library_usage',
      'runtime_asset_root',
      'content_root',
      'generated_asset_root',
    ],
    'project_target',
    issues,
  )
  if (!nonEmptyStringArray(value.asset_format_capabilities))
    issues.push(
      'project_target.asset_format_capabilities must be a non-empty array of non-empty strings.',
    )
  else if (
    !(value.asset_format_capabilities as unknown[]).every(
      isDirectAssetFormatCapability,
    )
  )
    issues.push(
      'project_target.asset_format_capabilities must contain direct lowercase filename extensions using only ASCII letters and digits, without dots or descriptive media labels.',
    )
  for (const field of [
    'runtime_asset_root',
    'content_root',
    'generated_asset_root',
  ] as const)
    if (!isProjectPath(value[field]))
      issues.push(`project_target.${field} must be a workspace-relative path.`)
  const expectedRoots = {
    runtime_asset_root: BEEGAME_RESOURCE_ROOTS.runtime,
    content_root: BEEGAME_RESOURCE_ROOTS.content,
    generated_asset_root: BEEGAME_RESOURCE_ROOTS.generated,
  } as const
  for (const [field, expected] of Object.entries(expectedRoots))
    if (value[field] !== expected)
      issues.push(`project_target.${field} must be ${expected}.`)
  if (
    value.resource_library_usage !== undefined &&
    !(RESOURCE_LIBRARY_USAGE as readonly unknown[]).includes(
      value.resource_library_usage,
    )
  )
    issues.push('project_target.resource_library_usage is invalid.')
  return value as BeeGameAssetProjectTarget
}

function validateRequirement(
  value: unknown,
  index: number,
  ids: Set<string>,
  issues: string[],
): void {
  const path = `requirements[${index}]`
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`)
    return
  }
  rejectUnknownKeys(
    value,
    ['id', 'name', 'purpose', 'required', 'acquisition_profile'],
    path,
    issues,
  )
  const id = trimmedString(value.id)
  if (!id) issues.push(`${path}.id must be a trimmed non-empty string.`)
  else if (ids.has(id)) issues.push(`${path}.id is duplicated: ${id}.`)
  else ids.add(id)
  if (value.required !== undefined && typeof value.required !== 'boolean')
    issues.push(`${path}.required must be a boolean.`)
  validateOptionalString(value.name, `${path}.name`, issues)
  validateOptionalString(value.purpose, `${path}.purpose`, issues)
  validateAcquisitionProfile(
    value.acquisition_profile,
    `${path}.acquisition_profile`,
    issues,
  )
}

function validateAcquisitionProfile(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`)
    return
  }
  rejectUnknownKeys(
    value,
    ['dimensions', 'asset_kinds', 'usage_tags', 'capabilities', 'styles'],
    path,
    issues,
  )
  validateEnumArray(
    value.dimensions,
    RESOURCE_DIMENSIONS,
    `${path}.dimensions`,
    issues,
    true,
  )
  validateEnumArray(
    value.asset_kinds,
    RESOURCE_ASSET_KINDS,
    `${path}.asset_kinds`,
    issues,
    true,
  )
  validateEnumArray(
    value.usage_tags,
    RESOURCE_USAGE_TAGS,
    `${path}.usage_tags`,
    issues,
  )
  validateEnumArray(
    value.capabilities,
    RESOURCE_CAPABILITIES,
    `${path}.capabilities`,
    issues,
  )
  if (!Array.isArray(value.styles) || !value.styles.every(isTrimmedString))
    issues.push(`${path}.styles must be an array of trimmed non-empty strings.`)
}

function validateEnumArray(
  value: unknown,
  allowed: readonly string[],
  path: string,
  issues: string[],
  requireOne = false,
): void {
  if (
    !Array.isArray(value) ||
    (requireOne && value.length === 0) ||
    !value.every(item =>
      typeof item === 'string' && allowed.includes(item),
    )
  )
    issues.push(
      `${path} must be ${requireOne ? 'a non-empty' : 'an'} array of canonical values.`,
    )
}

function isTrimmedString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
}
function validateResource(
  value: unknown,
  index: number,
  target: BeeGameAssetProjectTarget | undefined,
  ids: Set<string>,
  issues: string[],
): void {
  const path = `resources[${index}]`
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`)
    return
  }
  rejectUnknownKeys(
    value,
    [
      'id',
      'source',
      'root_path',
      'file_paths',
      'local_file_hashes',
      'provisional',
      'status',
      'selected_at',
      'selection_reason',
      'asset_kind',
      'capabilities',
      'content_profile',
      'technical_facts',
      'dependencies',
      'error',
    ],
    path,
    issues,
  )
  const id = trimmedString(value.id)
  if (!id) issues.push(`${path}.id must be a trimmed non-empty string.`)
  else if (ids.has(id)) issues.push(`${path}.id is duplicated: ${id}.`)
  else ids.add(id)
  validateResourceSource(value.source, `${path}.source`, issues)
  const rootPath = isProjectPath(value.root_path) ? String(value.root_path) : ''
  if (!rootPath)
    issues.push(`${path}.root_path must be a workspace-relative path.`)
  const filePaths = nonEmptyStringArray(value.file_paths)
    ? (value.file_paths as string[])
    : []
  if (!filePaths.length || !filePaths.every(isProjectPath))
    issues.push(
      `${path}.file_paths must be a non-empty array of workspace-relative paths.`,
    )
  if (rootPath && filePaths.length && !filePaths.includes(rootPath))
    issues.push(`${path}.root_path must be listed in file_paths.`)
  if (target?.runtime_asset_root) {
    const sourceType = isRecord(value.source) ? value.source.type : undefined
    const allowedRoots = sourceType === 'resource-library'
      ? [target.runtime_asset_root, target.generated_asset_root]
      : [target.runtime_asset_root]
    for (const filePath of filePaths)
      if (!allowedRoots.some(root => pathWithin(root, filePath)))
        issues.push(
          `${path}.file_paths is outside the declared resource roots: ${filePath}.`,
        )
  }
  if (typeof value.provisional !== 'boolean')
    issues.push(`${path}.provisional must be a boolean.`)
  if (!(BEEGAME_RESOURCE_STATUSES as readonly unknown[]).includes(value.status))
    issues.push(`${path}.status is invalid.`)
  if (!trimmedString(value.selected_at))
    issues.push(`${path}.selected_at must be a trimmed non-empty string.`)
  if (!nonEmptyStringArray(value.selection_reason))
    issues.push(
      `${path}.selection_reason must be a non-empty array of non-empty strings.`,
    )
  const assetKind = trimmedString(value.asset_kind)
  if (value.asset_kind !== undefined && !assetKind)
    issues.push(`${path}.asset_kind must be a trimmed non-empty string.`)
  if (assetKind && AUDIO_ASSET_KINDS.has(assetKind)) {
    const allowedExtensions = PLAYABLE_AUDIO_ASSET_KINDS.has(assetKind)
      ? AUDIO_FILE_EXTENSIONS
      : new Set([...AUDIO_FILE_EXTENSIONS, '.json'])
    for (const filePath of filePaths)
      if (!allowedExtensions.has(extname(filePath).toLowerCase()))
        issues.push(
          `${path}.asset_kind ${assetKind} requires an actual audio file or structured audio definition: ${filePath}.`,
        )
    const structuredPaths = filePaths.filter(
      filePath => extname(filePath).toLowerCase() === '.json',
    )
    if (
      structuredPaths.length > 0 &&
      (value.provisional !== true ||
        !['audio-cue', 'audio-bank'].includes(assetKind) ||
        filePaths.length !== 1 ||
        structuredPaths[0] !== rootPath)
    )
      issues.push(
        `${path} programmatic audio must be one provisional audio-cue or audio-bank JSON root file.`,
      )
  }
  validateHashes(
    value.local_file_hashes,
    `${path}.local_file_hashes`,
    filePaths,
    issues,
  )
  validateDependencies(
    value.dependencies,
    `${path}.dependencies`,
    filePaths,
    issues,
  )
}

function validateResourceSource(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`)
    return
  }
  if (value.type === 'resource-library') {
    rejectUnknownKeys(
      value,
      ['type', 'pack_id', 'pack_version', 'element_id', 'element_path'],
      path,
      issues,
    )
    for (const field of [
      'pack_id',
      'pack_version',
      'element_id',
      'element_path',
    ])
      if (!trimmedString(value[field]))
        issues.push(`${path}.${field} is required.`)
    return
  }
  if (value.type === 'agent-authored') {
    rejectUnknownKeys(value, ['type', 'created_at', 'reason'], path, issues)
    if (!trimmedString(value.created_at))
      issues.push(`${path}.created_at is required.`)
    if (!trimmedString(value.reason)) issues.push(`${path}.reason is required.`)
    return
  }
  if (value.type === 'user-provided') {
    rejectUnknownKeys(value, ['type', 'created_at', 'filename'], path, issues)
    if (!trimmedString(value.created_at))
      issues.push(`${path}.created_at is required.`)
    if (!trimmedString(value.filename))
      issues.push(`${path}.filename is required.`)
    return
  }
  issues.push(`${path}.type is invalid.`)
}

function assertAuthoredResourceMediaFile(
  absolutePath: string,
  projectPath: string,
  assetKind: string | undefined,
  programmaticAudio: boolean,
): void {
  if (!assetKind || !AUDIO_ASSET_KINDS.has(assetKind)) return
  const extension = extname(projectPath).toLowerCase()
  if (programmaticAudio && extension === '.json') return
  if (
    PLAYABLE_AUDIO_ASSET_KINDS.has(assetKind) &&
    !AUDIO_FILE_EXTENSIONS.has(extension)
  )
    throw new Error(
      `Authored ${assetKind} resource must be a loadable audio file: ${projectPath}`,
    )
  if (!AUDIO_FILE_EXTENSIONS.has(extension))
    throw new Error(
      `Authored ${assetKind} resource must be a loadable audio file or a valid BeeGame programmatic audio resource: ${projectPath}`,
    )
  const bytes = readFileSync(absolutePath)
  const valid =
    (extension === '.ogg' &&
      bytes.subarray(0, 4).toString('ascii') === 'OggS') ||
    (extension === '.opus' &&
      bytes.subarray(0, 4).toString('ascii') === 'OggS') ||
    (extension === '.wav' &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WAVE') ||
    (extension === '.flac' &&
      bytes.subarray(0, 4).toString('ascii') === 'fLaC') ||
    (extension === '.mp3' &&
      (bytes.subarray(0, 3).toString('ascii') === 'ID3' ||
        (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0))) ||
    (extension === '.aac' && bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xf0) ||
    (extension === '.m4a' && bytes.subarray(4, 8).toString('ascii') === 'ftyp')
  if (!valid)
    throw new Error(
      `Authored ${assetKind} resource is not a valid ${extension} media file: ${projectPath}`,
    )
}

function validateAuthoredProgrammaticAudio(
  workspacePath: string,
  input: BeeGameAuthoredResourceInput,
  rootPath: string,
  filePaths: readonly string[],
): BeeGameProgrammaticAudioResource | undefined {
  const jsonPaths = filePaths.filter(
    path => extname(path).toLowerCase() === '.json',
  )
  if (jsonPaths.length === 0) return undefined
  if (input.asset_kind !== 'audio-cue' && input.asset_kind !== 'audio-bank')
    return undefined
  if (!input.provisional)
    throw new Error('Programmatic audio resources must be provisional.')
  if (filePaths.length !== 1 || jsonPaths[0] !== rootPath)
    throw new Error('Programmatic audio must be one standalone JSON root file.')
  const resource = parseBeeGameProgrammaticAudioText(
    readFileSync(resolveInsideWorkspace(workspacePath, rootPath), 'utf8'),
  )
  if (input.asset_kind === 'audio-cue' && resource.cues.length !== 1)
    throw new Error(
      'An authored audio-cue programmatic resource must define exactly one cue.',
    )
  return resource
}

function replaceResource(
  manifest: BeeGameAssetManifest,
  resource: BeeGameProjectResource,
): BeeGameAssetManifest {
  return parseCanonicalBeeGameAssetManifest({
    ...manifest,
    resources: [
      ...manifest.resources.filter(item => item.id !== resource.id),
      resource,
    ],
  })
}

function emptyManifest(): BeeGameAssetManifest {
  return {
    version: CURRENT_ASSET_MANIFEST_VERSION,
    requirements: [],
    resources: [],
  }
}

function requireProjectTarget(
  manifest: BeeGameAssetManifest,
): BeeGameAssetProjectTarget {
  if (!manifest.project_target)
    throw new Error(
      'project_target must be established before resource production',
    )
  return manifest.project_target
}

function isSamePinnedLibraryResource(
  resource: BeeGameProjectResource,
  input: BeeGameResolvedLibraryResourceInput,
): boolean {
  return (
    resource.source.type === 'resource-library' &&
    resource.source.pack_id === input.pack_id &&
    resource.source.pack_version === input.pack_version &&
    resource.source.element_id === input.element_id &&
    resource.source.element_path === input.element_path
  )
}

async function prepareDependencies(input: {
  root: string
  declaredAssetRoot: string
  rootTargetPath: string
  dependencies: NonNullable<BeeGameResolvedLibraryResourceInput['dependencies']>
  allowedFormats?: string[]
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
}): Promise<
  Array<{
    input: NonNullable<
      BeeGameResolvedLibraryResourceInput['dependencies']
    >[number]
    targetPath: string
    bytes: Uint8Array
  }>
> {
  const targets = new Map<string, string>([['root', input.rootTargetPath]])
  const result: Array<{
    input: NonNullable<
      BeeGameResolvedLibraryResourceInput['dependencies']
    >[number]
    targetPath: string
    bytes: Uint8Array
  }> = []
  for (const dependency of input.dependencies) {
    if (input.allowedFormats)
      assertFilenameFormatAllowed(dependency.element_path, input.allowedFormats)
    const parent = targets.get(dependency.parent_key)
    if (!parent)
      throw new Error(
        `Resource dependency parent is missing: ${dependency.parent_key}`,
      )
    const targetPath = resolveInsideDeclaredRoot(
      input.root,
      input.declaredAssetRoot,
      resolve(dirname(parent), dependency.reference_path),
    )
    const bytes = await downloadResource(dependency.source_url, input.fetchImpl)
    if (!isSha256(dependency.source_hash) || sha256(bytes) !== dependency.source_hash)
      throw new Error(`Resource dependency differs from the frozen Catalog content hash: ${dependency.element_id}`)
    assertDetectedFormat(dependency.element_path, bytes)
    targets.set(dependency.key, targetPath)
    result.push({ input: dependency, targetPath, bytes })
  }
  return result
}

async function downloadResource(
  url: string,
  fetchImpl: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>,
): Promise<Uint8Array> {
  const response = await fetchImpl(requiredString(url, 'Resource URL'))
  if (!response.ok)
    throw new Error(`Resource download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength)
    throw new Error('Resource download returned an empty file')
  return bytes
}

async function resourceFilesMatchHashes(
  root: string,
  resource: BeeGameProjectResource,
): Promise<boolean> {
  if (!resource.local_file_hashes) return false
  for (const path of resource.file_paths) {
    const expected = resource.local_file_hashes[path]
    if (!isSha256(expected)) return false
    try {
      const actual = sha256(
        new Uint8Array(await readFile(resolveInsideWorkspace(root, path))),
      )
      if (actual !== expected) return false
    } catch {
      return false
    }
  }
  return true
}

async function writeManifestAtomically(
  root: string,
  manifest: BeeGameAssetManifest,
): Promise<void> {
  const validated = parseCanonicalBeeGameAssetManifest(manifest)
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  const requirementsBytes = encodeJson({
    requirements: validated.requirements,
  })
  const requirementsModulePath = `${ASSET_REQUIREMENTS_MODULE_ROOT}/${sha256(
    requirementsBytes,
  ).slice(0, 24)}.json`
  const requirementsPath = resolveInsideWorkspace(root, requirementsModulePath)
  const resourceModules = validated.resources
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map(resource => ({
      path: `${ASSET_RESOURCE_MODULE_ROOT}/${createHash('sha256')
        .update(resource.id)
        .digest('hex')
        .slice(0, 12)}-${sha256(encodeJson(resource)).slice(0, 12)}.json`,
      resource,
    }))
  const index: BeeGameAssetManifestIndex = {
    version: CURRENT_ASSET_MANIFEST_VERSION,
    ...(validated.project_target
      ? { project_target: validated.project_target }
      : {}),
    modules: {
      requirements: requirementsModulePath,
      resources: resourceModules.map(module => module.path),
    },
  }
  const resourceModuleDirectory = resolveInsideWorkspace(
    root,
    ASSET_RESOURCE_MODULE_ROOT,
  )
  const previousResourceModules = existsSync(resourceModuleDirectory)
    ? readdirSync(resourceModuleDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => `${ASSET_RESOURCE_MODULE_ROOT}/${entry.name}`)
    : []
  const requirementsModuleDirectory = resolveInsideWorkspace(
    root,
    ASSET_REQUIREMENTS_MODULE_ROOT,
  )
  const previousRequirementModules = existsSync(requirementsModuleDirectory)
    ? readdirSync(requirementsModuleDirectory, { withFileTypes: true })
        .filter(entry => entry.isFile())
        .map(entry => `${ASSET_REQUIREMENTS_MODULE_ROOT}/${entry.name}`)
    : []
  const writes = [
    {
      targetPath: requirementsPath,
      bytes: requirementsBytes,
    },
    ...resourceModules.map(module => ({
      targetPath: resolveInsideWorkspace(root, module.path),
      bytes: encodeJson(module.resource),
    })),
    { targetPath: manifestPath, bytes: encodeJson(index) },
  ]
  const temporaryPaths: string[] = []
  try {
    for (const write of writes) {
      await mkdir(dirname(write.targetPath), { recursive: true })
      const temporaryPath = `${write.targetPath}.${randomUUID()}.tmp`
      temporaryPaths.push(temporaryPath)
      await writeFile(temporaryPath, write.bytes)
    }
    for (let index = 0; index < writes.length; index += 1)
      await rename(temporaryPaths[index]!, writes[index]!.targetPath)
    const currentPaths = new Set(resourceModules.map(module => module.path))
    currentPaths.add(requirementsModulePath)
    await Promise.all(
      [...previousRequirementModules, ...previousResourceModules]
        .filter(path => !currentPaths.has(path))
        .map(path => rm(resolveInsideWorkspace(root, path), { force: true })),
    )
  } finally {
    await Promise.all(
      temporaryPaths.map(path =>
        rm(path, { force: true }).catch(() => undefined),
      ),
    )
  }
}

function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

async function commitResourceWrites(
  writes: Array<{ targetPath: string; bytes: Uint8Array }>,
): Promise<() => Promise<void>> {
  const snapshots: Array<{ targetPath: string; previous?: Uint8Array }> = []
  const temporaryPaths: string[] = []
  try {
    for (const write of writes) {
      const previous = existsSync(write.targetPath)
        ? new Uint8Array(await readFile(write.targetPath))
        : undefined
      snapshots.push({
        targetPath: write.targetPath,
        ...(previous ? { previous } : {}),
      })
      await mkdir(dirname(write.targetPath), { recursive: true })
      const temporaryPath = `${write.targetPath}.${randomUUID()}.tmp`
      temporaryPaths.push(temporaryPath)
      await writeFile(temporaryPath, write.bytes)
      await rename(temporaryPath, write.targetPath)
    }
  } catch (error) {
    await rollbackResourceWrites(snapshots)
    throw error
  } finally {
    await Promise.all(
      temporaryPaths.map(path => rm(path, { force: true }).catch(() => undefined)),
    )
  }
  return () => rollbackResourceWrites(snapshots)
}

async function rollbackResourceWrites(
  snapshots: Array<{ targetPath: string; previous?: Uint8Array }>,
): Promise<void> {
  for (const snapshot of snapshots.reverse()) {
    if (snapshot.previous)
      await writeFile(snapshot.targetPath, snapshot.previous)
    else await rm(snapshot.targetPath, { force: true })
  }
}

function resolveResourceDestination(
  root: string,
  runtimeAssetRoot: string,
  destination: string,
  filename: string,
): string {
  const normalized = normalizedProjectPath(destination)
  const hasExtension = Boolean(extname(normalized))
  return resolveInsideDeclaredRoot(
    root,
    runtimeAssetRoot,
    hasExtension ? normalized : join(normalized, filename),
  )
}

function resolveInsideDeclaredRoot(
  workspace: string,
  declaredRoot: string,
  candidate: string,
): string {
  const rootPath = resolveInsideWorkspace(workspace, declaredRoot)
  const target = isAbsolute(candidate)
    ? resolve(candidate)
    : resolveInsideWorkspace(workspace, candidate)
  if (target !== rootPath && !target.startsWith(`${rootPath}${sep}`))
    throw new Error(
      `Resource path is outside canonical asset root: ${candidate}`,
    )
  return target
}

function resolveInsideWorkspace(workspace: string, candidate: string): string {
  const target = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(workspace, candidate)
  if (target !== workspace && !target.startsWith(`${workspace}${sep}`))
    throw new Error(`Path escapes workspace: ${candidate}`)
  return target
}

function normalizeWorkspacePath(path: string): string {
  if (!path || !isAbsolute(path))
    throw new Error('Workspace path must be absolute')
  return resolve(path)
}

function normalizeRelativePath(root: string, path: string): string {
  const result = relative(root, path).split(sep).join('/')
  if (!isProjectPath(result)) throw new Error(`Invalid project path: ${result}`)
  return result
}

function normalizedProjectPath(value: string): string {
  const normalized = requiredString(value, 'Project path')
    .replaceAll('\\', '/')
    .replace(/^\.\//, '')
  if (!isProjectPath(normalized))
    throw new Error(`Invalid project path: ${value}`)
  return normalized
}

function pathWithin(scope: string, target: string): boolean {
  const normalizedScope = scope.replaceAll('\\', '/').replace(/\/$/, '')
  const normalizedTarget = target.replaceAll('\\', '/').replace(/^\.\//, '')
  return (
    normalizedTarget === normalizedScope ||
    normalizedTarget.startsWith(`${normalizedScope}/`)
  )
}

function assertPathInDeclaredRoot(path: string, root: string): void {
  if (!pathWithin(root, path))
    throw new Error(`Resource path is outside canonical asset root: ${path}`)
}

function isProjectPath(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim())
    return false
  if (isAbsolute(value) || value.startsWith('/') || value.includes('\\'))
    return false
  const parts = value.split('/')
  return parts.every(part => part && part !== '.' && part !== '..')
}

function sanitizeFilename(path: string): string {
  const filename = basename(requiredString(path, 'Resource filename'))
  if (!filename || filename === '.' || filename === '..')
    throw new Error('Resource filename is invalid')
  return filename
}

function assertFilenameFormatAllowed(
  filename: string,
  formats: string[],
): void {
  const allowed = new Set(formats.map(normalizeFormat).filter(Boolean))
  if (!allowed.size)
    throw new Error('Target asset format capabilities are required')
  const format = normalizeFormat(extname(filename).slice(1))
  if (!format || !allowed.has(format))
    throw new Error(
      `Resource format is not supported by the target: ${filename}`,
    )
}

function assertDetectedFormat(filename: string, bytes: Uint8Array): void {
  const declared = normalizeFormat(extname(filename).slice(1))
  const detected = detectResourceBinaryFormat(bytes)
  if (detected && declared && !formatsAgree(declared, detected))
    throw new Error(`Resource binary format mismatch: ${filename}`)
}

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

function formatsAgree(left: string, right: string): boolean {
  return (
    left === right ||
    (left === 'jpeg' && right === 'jpg') ||
    (left === 'jpg' && right === 'jpeg')
  )
}

function normalizeFormat(value: string): string {
  return value.trim().toLowerCase().replace(/^\./, '')
}

function isDirectAssetFormatCapability(value: unknown): value is string {
  if (
    typeof value !== 'string' ||
    !value ||
    value !== value.trim() ||
    value !== value.toLowerCase()
  )
    return false
  return [...value].every(character => {
    const code = character.charCodeAt(0)
    return (code >= 97 && code <= 122) || (code >= 48 && code <= 57)
  })
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isSha256(value: unknown): value is string {
  if (typeof value !== 'string' || value.length !== 64) return false
  return [...value].every(character => '0123456789abcdef'.includes(character))
}

function validateHashes(
  value: unknown,
  path: string,
  filePaths: string[],
  issues: string[],
): void {
  if (value === undefined) return
  if (!isRecord(value)) {
    issues.push(`${path} must be an object.`)
    return
  }
  for (const [filePath, hash] of Object.entries(value)) {
    if (!filePaths.includes(filePath))
      issues.push(`${path} contains an unknown file path: ${filePath}.`)
    if (!isSha256(hash))
      issues.push(`${path}.${filePath} must be a SHA-256 hash.`)
  }
}

function validateDependencies(
  value: unknown,
  path: string,
  filePaths: string[],
  issues: string[],
): void {
  if (value === undefined) return
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array.`)
    return
  }
  value.forEach((dependency, index) => {
    const itemPath = `${path}[${index}]`
    if (!isRecord(dependency)) {
      issues.push(`${itemPath} must be an object.`)
      return
    }
    rejectUnknownKeys(
      dependency,
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
    ])
      if (!trimmedString(dependency[field]))
        issues.push(`${itemPath}.${field} is required.`)
    const localPath = trimmedString(dependency.local_path)
    if (localPath && !filePaths.includes(localPath))
      issues.push(
        `${itemPath}.local_path must be listed in resource file_paths.`,
      )
  })
}

function rejectUnknownKeys(
  value: Record<string, unknown>,
  allowed: string[],
  path: string,
  issues: string[],
): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(value).filter(key => !allowedKeys.has(key))
  if (unknown.length)
    issues.push(`${path} contains unknown fields: ${unknown.join(', ')}.`)
}

function validateOptionalString(
  value: unknown,
  path: string,
  issues: string[],
): void {
  if (value !== undefined && !trimmedString(value))
    issues.push(`${path} must be a trimmed non-empty string when present.`)
}

function nonEmptyStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(item => Boolean(trimmedString(item)))
  )
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap(item => (trimmedString(item) ? [String(item)] : []))
    : []
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function nonEmptyStrings(values: readonly string[], label: string): string[] {
  const result = uniqueStrings(values)
  if (!result.length) throw new Error(`${label} are required`)
  return result
}

function requiredString(value: string, label: string): string {
  const result = value?.trim()
  if (!result) throw new Error(`${label} is required`)
  return result
}

function normalizeId(value: string): string {
  return value?.trim() ?? ''
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() && value === value.trim()
    ? value
    : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
