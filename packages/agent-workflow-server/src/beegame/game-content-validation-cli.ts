import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { auditBeeGameContentPackage, parseBeeGameContentIndex } from './game-content-package'
import { PROJECT_CONTENT_CONTRACT_PATH } from './project-delivery'
import type { DeliveryRun } from './delivery-workflow/types'

/** Read-only entry point to the exact host validation used after Content authoring. */
const validationScope = {
  scope: 'content-contract-and-references',
  runtimeVerified: false,
} as const

export function validateGameContent(workspacePath: string) {
  const started = performance.now()
  const legacyRunPath = resolve(workspacePath, '.beegame/workflow/run.json')
  const nativeIndexPath = resolve(workspacePath, 'content/index.json')
  const nativeIndex = existsSync(resolve(workspacePath, PROJECT_CONTENT_CONTRACT_PATH)) && existsSync(nativeIndexPath)
    ? parseBeeGameContentIndex(JSON.parse(readFileSync(nativeIndexPath, 'utf8')))
    : undefined
  const run = nativeIndex ? undefined : JSON.parse(
    readFileSync(legacyRunPath, 'utf8'),
  ) as DeliveryRun
  const assetManifestRevision = nativeIndex?.assetManifestRevision ?? run?.revision.resource
  if (!assetManifestRevision)
    return {
      ...validationScope,
      valid: false,
      issues: ['An accepted Asset Manifest revision is required.'],
      contentCount: 0,
      elapsedMs: Math.round(performance.now() - started),
    }
  const audit = auditBeeGameContentPackage(workspacePath, {
    documentRevision: nativeIndex?.documentRevision ?? run!.revision.document,
    assetManifestRevision,
    manifest: readBeeGameAssetManifestSync(workspacePath),
  })
  return {
    ...validationScope,
    valid: audit.valid,
    issues: audit.issues,
    contentCount: audit.package?.documents.length ?? 0,
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
