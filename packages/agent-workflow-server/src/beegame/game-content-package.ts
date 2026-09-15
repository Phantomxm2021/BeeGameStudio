import { createHash } from 'node:crypto'
import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { z } from 'zod/v4'
import type { BeeGameAssetManifest } from './asset-contracts'

export const BEEGAME_CONTENT_ROOT = 'content' as const
export const BEEGAME_CONTENT_INDEX = 'content/index.json' as const
export const BEEGAME_CONTENT_PACKAGE_SCHEMA =
  'beegame-content-package.v1' as const
export const BEEGAME_CONTENT_DOCUMENT_SCHEMA = 'beegame-content.v1' as const

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const finiteNumber = z.number().finite()
const identifier = z.string().trim().min(1).max(256)
const uniqueIdentifiers = z
  .array(identifier)
  .superRefine((values, context) => {
    if (new Set(values).size !== values.length)
      context.addIssue({ code: 'custom', message: 'values must be unique' })
  })

const contentIndexSchema = z
  .strictObject({
    schema: z.literal(BEEGAME_CONTENT_PACKAGE_SCHEMA),
    id: identifier,
    dimension: z.literal('2d'),
    irRevision: digestSchema,
    assetManifestRevision: digestSchema,
    entryScene: identifier,
    files: uniqueIdentifiers.min(1),
  })

const transform2dSchema = z
  .strictObject({
    position: z.tuple([finiteNumber, finiteNumber]),
    rotation: finiteNumber.optional(),
    scale: z.tuple([finiteNumber, finiteNumber]).optional(),
  })

const contentComponentSchema = z
  .strictObject({
    type: identifier,
    assetRef: identifier.optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })

const sceneNodeSchema = z
  .strictObject({
    id: identifier,
    parentId: identifier.optional(),
    name: z.string().trim().min(1).max(512).optional(),
    kind: identifier,
    enabled: z.boolean().optional(),
    transform: transform2dSchema.optional(),
    layer: identifier.optional(),
    zIndex: finiteNumber.optional(),
    assetRef: identifier.optional(),
    components: z.array(contentComponentSchema).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })

const uiLayoutSchema = z
  .strictObject({
    anchor: identifier.optional(),
    position: z.tuple([finiteNumber, finiteNumber]).optional(),
    size: z.tuple([finiteNumber.nonnegative(), finiteNumber.nonnegative()]).optional(),
    rotation: finiteNumber.optional(),
    scale: z.tuple([finiteNumber, finiteNumber]).optional(),
  })

const uiNodeSchema = z
  .strictObject({
    id: identifier,
    parentId: identifier.optional(),
    role: identifier,
    name: z.string().trim().min(1).max(512).optional(),
    text: z.string().optional(),
    assetRef: identifier.optional(),
    layout: uiLayoutSchema.optional(),
    bindings: z.record(z.string(), z.string()).optional(),
    actions: z.record(z.string(), identifier).optional(),
    style: z.record(z.string(), z.unknown()).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })

const contentHeader = {
  schema: z.literal(BEEGAME_CONTENT_DOCUMENT_SCHEMA),
  id: identifier,
  irRefs: uniqueIdentifiers.min(1),
  assetRefs: uniqueIdentifiers,
} as const

const sceneDocumentSchema = z
  .strictObject({
    ...contentHeader,
    kind: z.literal('scene-2d'),
    data: z
      .strictObject({
        nodes: z.array(sceneNodeSchema).min(1),
        cameraNodeId: identifier.optional(),
      }),
  })

const uiDocumentSchema = z
  .strictObject({
    ...contentHeader,
    kind: z.enum(['ui-screen', 'ui-hud', 'ui-flow']),
    data: z
      .strictObject({
        rootId: identifier,
        nodes: z.array(uiNodeSchema).min(1),
      }),
  })

const contentDocumentSchema = z.discriminatedUnion('kind', [
  sceneDocumentSchema,
  uiDocumentSchema,
])

