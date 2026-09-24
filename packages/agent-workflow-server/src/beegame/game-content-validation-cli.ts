import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readBeeGameAssetManifestSync, type BeeGameAssetManifest } from './asset-contracts'
import { auditBeeGameContentPackage, parseBeeGameContentIndex, type BeeGameContentPackage } from './game-content-package'
import type { BeeGameContentIndex } from './game-content-schema'
import { PROJECT_CONTENT_CONTRACT_PATH } from './project-delivery'

/** Read-only entry point to the exact host validation used after Content authoring. */
const validationScope = {
  scope: 'content-contract-and-references',
  runtimeVerified: false,
} as const

/** A static estimate of the files implied by staged document dependencies. */
export function summarizeContentLoadFootprint(
  index: BeeGameContentIndex,
  content: BeeGameContentPackage,
  manifest: BeeGameAssetManifest,
  fileSize: (path: string) => number,
) {
  const registry = index.documents
  if (!registry) return undefined
  const contentById = new Map(content.documents.map(document => [document.id, document]))
  const filesFor = (phase: 'startup' | 'on-demand') => {
    const assetIds = new Set<string>()
    for (const entry of registry.filter(document => document.loadPhase === phase))
      for (const assetId of contentById.get(entry.id)?.assetRefs ?? []) assetIds.add(assetId)
    const files = new Set<string>()
    for (const assetId of assetIds) {
      const resource = manifest.resources.find(candidate => candidate.id === assetId)
      for (const path of resource?.file_paths ?? []) files.add(path)
    }
    return { documentCount: registry.filter(document => document.loadPhase === phase).length, assetIds, files }
  }
  const startup = filesFor('startup')
  const onDemand = filesFor('on-demand')
  const deferredFiles = new Set([...onDemand.files].filter(path => !startup.files.has(path)))
  const deferredAssets = new Set([...onDemand.assetIds].filter(id => !startup.assetIds.has(id)))
  const bytes = (files: ReadonlySet<string>) => [...files].reduce((total, path) => total + fileSize(path), 0)
  return {
    basis: 'static manifest-file estimate; deferredOnly excludes startup assets/files; raw bytes, not transfer size or runtime proof',
    startup: { documentCount: startup.documentCount, assetCount: startup.assetIds.size, fileCount: startup.files.size, rawBytes: bytes(startup.files) },
    deferredOnly: { documentCount: onDemand.documentCount, assetCount: deferredAssets.size, fileCount: deferredFiles.size, rawBytes: bytes(deferredFiles) },
  }
}

export function validateGameContent(workspacePath: string) {
  const started = performance.now()
  const nativeIndexPath = resolve(workspacePath, 'content/index.json')
  const nativeIndex = existsSync(resolve(workspacePath, PROJECT_CONTENT_CONTRACT_PATH)) && existsSync(nativeIndexPath)
    ? parseBeeGameContentIndex(JSON.parse(readFileSync(nativeIndexPath, 'utf8')))
    : undefined
  const assetManifestRevision = nativeIndex?.assetManifestRevision
  if (!assetManifestRevision)
    return {
      ...validationScope,
      valid: false,
      issues: ['An accepted Asset Manifest revision is required.'],
      contentCount: 0,
      elapsedMs: Math.round(performance.now() - started),
    }
  const audit = auditBeeGameContentPackage(workspacePath, {
    documentRevision: nativeIndex.documentRevision,
    assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(workspacePath),
  })
  const loadFootprint = audit.package && nativeIndex?.documents
    ? summarizeContentLoadFootprint(nativeIndex, audit.package, readBeeGameAssetManifestSync(workspacePath),
      path => statSync(resolve(workspacePath, path)).size)
    : undefined
  return {
    ...validationScope,
    valid: audit.valid,
    issues: audit.issues,
    contentCount: audit.package?.documents.length ?? 0,
    ...(loadFootprint ? { loadFootprint } : {}),
    elapsedMs: Math.round(performance.now() - started),
  }
}

/** Inspect only the requested content file, preserving authored values verbatim. */
export function inspectGameContent(workspacePath: string, path?: string, nodeId?: string) {
  const workspace = realpathSync(workspacePath)
  const root = realpathSync(resolve(workspace, 'content'))
  const inside = (parent: string, child: string) => {
    const rel = relative(parent, child)
    return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
  }
  if (!inside(workspace, root)) throw new Error('Content directory is outside the project workspace.')
  const read = (file: string) => {
    const absolute = realpathSync(resolve(root, file))
    if (!inside(root, absolute)) throw new Error('Content file is outside the content directory.')
    return JSON.parse(readFileSync(absolute, 'utf8'))
  }
  const index = parseBeeGameContentIndex(read('index.json'))
  if (!path) {
    if (nodeId) throw new Error('A content-relative file path is required for --node.')
    return { ok: true, scope: 'inspection', index }
  }
  if (isAbsolute(path) || !index.files.includes(path))
    throw new Error('Requested file must be registered in content/index.json.')
  const document = read(path)
  const nodes: Record<string, unknown>[] = Array.isArray(document.data?.nodes)
    ? document.data.nodes : []
  if (nodeId) {
    const matches = nodes.filter(node => node?.id === nodeId)
    if (matches.length !== 1) throw new Error(`Expected one node "${nodeId}", found ${matches.length}.`)
    return { ok: true, scope: 'inspection', path, documentId: document.id, node: matches[0] }
  }
  return {
    ok: true, scope: 'inspection', path, documentId: document.id,
    kind: document.kind, assetRefs: document.assetRefs,
    settings: document.data?.settings, rootId: document.data?.rootId,
    nodeCount: nodes.length, nodeIds: nodes.map(node => node?.id),
  }
}

export function runGameContentCommand(workspacePath: string, args: string[] = []) {
  if (args.length === 0) return validateGameContent(workspacePath)
  if (args[0] !== '--inspect' ||
      !(args.length === 1 || args.length === 2 ||
        (args.length === 4 && args[2] === '--node' && args[3] && !args[1]?.startsWith('--'))))
    throw new Error('Usage: <workspace> [--inspect [content-relative-file [--node id]]]')
  return inspectGameContent(workspacePath, args[1], args[3])
}

if (import.meta.main) {
  try {
    const result = runGameContentCommand(resolve(process.argv[2] ?? process.cwd()), process.argv.slice(3))
    console.log(JSON.stringify(result, null, 2))
    process.exitCode = ('valid' in result ? result.valid : result.ok) ? 0 : 1
  } catch (error) {
    console.log(
      JSON.stringify({
        valid: false,
        issues: [error instanceof Error ? error.message : String(error)],
      }),
    )
    process.exitCode = 1
  }
}
