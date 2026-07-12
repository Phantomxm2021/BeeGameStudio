import { existsSync, readFileSync } from 'node:fs'
import { mkdir, open, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { RESOURCE_CATEGORIES, RESOURCE_USAGE_TAGS, type ResourceUsageTag } from '../../../beegame-resource-core/src/types'

export type BeeGameAssetIntegrationMode = 'filesystem' | 'mcp' | 'manual'

export type BeeGameAssetProjectTarget = {
  kind?: string
  engine?: string
  integration_mode?: BeeGameAssetIntegrationMode
  mcp_server?: string
  /** Formats supported by the selected runtime adapter, never inferred from a Pack. */
  asset_format_capabilities?: string[]
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

/**
 * The machine-readable matching contract for one project asset slot. This is
 * deliberately independent of the project's target engine: adapters decide
 * how an approved resource is integrated, while selection stays deterministic.
 */
export type BeeGameResourceRequirement = {
  category?: string
  dimension?: '2D' | '3D' | 'agnostic'
  accepted_formats?: string[]
  styles?: string[]
  game_types?: string[]
  tags?: ResourceUsageTag[]
  purpose?: string
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
  // declare the formats its own runtime adapter can consume before it is
  // allowed to select or copy library content. Slot formats further narrow
  // that adapter contract; they never broaden it.
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
  resource_binding?: BeeGameResourceBinding
  integration_error?: string
  updated_at?: string
}

export type BeeGameAssetManifest = {
  version: number
  project_target?: BeeGameAssetProjectTarget
  slots: BeeGameAssetSlot[]
}

export type BeeGameAssetUploadResult = {
  manifest: BeeGameAssetManifest
  slot: BeeGameAssetSlot
  path: string
  message: string
}

const ASSET_MANIFEST_PATH = 'assets/asset-manifest.json'
const ASSET_UPLOAD_ROOT = 'assets/uploads'

export async function readBeeGameAssetManifest(
  workspacePath: string,
): Promise<BeeGameAssetManifest> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifestPath = resolveInsideWorkspace(root, ASSET_MANIFEST_PATH)
  if (!existsSync(manifestPath)) {
    return { version: 1, slots: [] }
  }
  const parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return reconcileAssetContractFiles(root, normalizeBeeGameAssetManifest(parsed))
}

export async function uploadBeeGameAsset(
  workspacePath: string,
  slotId: string,
  file: File,
  uploadedUrl?: string,
): Promise<BeeGameAssetUploadResult> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedSlotId = normalizeSlotId(slotId)
  const slotIndex = manifest.slots.findIndex(slot => slot.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset slot not found: ${normalizedSlotId}`)
  const slot = manifest.slots[slotIndex]
  assertAssetFormatAllowed(file.name, slot, manifest.project_target)
  const targetPath = resolveUploadTarget(root, slot, file.name)
  await mkdir(resolve(targetPath, '..'), { recursive: true })
  const bytes = new Uint8Array(await file.arrayBuffer())
  await writeFile(targetPath, bytes)
  const relativePath = normalizeRelativePath(root, targetPath)
  const updatedSlot: BeeGameAssetSlot = {
    ...slot,
    status: 'uploaded',
    placeholder: false,
    uploaded_files: [...new Set([...(slot.uploaded_files ?? []), relativePath])],
    ...(uploadedUrl
      ? { uploaded_urls: [...new Set([...(slot.uploaded_urls ?? []), uploadedUrl])] }
      : {}),
    updated_at: new Date().toISOString(),
  }
  manifest.slots[slotIndex] = updatedSlot
  await writeAssetManifest(root, manifest)
  return {
    manifest,
    slot: updatedSlot,
    path: relativePath,
    message: buildUploadMessage(updatedSlot, relativePath, manifest.project_target),
  }
}

export function bindBeeGameLibraryResource(
  manifest: BeeGameAssetManifest,
  slotId: string,
  binding: BeeGameResourceBinding,
): { manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot } {
  const normalizedSlotId = normalizeSlotId(slotId)
  const slotIndex = manifest.slots.findIndex(slot => slot.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset slot not found: ${normalizedSlotId}`)
  const validatedBinding = normalizeResourceBinding(binding)
  if (!validatedBinding) throw new Error('Invalid resource binding')
  const slot = { ...manifest.slots[slotIndex], resource_binding: validatedBinding, updated_at: new Date().toISOString() }
  const slots = [...manifest.slots]
  slots[slotIndex] = slot
  return { manifest: { ...manifest, slots }, slot }
}

