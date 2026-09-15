import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { GAME_IR_CANONICAL_MODULE_IDS, gameIrCommittedPath, gameIrRevisionPath,
  parseGameIrReadyReceipt, type GameIrCompileRequest, type GameIrModuleId, type GameIrReadyReceipt } from './core/contracts'
import { canonicalGameIrJson, digestGameIrValue, parseGameIrCandidate,
  compareCodeUnits, type GameIrCandidate, type GameIrSourceSection } from './core/model'

export type DirectPublicationAuthority = Readonly<{
  workspacePath: string
  publicationId: string
  request: GameIrCompileRequest
  sections: readonly GameIrSourceSection[]
  candidate: GameIrCandidate
}>

function bytes(value: unknown): string { return `${canonicalGameIrJson(value)}\n` }
function digestBytes(value: string): string { return digestGameIrValue(JSON.parse(value)) }
function safePath(workspacePath: string, relative: string): string {
  const root = resolve(workspacePath), target = resolve(root, relative)
  if (target !== root && !target.startsWith(`${root}/`)) throw new Error('Game IR publication path escapes workspace')
  return target
}
async function write(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, bytes(value), { flag: 'wx', mode: 0o600 })
}
async function readJson(path: string): Promise<unknown> { return JSON.parse(await readFile(path, 'utf8')) }

function artifacts(authority: DirectPublicationAuthority) {
  const candidate = parseGameIrCandidate(authority.candidate, { request: authority.request, sections: authority.sections })
  const moduleDigests = {} as Record<GameIrModuleId, string>
  const sourceMapDigests = {} as Record<GameIrModuleId, string>
  const modules = new Map<string, unknown>(), sourceMaps = new Map<string, unknown>()
  for (const module of candidate.modules) {
    const moduleBody = { schemaVersion: 'game-ir-module.v1', foundationRevision: candidate.foundationRevision, ...module }
    const sourceBody = { schemaVersion: 'game-ir-source-map.v1', moduleId: module.moduleId,
      nodes: module.nodes.map(node => ({ nodeId: node.id, bindings: node.bindings })) }
    modules.set(module.moduleId, moduleBody); sourceMaps.set(module.moduleId, sourceBody)
    moduleDigests[module.moduleId as GameIrModuleId] = digestBytes(bytes(moduleBody))
    sourceMapDigests[module.moduleId as GameIrModuleId] = digestBytes(bytes(sourceBody))
  }
  const graph = { schemaVersion: 'game-ir-dependency-graph.v1', edges: candidate.modules.flatMap(module =>
    module.nodes.flatMap(node => [
      ...node.references.map(reference => ({ from: node.id, type: 'reference', to: reference.targetId })),
      ...node.edges.map(edge => ({ from: node.id, type: edge.type, to: edge.targetId })),
    ])).sort((a, b) => compareCodeUnits(canonicalGameIrJson(a), canonicalGameIrJson(b))) }
  const dependencyGraphDigest = digestBytes(bytes(graph))
  const manifest = { schemaVersion: 'game-ir-manifest.v1', taskId: candidate.taskId,
    publicationId: authority.publicationId, foundationRevision: candidate.foundationRevision,
    foundationReceiptDigest: authority.request.foundation.receiptDigest,
    modules: GAME_IR_CANONICAL_MODULE_IDS.map(moduleId => ({ moduleId,
      digest: moduleDigests[moduleId], sourceMapDigest: sourceMapDigests[moduleId] })), dependencyGraphDigest }
  const ready = parseGameIrReadyReceipt({ schemaVersion: 'game-ir-ready-receipt.v1', taskId: candidate.taskId,
    publicationId: authority.publicationId, gameIrSchemaVersion: 'game-ir.v1',
    foundationRevision: candidate.foundationRevision, foundationReceiptDigest: authority.request.foundation.receiptDigest,
    manifestDigest: digestBytes(bytes(manifest)), moduleDigests, sourceMapDigests, dependencyGraphDigest,
    committedPath: gameIrCommittedPath(candidate.foundationRevision) })
  return { candidate, modules, sourceMaps, graph, manifest, ready }
}

export async function validateDirectGameIrPublication(authority: DirectPublicationAuthority): Promise<Readonly<{
  ready: GameIrReadyReceipt; candidate: GameIrCandidate
}>> {
  const expected = artifacts(authority)
  const root = safePath(authority.workspacePath, gameIrRevisionPath(authority.request.foundation.foundationRevision))
  const committed = parseGameIrReadyReceipt(await readJson(join(root, 'COMMITTED.json')))
  if (canonicalGameIrJson(committed) !== canonicalGameIrJson(expected.ready)) throw new Error('Game IR committed receipt changed')
  const rawModules = []
  for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS) {
    const module = await readJson(join(root, 'modules', `${moduleId}.json`)) as Record<string, unknown>
    if (digestGameIrValue(module) !== committed.moduleDigests[moduleId]) throw new Error(`Game IR module changed: ${moduleId}`)
    const sourceMap = await readJson(join(root, 'source-maps', `${moduleId}.json`))
    if (digestGameIrValue(sourceMap) !== committed.sourceMapDigests[moduleId]) throw new Error(`Game IR source map changed: ${moduleId}`)
    rawModules.push({ moduleId: module.moduleId, nodes: module.nodes })
  }
  const graph = await readJson(join(root, 'dependency-graph.json'))
  const manifest = await readJson(join(root, 'manifest.json'))
  if (digestGameIrValue(graph) !== committed.dependencyGraphDigest || digestGameIrValue(manifest) !== committed.manifestDigest)
    throw new Error('Game IR publication metadata changed')
  const candidate = parseGameIrCandidate({ schemaVersion: 'game-ir.v1', taskId: committed.taskId,
    foundationRevision: committed.foundationRevision, modules: rawModules }, { request: authority.request, sections: authority.sections })
  if (canonicalGameIrJson(candidate) !== canonicalGameIrJson(expected.candidate)) throw new Error('Game IR published candidate changed')
  return Object.freeze({ ready: committed, candidate })
}

export async function commitDirectGameIrPublication(authority: DirectPublicationAuthority): Promise<GameIrReadyReceipt> {
  const built = artifacts(authority)
  const final = safePath(authority.workspacePath, gameIrRevisionPath(built.ready.foundationRevision))
  try { return (await validateDirectGameIrPublication(authority)).ready } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const staging = safePath(authority.workspacePath, `.beegame/.game-ir-private/direct-${authority.publicationId}-${randomUUID()}`)
  await mkdir(dirname(staging), { recursive: true })
  await mkdir(staging, { recursive: false })
  try {
    for (const moduleId of GAME_IR_CANONICAL_MODULE_IDS) {
      await write(join(staging, 'modules', `${moduleId}.json`), built.modules.get(moduleId))
      await write(join(staging, 'source-maps', `${moduleId}.json`), built.sourceMaps.get(moduleId))
    }
    await write(join(staging, 'dependency-graph.json'), built.graph)
    await write(join(staging, 'manifest.json'), built.manifest)
    await write(join(staging, 'COMMITTED.json'), built.ready)
    await mkdir(dirname(final), { recursive: true })
    await rename(staging, final)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' && (error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error
  }
  return (await validateDirectGameIrPublication(authority)).ready
}
