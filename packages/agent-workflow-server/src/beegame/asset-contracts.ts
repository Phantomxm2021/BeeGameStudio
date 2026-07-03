import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'

export type BeeGameAssetIntegrationMode = 'filesystem' | 'mcp' | 'manual'

export type BeeGameAssetProjectTarget = {
  kind?: string
  engine?: string
  integration_mode?: BeeGameAssetIntegrationMode
  mcp_server?: string
}

export type BeeGameAssetIntegrationProvider = {
  type?: BeeGameAssetIntegrationMode
  server?: string
  capabilities?: string[]
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
  return normalizeBeeGameAssetManifest(parsed)
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

export function normalizeBeeGameAssetManifest(value: unknown): BeeGameAssetManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid asset manifest')
  }
  const record = value as Record<string, unknown>
  const slots = Array.isArray(record.slots)
    ? record.slots.map(slot => normalizeAssetSlot(slot)).filter(Boolean) as BeeGameAssetSlot[]
    : normalizeNestedAssetSlots(record.assets ?? record.resources)
  return {
    version: normalizeManifestVersion(record.version),
    project_target: normalizeProjectTarget(record.project_target ?? record),
    slots,
  }
}

function normalizeAssetSlot(value: unknown, fallbackId = ''): BeeGameAssetSlot | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const id = normalizeSlotId(String(record.id || fallbackId))
  if (!id) return undefined
  const target = record.target && typeof record.target === 'object' && !Array.isArray(record.target)
    ? record.target as Record<string, unknown>
    : {}
  const provider = record.integration_provider &&
    typeof record.integration_provider === 'object' &&
    !Array.isArray(record.integration_provider)
    ? record.integration_provider as Record<string, unknown>
    : {}
  const specs = objectValue(record.recommended_specs) || objectValue(record.specs)
  const legacySpecs = collectLegacySpecs(record)
  const formats = stringArray(record.accepted_formats)
  const legacyFormats = normalizeLegacyFormats(record.format)
  return {
    id,
    name: trimString(record.name),
    type: trimString(record.type),
    purpose: trimString(record.purpose) || trimString(record.description),
    required: Boolean(record.required),
    placeholder: record.placeholder !== false &&
      record.status !== 'implemented' &&
      record.placeholder_status !== 'implemented',
    accepted_formats: formats.length ? formats : legacyFormats,
    recommended_specs: specs || legacySpecs,
    target: {
      path: trimString(target.path) || trimString(record.path),
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
    updated_at: trimString(record.updated_at),
  }
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

function isAssetLikeRecord(record: Record<string, unknown>): boolean {
  return typeof record.path === 'string' ||
    typeof record.type === 'string' ||
    typeof record.purpose === 'string' ||
    typeof record.description === 'string' ||
    typeof record.placeholder_status === 'string' ||
    record.specs !== undefined ||
    record.format !== undefined
}

function normalizeProjectTarget(value: unknown): BeeGameAssetProjectTarget | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  return {
    kind: trimString(record.kind),
    engine: trimString(record.engine),
    integration_mode: normalizeIntegrationMode(record.integration_mode),
    mcp_server: trimString(record.mcp_server),
  }
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
    const target = extension
      ? targetPath
      : join(targetPath, normalizedFilename)
    return resolveInsideWorkspace(root, target)
  }
  return resolveInsideWorkspace(root, join(ASSET_UPLOAD_ROOT, slot.id, normalizedFilename))
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