export type BeeGameContentIndex = z.infer<typeof contentIndexSchema>
export type BeeGameContentDocument = z.infer<typeof contentDocumentSchema>

export type BeeGameContentAuthority = Readonly<{
  irRevision: string
  assetManifestRevision: string
  irNodeIds: readonly string[]
  manifest: BeeGameAssetManifest
}>

export type BeeGameContentPackage = Readonly<{
  index: BeeGameContentIndex
  documents: readonly BeeGameContentDocument[]
  digest: string
}>

export type BeeGameContentDocumentSnapshot = Readonly<{
  path: string
  revision: string
  document: BeeGameContentDocument
}>

export type BeeGameContentEditorSnapshot = Readonly<{
  contentRevision: string
  index: BeeGameContentIndex
  documents: readonly BeeGameContentDocumentSnapshot[]
}>

export type BeeGameContentDocumentSaveResult = BeeGameContentDocumentSnapshot &
  Readonly<{ contentRevision: string }>

export type BeeGameContentPackageAudit = Readonly<{
  valid: boolean
  issues: readonly string[]
  package?: BeeGameContentPackage
}>

export type BeeGameContentReadyReceipt = Readonly<{
  schemaVersion: 'game-content-ready.v1'
  contentRevision: string
  irRevision: string
  assetManifestRevision: string
  indexPath: typeof BEEGAME_CONTENT_INDEX
  contentIds: readonly string[]
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value)).digest('hex')
}

function safeContentFile(workspace: string, path: string): string | undefined {
  if (
    !path ||
    isAbsolute(path) ||
    path.includes('\\') ||
    !path.endsWith('.json') ||
    path === 'index.json'
  )
    return undefined
  const root = resolve(workspace, BEEGAME_CONTENT_ROOT)
  const absolute = resolve(root, path)
  const fromRoot = relative(root, absolute)
  if (
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  )
    return undefined
  return absolute
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function listJsonFiles(root: string): string[] {
  const output: string[] = []
  function visit(current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const absolute = resolve(current, entry.name)
      if (entry.isDirectory()) visit(absolute)
      else if (entry.isFile() && entry.name.endsWith('.json'))
        output.push(relative(root, absolute).split(sep).join('/'))
    }
  }
  visit(root)
  return output.sort()
}

function validateTree(input: {
  path: string
  nodes: readonly { id: string; parentId?: string }[]
  rootId?: string
  issues: string[]
}): void {
  const ids = new Set<string>()
  for (const node of input.nodes) {
    if (ids.has(node.id)) input.issues.push(`${input.path}: duplicate node id ${node.id}.`)
    ids.add(node.id)
  }
  if (input.rootId && !ids.has(input.rootId))
    input.issues.push(`${input.path}: rootId does not resolve: ${input.rootId}.`)
  const parents = new Map<string, string>()
  for (const node of input.nodes) {
    if (!node.parentId) continue
    if (!ids.has(node.parentId))
      input.issues.push(`${input.path}: parentId does not resolve: ${node.parentId}.`)
    if (node.parentId === node.id)
      input.issues.push(`${input.path}: node cannot parent itself: ${node.id}.`)
    parents.set(node.id, node.parentId)
  }
  for (const id of ids) {
    const visited = new Set<string>()
    let cursor: string | undefined = id
    while (cursor && parents.has(cursor)) {
      if (visited.has(cursor)) {
        input.issues.push(`${input.path}: node hierarchy contains a cycle at ${cursor}.`)
        break
      }
      visited.add(cursor)
      cursor = parents.get(cursor)
    }
  }
  if (input.rootId) {
    const root = input.nodes.find(node => node.id === input.rootId)
    if (root?.parentId)
      input.issues.push(`${input.path}: UI root cannot have a parent.`)
    for (const node of input.nodes)
      if (node.id !== input.rootId && !node.parentId)
        input.issues.push(`${input.path}: non-root UI node requires parentId: ${node.id}.`)
  }
}