export async function bindBeeGameLibraryResourceInWorkspace(
  workspacePath: string,
  slotId: string,
  binding: BeeGameResourceBinding,
): Promise<{ manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot }> {
  const root = normalizeWorkspacePath(workspacePath)
  const result = bindBeeGameLibraryResource(await readBeeGameAssetManifest(root), slotId, binding)
  await writeAssetManifest(root, result.manifest)
  return result
}

/** Removes the library provenance only; copied project files deliberately remain intact. */
export function unbindBeeGameLibraryResource(
  manifest: BeeGameAssetManifest,
  slotId: string,
): { manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot } {
  const normalizedSlotId = normalizeSlotId(slotId)
  const slotIndex = manifest.slots.findIndex(slot => slot.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset slot not found: ${normalizedSlotId}`)
  const { resource_binding: _binding, ...slotWithoutBinding } = manifest.slots[slotIndex]
  const slot: BeeGameAssetSlot = { ...slotWithoutBinding, updated_at: new Date().toISOString() }
  const slots = [...manifest.slots]
  slots[slotIndex] = slot
  return { manifest: { ...manifest, slots }, slot }
}

export async function unbindBeeGameLibraryResourceInWorkspace(
  workspacePath: string,
  slotId: string,
): Promise<{ manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot }> {
  const root = normalizeWorkspacePath(workspacePath)
  const result = unbindBeeGameLibraryResource(await readBeeGameAssetManifest(root), slotId)
  await writeAssetManifest(root, result.manifest)
  return result
}

/**
 * Removes only files that this asset contract recorded as copied into the
 * project. The library binding is intentionally retained so the same pinned
 * Pack version can be re-integrated later without reselecting an asset.
 */
export async function removeBeeGameAssetIntegrationInWorkspace(
  workspacePath: string,
  slotId: string,
): Promise<{ manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot; removedPaths: string[] }> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedSlotId = normalizeSlotId(slotId)
  const slotIndex = manifest.slots.findIndex(slot => slot.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset slot not found: ${normalizedSlotId}`)
  const slot = manifest.slots[slotIndex]
  const relativePaths = [...new Set(slot.uploaded_files ?? [])]
  if (!relativePaths.length) throw new Error(`Asset slot has no copied integration files: ${normalizedSlotId}`)

  const targets = relativePaths.map(path => ({ path, target: resolveInsideWorkspace(root, path) }))
  const removedPaths: string[] = []
  for (const { path, target } of targets) {
    if (!existsSync(target)) continue
    await rm(target, { force: true })
    removedPaths.push(path)
  }

  const { integration_error: _integrationError, ...slotWithoutIntegrationError } = slot
  const updatedSlot: BeeGameAssetSlot = {
    ...slotWithoutIntegrationError,
    status: 'placeholder',
    placeholder: true,
    uploaded_files: [],
    uploaded_urls: [],
    updated_at: new Date().toISOString(),
  }
  manifest.slots[slotIndex] = updatedSlot
  await writeAssetManifest(root, manifest)
  return { manifest, slot: updatedSlot, removedPaths }
}

export async function integrateBeeGameLibraryResourceInWorkspace(
  workspacePath: string,
  slotId: string,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<{ manifest: BeeGameAssetManifest; slot: BeeGameAssetSlot; path?: string }> {
  const root = normalizeWorkspacePath(workspacePath)
  const manifest = await readBeeGameAssetManifest(root)
  const normalizedSlotId = normalizeSlotId(slotId)
  const slotIndex = manifest.slots.findIndex(slot => slot.id === normalizedSlotId)
  if (slotIndex < 0) throw new Error(`Asset slot not found: ${normalizedSlotId}`)
  const slot = manifest.slots[slotIndex]
  const binding = slot.resource_binding
  if (!binding) throw new Error(`Asset slot has no library resource binding: ${normalizedSlotId}`)
  const mode = slot.integration_provider?.type || manifest.project_target?.integration_mode || 'filesystem'
  if (mode !== 'filesystem') return { manifest, slot }
  const filename = boundResourceFilename(binding)
  assertAssetFormatAllowed(filename, slot, manifest.project_target)
  const targetPath = resolveUploadTarget(root, slot, filename)
  const response = await fetchImpl(binding.source_url)
  if (!response.ok) throw new Error(`Resource download failed (${response.status})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const declaredFormat = extensionOf(filename)
  const detectedFormat = detectResourceBinaryFormat(bytes)
  if (detectedFormat && declaredFormat && !formatsAgree(declaredFormat, detectedFormat)) {
    throw new Error(
      `Resource binary format mismatch: library declares .${declaredFormat}, received ${detectedFormat}`,
    )
  }
  await mkdir(resolve(targetPath, '..'), { recursive: true })
  await writeFile(targetPath, bytes)
  const relativePath = normalizeRelativePath(root, targetPath)
  const copiedDependencyPaths = await copyBoundResourceDependencies(
    root,
    targetPath,
    binding,
    fetchImpl,
    normalizeFormats(manifest.project_target?.asset_format_capabilities),
  )
  // Copying a binary makes it available to the project, but it cannot prove
  // that engine/runtime code references it. The Agent is responsible for that
  // final step and can then set the contract to `integrated` with evidence.
  const updatedSlot: BeeGameAssetSlot = {
    ...slot,
    // A copied GLB remains a GLB. Never write a binary under a requested FBX
    // filename just because the contract allowed both formats.
    ...(slot.target?.path !== relativePath ? { target: { ...slot.target, path: relativePath } } : {}),
    resource_binding: detectedFormat && binding.content_format !== detectedFormat
      ? { ...binding, content_format: detectedFormat }
      : binding,
    status: 'uploaded', placeholder: false,
    uploaded_files: [...new Set([...(slot.uploaded_files ?? []), relativePath, ...copiedDependencyPaths])], updated_at: new Date().toISOString(),
  }
  manifest.slots[slotIndex] = updatedSlot
  await writeAssetManifest(root, manifest)
  return { manifest, slot: updatedSlot, path: relativePath }
}

async function copyBoundResourceDependencies(
  root: string,
  rootTargetPath: string,
  binding: BeeGameResourceBinding,
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  allowedFormats: readonly string[],
): Promise<string[]> {
  const targets = new Map<string, string>([['root', rootTargetPath]])
  const copied: string[] = []
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
    await mkdir(resolve(targetPath, '..'), { recursive: true })
    await writeFile(targetPath, bytes)
    targets.set(dependency.key, targetPath)
    copied.push(normalizeRelativePath(root, targetPath))
  }
  return copied
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
  const slots = Array.isArray(record.slots)
    ? record.slots.map(slot => normalizeAssetSlot(slot)).filter(Boolean) as BeeGameAssetSlot[]
    // Older generated manifests used an object keyed by slot id. Preserve the
    // explicit entries without deriving new semantics from their keys.
    : objectValue(record.slots)
      ? normalizeNestedAssetSlots(record.slots)
      : normalizeCategorizedAssetSlots(record.categories)
        .concat(normalizeNestedAssetSlots(record.assets ?? record.resources))
  return {
    version: normalizeManifestVersion(record.version),
    project_target: normalizeProjectTarget(record.project_target ?? record),
    slots,
  }
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
  const slots = await Promise.all(manifest.slots.map(async slot => {
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
  return { ...manifest, slots }
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
    resource_binding: normalizeResourceBinding(record.resource_binding),
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
  const purpose = trimString(record.purpose)
  if (!category && !dimension && !acceptedFormats.length && !styles.length && !gameTypes.length && !tags.length && !purpose) return undefined
  return {
    category: category || undefined,
    dimension,
    accepted_formats: acceptedFormats,
    styles,
    game_types: gameTypes,
    ...(tags.length ? { tags } : {}),
    purpose: purpose || undefined,
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

function normalizeNestedAssetSlots(value: unknown): BeeGameAssetSlot[] {
  const slots: BeeGameAssetSlot[] = []
  const visit = (item: unknown, keyHint = '') => {
    if (Array.isArray(item)) {
      for (const child of item) visit(child)
      return
    }
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    if ((typeof record.id === 'string' && record.id.trim()) || isAssetLikeRecord(record)) {
      const slot = normalizeAssetSlot(record, keyHint)
      if (slot) slots.push(slot)
      return
    }
    for (const [key, child] of Object.entries(record)) visit(child, key)
  }
  visit(value)
  return slots
}

function normalizeCategorizedAssetSlots(value: unknown): BeeGameAssetSlot[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const slots: BeeGameAssetSlot[] = []
  for (const [categoryKey, categoryValue] of Object.entries(value as Record<string, unknown>)) {
    if (!categoryValue || typeof categoryValue !== 'object' || Array.isArray(categoryValue)) continue
    const category = categoryValue as Record<string, unknown>
    const categorySlots = Array.isArray(category.slots) ? category.slots : []
    const categoryDescription = trimString(category.description)
    for (const slotValue of categorySlots) {
      const slot = normalizeAssetSlot(slotValue, '', {
        type: categoryKey,
        purpose: categoryDescription,
      })
      if (slot) slots.push(slot)
    }
  }
  return slots
}

function isAssetLikeRecord(record: Record<string, unknown>): boolean {
  return typeof record.slot_id === 'string' ||
    typeof record.path === 'string' ||
    typeof record.type === 'string' ||
    typeof record.purpose === 'string' ||
    typeof record.description === 'string' ||
    typeof record.placeholder_status === 'string' ||
    record.specs !== undefined ||
    record.format !== undefined ||
    record.replacement !== undefined
}

function normalizeProjectTarget(value: unknown): BeeGameAssetProjectTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    kind: trimString(record.kind) || trimString(record.platform),
    engine: trimString(record.engine),
    integration_mode: normalizeIntegrationMode(record.integration_mode),
    mcp_server: trimString(record.mcp_server),
    asset_format_capabilities: stringArray(record.asset_format_capabilities ?? record.supported_asset_formats),
  }
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
    : Number(value || 1)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1
}

function normalizeSlotStatus(value: unknown): BeeGameAssetSlot['status'] {
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

function boundResourceFilename(binding: BeeGameResourceBinding): string {
  const elementPath = trimString(binding.element_path)
  if (elementPath) return sanitizeFilename(elementPath)
  try {
    const filename = basename(new URL(binding.source_url).pathname)
    if (filename) return sanitizeFilename(filename)
  } catch {
    // Preserve backwards compatibility with historical signed URLs.
  }
  return sanitizeFilename(binding.element_id)
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
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
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
    `Asset uploaded for slot "${slot.id}".`,
    `File: ${path}.`,
    slot.purpose ? `Purpose: ${slot.purpose}.` : '',
    slot.target?.integration_notes ? `Integration notes: ${slot.target.integration_notes}.` : '',
    'The upload is not considered integrated until the project references it and it is verified in runtime.',
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