function validateNoResourcePathBypass(
  path: string,
  value: unknown,
  issues: string[],
  trail: string[] = [],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateNoResourcePathBypass(path, item, issues, [...trail, String(index)]),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    const nextTrail = [...trail, key]
    if (
      typeof item === 'string' &&
      /(?:path|url|src|href)$/i.test(key) &&
      (/^(?:https?:|data:|file:|\/|\.\.?(?:\/|$))/i.test(item) ||
        item.startsWith('assets/'))
    )
      issues.push(
        `${path}: ${nextTrail.join('.')} bypasses assetRefs with a path or URL.`,
      )
    validateNoResourcePathBypass(path, item, issues, nextTrail)
  }
}

function validateDocument(input: {
  path: string
  document: BeeGameContentDocument
  authority: BeeGameContentAuthority
  issues: string[]
}): void {
  const irIds = new Set(input.authority.irNodeIds)
  const resourceById = new Map(
    input.authority.manifest.resources.map(resource => [resource.id, resource]),
  )
  for (const id of input.document.irRefs)
    if (!irIds.has(id)) input.issues.push(`${input.path}: unknown IR node ${id}.`)
  for (const id of input.document.assetRefs) {
    const resource = resourceById.get(id)
    if (!resource) input.issues.push(`${input.path}: unknown asset ${id}.`)
    else if (resource.status !== 'verified')
      input.issues.push(`${input.path}: asset is not verified: ${id}.`)
  }
  const declaredAssets = new Set(input.document.assetRefs)
  for (const node of input.document.data.nodes) {
    if (node.assetRef && !declaredAssets.has(node.assetRef))
      input.issues.push(
        `${input.path}: node ${node.id} uses undeclared assetRef ${node.assetRef}.`,
      )
    if ('components' in node)
      for (const component of node.components ?? [])
        if (component.assetRef && !declaredAssets.has(component.assetRef))
          input.issues.push(
            `${input.path}: node ${node.id} component ${component.type} uses undeclared assetRef ${component.assetRef}.`,
          )
  }
  validateTree({
    path: input.path,
    nodes: input.document.data.nodes,
    ...(input.document.kind === 'scene-2d'
      ? {}
      : { rootId: input.document.data.rootId }),
    issues: input.issues,
  })
  if (input.document.kind === 'scene-2d') {
    const cameraNodeId = input.document.data.cameraNodeId
    if (
      cameraNodeId &&
      !input.document.data.nodes.some(node => node.id === cameraNodeId)
    )
      input.issues.push(
        `${input.path}: cameraNodeId does not resolve: ${cameraNodeId}.`,
      )
  }
  validateNoResourcePathBypass(input.path, input.document.data, input.issues)
}

export function auditBeeGameContentPackage(
  workspacePath: string,
  authority: BeeGameContentAuthority,
): BeeGameContentPackageAudit {
  const issues: string[] = []
  const workspace = resolve(workspacePath)
  const root = resolve(workspace, BEEGAME_CONTENT_ROOT)
  const indexPath = resolve(workspace, BEEGAME_CONTENT_INDEX)
  if (!existsSync(indexPath) || !statSync(indexPath).isFile())
    return { valid: false, issues: [`Missing ${BEEGAME_CONTENT_INDEX}.`] }

  let index: BeeGameContentIndex
  try {
    index = contentIndexSchema.parse(parseJson(indexPath))
  } catch (error) {
    return {
      valid: false,
      issues: [
        `${BEEGAME_CONTENT_INDEX}: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
  if (index.irRevision !== authority.irRevision)
    issues.push(`${BEEGAME_CONTENT_INDEX}: irRevision does not match authority.`)
  if (index.assetManifestRevision !== authority.assetManifestRevision)
    issues.push(
      `${BEEGAME_CONTENT_INDEX}: assetManifestRevision does not match authority.`,
    )

  const documents: BeeGameContentDocument[] = []
  const documentPaths = new Set(index.files)
  const actualPaths = existsSync(root)
    ? listJsonFiles(root).filter(path => path !== 'index.json')
    : []
  for (const path of actualPaths)
    if (!documentPaths.has(path))
      issues.push(`${BEEGAME_CONTENT_INDEX}: unregistered content file ${path}.`)

  for (const path of index.files) {
    const absolute = safeContentFile(workspace, path)
    if (!absolute) {
      issues.push(`${BEEGAME_CONTENT_INDEX}: unsafe content path ${path}.`)
      continue
    }
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      issues.push(`${BEEGAME_CONTENT_INDEX}: missing content file ${path}.`)
      continue
    }
    let document: BeeGameContentDocument
    try {
      document = contentDocumentSchema.parse(parseJson(absolute))
    } catch (error) {
      issues.push(
        `${BEEGAME_CONTENT_ROOT}/${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
      continue
    }
    const wrongDirectory =
      (document.kind === 'scene-2d' && !path.startsWith('scenes/')) ||
      (document.kind !== 'scene-2d' && !path.startsWith('ui/'))
    if (wrongDirectory)
      issues.push(`${BEEGAME_CONTENT_ROOT}/${path}: kind is stored in the wrong directory.`)
    validateDocument({
      path: `${BEEGAME_CONTENT_ROOT}/${path}`,
      document,
      authority,
      issues,
    })
    documents.push(document)
  }

  const ids = new Set<string>()
  for (const document of documents) {
    if (ids.has(document.id)) issues.push(`Duplicate content id: ${document.id}.`)
    ids.add(document.id)
  }
  const entry = documents.find(document => document.id === index.entryScene)
  if (!entry) issues.push(`Entry scene does not resolve: ${index.entryScene}.`)
  else if (entry.kind !== 'scene-2d')
    issues.push(`Entry content must be scene-2d: ${index.entryScene}.`)

  if (issues.length) return { valid: false, issues }
  const value = { index, documents }
  return {
    valid: true,
    issues: [],
    package: Object.freeze({ ...value, digest: digest(value) }),
  }
}

export function parseBeeGameContentIndex(value: unknown): BeeGameContentIndex {
  return contentIndexSchema.parse(structuredClone(value))
}

export function parseBeeGameContentDocument(
  value: unknown,
): BeeGameContentDocument {
  return contentDocumentSchema.parse(structuredClone(value))
}

/** Load one canonical Scene/UI document for direct editor mutation. */
export function loadBeeGameContentDocument(
  workspacePath: string,
  path: string,
): BeeGameContentDocumentSnapshot {
  const absolute = safeContentFile(workspacePath, path)
  if (!absolute || !existsSync(absolute) || !statSync(absolute).isFile())
    throw new Error(`Content document is unavailable: ${path}`)
  const document = contentDocumentSchema.parse(parseJson(absolute))
  return {
    path,
    revision: digest(document),
    document,
  }
}

/** Load the exact canonical package that Scene/UI editors display and edit. */
export function loadBeeGameContentPackageForEditing(
  workspacePath: string,
  authority: BeeGameContentAuthority,
): BeeGameContentEditorSnapshot {
  const audit = auditBeeGameContentPackage(workspacePath, authority)
  if (!audit.package)
    throw new Error(
      `Game Content Package is invalid: ${audit.issues.join('; ')}`,
    )
  return {
    contentRevision: audit.package.digest,
    index: audit.package.index,
    documents: audit.package.index.files.map(path =>
      loadBeeGameContentDocument(workspacePath, path),
    ),
  }
}

/**
 * Atomically save one existing canonical Scene/UI document. The expected
 * revision prevents an editor from overwriting a newer user or Agent edit.
 */
export function saveBeeGameContentDocument(input: {
  workspacePath: string
  path: string
  expectedRevision: string
  document: unknown
  authority: BeeGameContentAuthority
}): BeeGameContentDocumentSaveResult {
  const indexPath = resolve(input.workspacePath, BEEGAME_CONTENT_INDEX)
  const index = contentIndexSchema.parse(parseJson(indexPath))
  if (index.irRevision !== input.authority.irRevision)
    throw new Error('Content package IR revision does not match the edit authority')
  if (index.assetManifestRevision !== input.authority.assetManifestRevision)
    throw new Error('Content package Asset Manifest revision does not match the edit authority')
  if (!index.files.includes(input.path))
    throw new Error(`Content document is not registered: ${input.path}`)
  const current = loadBeeGameContentDocument(input.workspacePath, input.path)
  if (current.revision !== input.expectedRevision)
    throw new Error(`Content document revision changed: ${input.path}`)

  const document = contentDocumentSchema.parse(structuredClone(input.document))
  if (document.id !== current.document.id || document.kind !== current.document.kind)
    throw new Error(`Content document identity cannot change during an edit: ${input.path}`)
  const wrongDirectory =
    (document.kind === 'scene-2d' && !input.path.startsWith('scenes/')) ||
    (document.kind !== 'scene-2d' && !input.path.startsWith('ui/'))
  if (wrongDirectory)
    throw new Error(`Content document kind is stored in the wrong directory: ${input.path}`)

  const issues: string[] = []
  validateDocument({
    path: `${BEEGAME_CONTENT_ROOT}/${input.path}`,
    document,
    authority: input.authority,
    issues,
  })
  if (issues.length)
    throw new Error(`Content document is invalid: ${issues.join('; ')}`)

  const absolute = safeContentFile(input.workspacePath, input.path)
  if (!absolute) throw new Error(`Unsafe content document path: ${input.path}`)
  const temporary = `${absolute}.${process.pid}.tmp`
  try {
    writeFileSync(temporary, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
    renameSync(temporary, absolute)
  } catch (error) {
    try { unlinkSync(temporary) } catch {}
    throw error
  }
  const saved = loadBeeGameContentDocument(input.workspacePath, input.path)
  const contentRevision = loadBeeGameContentPackageForEditing(
    input.workspacePath,
    input.authority,
  ).contentRevision
  return { ...saved, contentRevision }
}

/** Accept only a complete package; the receipt contains no second copy of it. */
export function acceptBeeGameContentPackage(
  workspacePath: string,
  authority: BeeGameContentAuthority,
): BeeGameContentReadyReceipt {
  const audit = auditBeeGameContentPackage(workspacePath, authority)
  if (!audit.package)
    throw new Error(
      `Game Content Package is invalid: ${audit.issues.join('; ')}`,
    )
  return Object.freeze({
    schemaVersion: 'game-content-ready.v1',
    contentRevision: audit.package.digest,
    irRevision: audit.package.index.irRevision,
    assetManifestRevision: audit.package.index.assetManifestRevision,
    indexPath: BEEGAME_CONTENT_INDEX,
    contentIds: audit.package.documents.map(document => document.id),
  })
}

/** Recompute durable package bytes during recovery without inventing IR facts. */
export function recoverBeeGameContentRevision(
  workspacePath: string,
  manifest: BeeGameAssetManifest,
): string {
  const indexPath = resolve(workspacePath, BEEGAME_CONTENT_INDEX)
  const index = contentIndexSchema.parse(parseJson(indexPath))
  const irNodeIds = new Set<string>()
  for (const path of index.files) {
    const absolute = safeContentFile(workspacePath, path)
    if (!absolute) throw new Error(`unsafe content path ${path}`)
    const document = contentDocumentSchema.parse(parseJson(absolute))
    document.irRefs.forEach(id => irNodeIds.add(id))
  }
  const audit = auditBeeGameContentPackage(workspacePath, {
    irRevision: index.irRevision,
    assetManifestRevision: index.assetManifestRevision,
    irNodeIds: [...irNodeIds],
    manifest,
  })
  if (!audit.package)
    throw new Error(`Game Content Package is invalid: ${audit.issues.join('; ')}`)
  return audit.package.digest
}
