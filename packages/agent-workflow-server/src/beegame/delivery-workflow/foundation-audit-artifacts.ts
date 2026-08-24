import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
  type FoundationSectionIndex,
} from './foundation-section-index'
import { FOUNDATION_FACT_CATALOG_VERSION } from './foundation-fact-definitions'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentCheckpoint,
  type FoundationDocumentPath,
} from './types'
import type { FoundationAuditState } from './foundation-audit-state'
import { createFoundationFactStore, digestFactStore, type FoundationFactStore } from './foundation-fact-store'

export type FoundationAuditManifest = {
  revision: string
  status: 'index_staged'
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  sectionIndexDigest: string
  needsAction: 'foundation fact extraction is not part of Task 4A'
}

type FoundationDerivedManifest = {
  revision: string
  status: 'derived_committed'
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndexDigest: string
  factStoreDigest: string
  normalizedFactDigest: string
}

export type FoundationAuditArtifactPaths = {
  root: string
  sectionIndex: string
  manifest: string
}
export type DerivedFoundationAuditArtifacts = {
  revision: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndex: FoundationSectionIndex
  manifest: FoundationAuditManifest
  paths: FoundationAuditArtifactPaths
}

export type FoundationDerivedArtifactPaths = {
  root: string
  derived: string
  sectionIndex: string
  factStore: string
  manifest: string
  marker: string
}

export type FoundationFactReceiptFile = {
  taskId: string
  revision: string
  packetDigest: string
  terminalDigest: string
  normalizedFactDigest: string
  receipts: unknown[]
  usage: unknown
  durationMs: number
  facts?: unknown[]
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  return JSON.stringify(value)
}

export async function writeFoundationFactPacket(input: {
  workspacePath: string
  revision: string
  taskId: string
  packet: unknown
}): Promise<string> {
  const root = join(resolve(input.workspacePath), '.beegame', 'audit', 'foundation', input.revision, 'staging', 'packets')
  await mkdir(root, { recursive: true })
  const path = join(root, `${input.taskId}.json`)
  const content = `${JSON.stringify(input.packet, null, 2)}\n`
  try { await writeFile(path, content, { encoding: 'utf8', flag: 'wx' }) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    if ((await readFile(path, 'utf8')) !== content) throw new Error('conflicting foundation fact packet replay')
  }
  return `.beegame/audit/foundation/${input.revision}/staging/packets/${input.taskId}.json`
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function assertRevision(revision: string): void {
  if (
    !revision ||
    revision === '.' ||
    revision === '..' ||
    !/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(revision) ||
    revision.includes('/') ||
    revision.includes('\\')
  )
    throw new Error(
      'foundation audit revision must be a safe project-local identifier',
    )
}
function assertDescendant(base: string, candidate: string): void {
  const relativePath = relative(resolve(base), resolve(candidate))
  if (
    !relativePath ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith('/') ||
    relativePath.startsWith('\\')
  )
    throw new Error(
      'foundation audit artifact path escaped its project-local root',
    )
}
export function foundationAuditArtifactPaths(
  workspacePath: string,
  revision: string,
): FoundationAuditArtifactPaths {
  assertRevision(revision)
  const workspace = resolve(workspacePath)
  const base = join(workspace, '.beegame', 'audit', 'foundation')
  const root = join(base, revision, 'staging')
  assertDescendant(base, root)
  return {
    root,
    sectionIndex: join(root, 'section-index.json'),
    manifest: join(root, 'manifest.json'),
  }
}
export function relativeFoundationAuditArtifactPaths(
  revision: string,
): Omit<FoundationAuditArtifactPaths, 'root'> {
  assertRevision(revision)
  const root = `.beegame/audit/foundation/${revision}/staging`
  return {
    sectionIndex: `${root}/section-index.json`,
    manifest: `${root}/manifest.json`,
  }
}

export function foundationDerivedArtifactPaths(
  workspacePath: string,
  revision: string,
): FoundationDerivedArtifactPaths {
  assertRevision(revision)
  const root = resolve(workspacePath)
  const auditRoot = join(root, '.beegame', 'audit', 'foundation', revision)
  const derived = join(auditRoot, 'derived')
  return {
    root: auditRoot,
    derived,
    sectionIndex: join(derived, 'section-index.json'),
    factStore: join(derived, 'fact-store.json'),
    manifest: join(derived, 'manifest.json'),
    marker: join(derived, 'COMMITTED.json'),
  }
}

function stableDigest(value: unknown): string {
  return sha256(canonicalJson(value))
}

export async function loadFoundationFactReceipt(input: {
  workspacePath: string
  revision: string
  taskId: string
  expectedPacketDigest: string
  expectedTerminalDigest: string
  expectedReceiptPath: string
  expectedReceiptDigest: string
}): Promise<FoundationFactReceiptFile & { facts: FoundationFactStore; normalizedFactDigest: string }> {
  const expectedRelative = `.beegame/audit/foundation/${input.revision}/staging/receipts/${input.taskId}.json`
  if (input.expectedReceiptPath !== expectedRelative) throw new Error('foundation fact receipt path is not task-bound')
  if (input.expectedReceiptPath.includes('..') || input.expectedReceiptPath.startsWith('/')) throw new Error('foundation fact receipt path escaped staging')
  const absolute = resolve(input.workspacePath, input.expectedReceiptPath)
  const content = await readFile(absolute, 'utf8')
  if (sha256(content) !== input.expectedReceiptDigest) throw new Error('foundation fact receipt digest mismatch')
  const value = JSON.parse(content) as Record<string, unknown>
  const expectedKeys = ['taskId', 'revision', 'packetDigest', 'terminalDigest', 'normalizedFactDigest', 'receipts', 'facts', 'usage', 'durationMs']
  if (Object.keys(value).sort().join('|') !== expectedKeys.sort().join('|')) throw new Error('foundation fact receipt shape is invalid')
  const receiptUsage = value.usage
  if (!receiptUsage || typeof receiptUsage !== 'object' || Array.isArray(receiptUsage) || Object.keys(receiptUsage as object).sort().join('|') !== 'cache_creation_tokens|cache_read_tokens|completion_tokens|input_tokens|total_tokens' || Object.values(receiptUsage as Record<string, unknown>).some(item => typeof item !== 'number' || !Number.isFinite(item) || item < 0) || typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0 || !Array.isArray(value.receipts) || value.taskId !== input.taskId || value.revision !== input.revision || value.packetDigest !== input.expectedPacketDigest || value.terminalDigest !== input.expectedTerminalDigest || !Array.isArray(value.facts)) throw new Error('foundation fact receipt identity or usage is invalid')
  const facts = createFoundationFactStore(value.facts as never[])
  if (digestFactStore(facts) !== value.normalizedFactDigest) throw new Error('foundation fact receipt fact digest is invalid')
  return { ...(value as unknown as FoundationFactReceiptFile), facts, normalizedFactDigest: String(value.normalizedFactDigest) }
}

export async function writeFoundationFactReceipt(input: {
  workspacePath: string
  revision: string
  receipt: FoundationFactReceiptFile
}): Promise<{ path: string; digest: string }> {
  if (input.receipt.revision !== input.revision)
    throw new Error('foundation fact receipt revision mismatch')
  if (!/^[a-f0-9]{64}$/.test(input.receipt.packetDigest) || !/^[a-f0-9]{64}$/.test(input.receipt.terminalDigest))
    throw new Error('foundation fact receipt digest is invalid')
  const root = join(resolve(input.workspacePath), '.beegame', 'audit', 'foundation', input.revision, 'staging', 'receipts')
  await mkdir(root, { recursive: true })
  const path = join(root, `${input.receipt.taskId}.json`)
  const content = `${JSON.stringify(input.receipt, null, 2)}\n`
  const receiptDigest = sha256(content)
  try {
    await writeFile(path, content, { encoding: 'utf8', flag: 'wx' })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const existing = await readFile(path, 'utf8')
    if (sha256(existing) !== receiptDigest) throw new Error('conflicting foundation fact receipt replay')
  }
  return { path: `.beegame/audit/foundation/${input.revision}/staging/receipts/${input.receipt.taskId}.json`, digest: receiptDigest }
}

export async function publishFoundationDerivedArtifacts(input: {
  workspacePath: string
  revision: string
  documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]
  sectionIndex: FoundationSectionIndex
  factStore: FoundationFactStore
  normalizedFactDigest: string
  manifest: Record<string, unknown>
}): Promise<{ paths: FoundationDerivedArtifactPaths; documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>; digests: { factStore: string; manifest: string; marker: string; sectionIndex: string } }> {
  assertExactlyEightCommittedFoundationDocuments(CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, status: 'committed' as const })))
  if (input.documentDigests.length !== 8 || new Set(input.documentDigests.map(item => item.path)).size !== 8 || input.documentDigests.some(item => !CANONICAL_FOUNDATION_DOCUMENTS.includes(item.path)))
    throw new Error('derived foundation artifacts require exactly eight document digests')
  if (input.documentDigests.some(item => !/^[a-f0-9]{64}$/.test(item.digest))) throw new Error('derived foundation document digest is invalid')
  if (!/^[a-f0-9]{64}$/.test(input.normalizedFactDigest)) throw new Error('normalized fact digest is invalid')
  if (digestFactStore(input.factStore) !== input.normalizedFactDigest) throw new Error('normalized fact digest does not match the closed fact store')
  const paths = foundationDerivedArtifactPaths(input.workspacePath, input.revision)
  try {
    const existing = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: input.revision })
    if (existing) {
      if (!sameJson(existing.documentDigests, input.documentDigests) || existing.digests.factStore !== input.normalizedFactDigest || existing.digests.sectionIndex !== digestSectionIndex(input.sectionIndex))
        throw new Error('conflicting committed foundation derived artifact replay')
      return existing
    }
  } catch (error) {
    throw error
  }
  await mkdir(paths.root, { recursive: true })
  const temp = join(paths.root, `.derived-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`)
  await mkdir(temp, { recursive: true })
  const sectionValue = { revision: input.revision, documentDigests: input.documentDigests, sections: input.sectionIndex, digest: digestSectionIndex(input.sectionIndex) }
  const factValue = { revision: input.revision, facts: input.factStore, digest: input.normalizedFactDigest }
  const manifestValue: FoundationDerivedManifest = { revision: input.revision, status: 'derived_committed', documentDigests: input.documentDigests.map(item => ({ ...item })), sectionIndexDigest: sectionValue.digest, factStoreDigest: input.normalizedFactDigest, normalizedFactDigest: input.normalizedFactDigest }
  const files = [
    ['section-index.json', sectionValue],
    ['fact-store.json', factValue],
    ['manifest.json', manifestValue],
  ] as const
  for (const [name, value] of files) await writeFile(join(temp, name), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8' })
  const markerWithoutDigest = { revision: input.revision, status: 'committed', manifestDigest: stableDigest(manifestValue), sectionIndexDigest: sectionValue.digest, factStoreDigest: input.normalizedFactDigest }
  await writeFile(join(temp, 'COMMITTED.json'), `${JSON.stringify(markerWithoutDigest, null, 2)}\n`, { encoding: 'utf8' })
  // Validate the complete temporary tree before it can become the authority.
  await loadFoundationDerivedDirectory({
    revision: input.revision,
    paths: foundationDerivedArtifactPathsForDirectory(paths.root, temp),
  })
  try {
    await rename(temp, paths.derived)
  } catch (error) {
    try {
      const existing = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: input.revision })
      if (!existing || !sameJson(existing.documentDigests, input.documentDigests) || existing.digests.factStore !== input.normalizedFactDigest || existing.digests.sectionIndex !== digestSectionIndex(input.sectionIndex)) throw error
    } catch { throw error }
  }
  const loaded = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: input.revision })
  if (!loaded) throw new Error('derived foundation artifacts were not committed')
  return loaded
}

export async function loadCommittedFoundationDerivedArtifacts(input: { workspacePath: string; revision: string }): Promise<{ paths: FoundationDerivedArtifactPaths; documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>; digests: { factStore: string; manifest: string; marker: string; sectionIndex: string } } | undefined> {
  const paths = foundationDerivedArtifactPaths(input.workspacePath, input.revision)
  return loadFoundationDerivedDirectory({ revision: input.revision, paths })
}

function foundationDerivedArtifactPathsForDirectory(auditRoot: string, derived: string): FoundationDerivedArtifactPaths {
  return {
    root: auditRoot,
    derived,
    sectionIndex: join(derived, 'section-index.json'),
    factStore: join(derived, 'fact-store.json'),
    manifest: join(derived, 'manifest.json'),
    marker: join(derived, 'COMMITTED.json'),
  }
}

async function loadFoundationDerivedDirectory(input: { revision: string; paths: FoundationDerivedArtifactPaths }): Promise<{ paths: FoundationDerivedArtifactPaths; documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>; digests: { factStore: string; manifest: string; marker: string; sectionIndex: string } } | undefined> {
  const paths = input.paths
  let marker: Record<string, unknown>
  try { marker = JSON.parse(await readFile(paths.marker, 'utf8')) as Record<string, unknown> } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('committed foundation derived marker is malformed')
  }
  const [sectionText, factText, manifestText] = await Promise.all([readFile(paths.sectionIndex, 'utf8'), readFile(paths.factStore, 'utf8'), readFile(paths.manifest, 'utf8')])
  const section = JSON.parse(sectionText) as Record<string, unknown>
  const fact = JSON.parse(factText) as Record<string, unknown>
  const manifest = JSON.parse(manifestText) as Record<string, unknown>
  const documentDigests = Array.isArray(section.documentDigests) ? section.documentDigests as Array<Record<string, unknown>> : []
  const sectionRefs = Array.isArray(section.sections) ? section.sections as Array<Record<string, unknown>> : []
  const sectionRefsValid = sectionRefs.every(item =>
    exactKeys(item, ['documentPath', 'sectionId', 'heading', 'startLine', 'endLine', 'digest']) &&
    typeof item.documentPath === 'string' && CANONICAL_FOUNDATION_DOCUMENTS.includes(item.documentPath as FoundationDocumentPath) &&
    typeof item.sectionId === 'string' && item.sectionId.length > 0 &&
    typeof item.heading === 'string' && item.heading.length > 0 &&
    typeof item.startLine === 'number' && Number.isInteger(item.startLine) && item.startLine > 0 &&
    typeof item.endLine === 'number' && Number.isInteger(item.endLine) && item.endLine >= item.startLine &&
    isDigest(item.digest),
  )
  const manifestDocumentDigests = Array.isArray(manifest.documentDigests) ? manifest.documentDigests as Array<Record<string, unknown>> : []
  if (marker.revision !== input.revision || marker.status !== 'committed' || !exactKeys(marker, ['revision', 'status', 'manifestDigest', 'sectionIndexDigest', 'factStoreDigest']) || section.revision !== input.revision || !exactKeys(section, ['revision', 'documentDigests', 'sections', 'digest']) || fact.revision !== input.revision || !exactKeys(fact, ['revision', 'facts', 'digest']) || !exactKeys(manifest, ['revision', 'status', 'documentDigests', 'sectionIndexDigest', 'factStoreDigest', 'normalizedFactDigest']) || manifest.status !== 'derived_committed' || stableDigest(manifest) !== marker.manifestDigest || section.digest !== marker.sectionIndexDigest || fact.digest !== marker.factStoreDigest || documentDigests.length !== 8 || documentDigests.some(item => typeof item.path !== 'string' || !CANONICAL_FOUNDATION_DOCUMENTS.includes(item.path as FoundationDocumentPath) || typeof item.digest !== 'string' || !isDigest(item.digest)) || new Set(documentDigests.map(item => item.path)).size !== 8 || !Array.isArray(fact.facts) || !sectionRefsValid || !sectionRefs.length || !sameJson(manifestDocumentDigests, documentDigests) || !sameJson(manifest.sectionIndexDigest, section.digest) || !sameJson(manifest.factStoreDigest, fact.digest) || manifest.normalizedFactDigest !== manifest.factStoreDigest || !isDigest(manifest.normalizedFactDigest)) throw new Error('committed foundation derived artifact binding is invalid')
  if (digestSectionIndex(sectionRefs as never) !== section.digest) throw new Error('committed foundation section index digest is invalid')
  const closedFactStore = createFoundationFactStore(fact.facts as never[])
  if (digestFactStore(closedFactStore) !== fact.digest) throw new Error('committed foundation fact store digest is invalid')
  return { paths, documentDigests: documentDigests as Array<{ path: FoundationDocumentPath; digest: string }>, digests: { sectionIndex: String(section.digest), factStore: String(fact.digest), manifest: String(marker.manifestDigest), marker: stableDigest(marker) } }
}
export function assertExactlyEightCommittedFoundationDocuments(
  checkpoints: readonly Pick<FoundationDocumentCheckpoint, 'path' | 'status'>[],
): void {
  const expected = [...CANONICAL_FOUNDATION_DOCUMENTS]
  if (
    checkpoints.length !== expected.length ||
    checkpoints.some(
      (checkpoint, index) =>
        checkpoint.path !== expected[index] ||
        checkpoint.status !== 'committed',
    )
  )
    throw new Error(
      'exactly eight committed foundation documents are required before audit derivation',
    )
}
function checkpointList(input: {
  checkpoints?: readonly Pick<FoundationDocumentCheckpoint, 'path' | 'status'>[]
}): void {
  if (!input.checkpoints)
    throw new Error(
      'durable committed foundation checkpoints are required before audit derivation',
    )
  assertExactlyEightCommittedFoundationDocuments(input.checkpoints)
}
async function readDocuments(input: {
  workspace: string
  documents?:
    | ReadonlyMap<FoundationDocumentPath, string>
    | Record<string, string>
}): Promise<Map<FoundationDocumentPath, string>> {
  const documents = new Map<FoundationDocumentPath, string>()
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    let supplied: string | undefined
    if (input.documents instanceof Map) supplied = input.documents.get(path)
    else if (input.documents)
      supplied = (input.documents as Record<string, string>)[path]
    const content =
      supplied ??
      (await readFile(join(input.workspace, path), 'utf8').catch(() => {
        throw new Error(`committed foundation document is missing: ${path}`)
      }))
    if (typeof content !== 'string')
      throw new Error(
        `committed foundation document content is invalid: ${path}`,
      )
    documents.set(path, content)
  }
  return documents
}
function documentDigests(
  documents: ReadonlyMap<FoundationDocumentPath, string>,
): Array<{ path: FoundationDocumentPath; digest: string }> {
  return CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path,
    digest: sha256(documents.get(path)!),
  }))
}
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
function exactKeys(value: object, keys: readonly string[]): boolean {
  return sameJson(Object.keys(value).sort(), [...keys].sort())
}
function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
async function readArtifact(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`foundation audit artifact is malformed: ${path}`)
  }
}
async function loadExistingFoundationAuditArtifacts(input: {
  workspace: string
  revision: string
  documents: ReadonlyMap<FoundationDocumentPath, string>
  expectedState?: FoundationAuditState
}): Promise<DerivedFoundationAuditArtifacts | undefined> {
  const paths = foundationAuditArtifactPaths(input.workspace, input.revision)
  let rootExists = false
  try {
    rootExists = (await stat(paths.root)).isDirectory()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('foundation audit artifact directory is unreadable')
  }
  const [sectionRaw, manifestRaw] = await Promise.all([
    readArtifact(paths.sectionIndex),
    readArtifact(paths.manifest),
  ])
  const present = [sectionRaw, manifestRaw].filter(
    value => value !== undefined,
  ).length
  if (present === 0) {
    if (rootExists || input.expectedState)
      throw new Error('foundation audit artifact set is missing and immutable')
    return undefined
  }
  if (present !== 2)
    throw new Error('foundation audit artifact set is partial and immutable')
  if (
    !sectionRaw ||
    !manifestRaw ||
    typeof sectionRaw !== 'object' ||
    typeof manifestRaw !== 'object' ||
    !exactKeys(sectionRaw, [
      'revision',
      'documentDigests',
      'sections',
      'digest',
    ]) ||
    !exactKeys(manifestRaw, [
      'revision',
      'status',
      'catalogVersion',
      'sectionIndexDigest',
      'needsAction',
    ])
  )
    throw new Error('foundation audit artifact set is malformed and immutable')
  const sectionObject = sectionRaw as Record<string, unknown>
  const manifestObject = manifestRaw as Record<string, unknown>
  const expectedDocuments = documentDigests(input.documents)
  if (
    sectionObject.revision !== input.revision ||
    manifestObject.revision !== input.revision ||
    !isDigest(sectionObject.digest) ||
    manifestObject.status !== 'index_staged' ||
    manifestObject.catalogVersion !== FOUNDATION_FACT_CATALOG_VERSION ||
    manifestObject.needsAction !==
      'foundation fact extraction is not part of Task 4A' ||
    manifestObject.sectionIndexDigest !== sectionObject.digest ||
    !sameJson(sectionObject.documentDigests, expectedDocuments) ||
    !Array.isArray(sectionObject.sections)
  )
    throw new Error('foundation audit artifact revision or digest is invalid')
  const sectionIndex = buildFoundationSectionIndex({
    documents: input.documents,
  })
  const sectionDigest = digestSectionIndex(sectionIndex)
  if (
    sectionObject.digest !== sectionDigest ||
    !sameJson(sectionObject.sections, sectionIndex)
  )
    throw new Error(
      'foundation audit section index bytes do not match current documents',
    )
  const manifest: FoundationAuditManifest = {
    revision: input.revision,
    status: 'index_staged',
    catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
    sectionIndexDigest: sectionDigest,
    needsAction: 'foundation fact extraction is not part of Task 4A',
  }
  if (
    input.expectedState &&
    (!sameJson(
      input.expectedState.documentDigests,
      Object.fromEntries(
        expectedDocuments.map(item => [item.path, item.digest]),
      ),
    ) ||
      !['index_staged', 'extracting_facts', 'facts_staged'].includes(input.expectedState.status) ||
      input.expectedState.sectionIndexDigest !== sectionDigest ||
      input.expectedState.sectionIndexPath !==
        relativeFoundationAuditArtifactPaths(input.revision).sectionIndex ||
      input.expectedState.manifestPath !==
        relativeFoundationAuditArtifactPaths(input.revision).manifest)
  )
    throw new Error('foundation audit state does not match staged index bytes')
  return {
    revision: input.revision,
    documentDigests: expectedDocuments,
    sectionIndex,
    manifest,
    paths,
  }
}
export async function loadFoundationAuditArtifacts(input: {
  workspacePath: string
  revision: string
  documents?:
    | ReadonlyMap<FoundationDocumentPath, string>
    | Record<string, string>
  expectedState?: FoundationAuditState
}): Promise<DerivedFoundationAuditArtifacts | undefined> {
  assertRevision(input.revision)
  const workspace = resolve(input.workspacePath)
  const documents = await readDocuments({
    workspace,
    documents: input.documents,
  })
  return loadExistingFoundationAuditArtifacts({
    workspace,
    revision: input.revision,
    documents,
    expectedState: input.expectedState,
  })
}
export async function validateFoundationAuditStateArtifacts(input: {
  workspacePath: string
  state: FoundationAuditState
}): Promise<DerivedFoundationAuditArtifacts> {
  if (input.state.status === 'derived_committed') {
    const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: input.state.revision })
    const derivedRoot = `.beegame/audit/foundation/${input.state.revision}/derived`
    const expectedDocumentDigests = Object.fromEntries(committed?.documentDigests.map(item => [item.path, item.digest]) ?? [])
    if (!committed || !input.state.derived || !sameJson(input.state.documentDigests, expectedDocumentDigests) || input.state.derived.manifestPath !== `${derivedRoot}/manifest.json` || input.state.derived.markerPath !== `${derivedRoot}/COMMITTED.json` || input.state.derived.factStorePath !== `${derivedRoot}/fact-store.json` || input.state.derived.sectionIndexPath !== `${derivedRoot}/section-index.json` || committed.digests.manifest !== input.state.derived.manifestDigest || committed.digests.marker !== input.state.derived.markerDigest || committed.digests.factStore !== input.state.derived.factStoreDigest || committed.digests.sectionIndex !== input.state.derived.sectionIndexDigest)
      throw new Error('foundation derived commit does not match state bindings')
    const staged = await loadFoundationAuditArtifacts({ workspacePath: input.workspacePath, revision: input.state.revision })
    if (!staged) throw new Error('foundation audit staged index is missing')
    return staged
  }
  const loaded = await loadFoundationAuditArtifacts({
    workspacePath: input.workspacePath,
    revision: input.state.revision,
    expectedState: input.state,
  })
  if (!loaded)
    throw new Error('foundation audit state refers to missing staged index')
  return loaded
}
async function durableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
  })
}
export async function deriveFoundationAuditArtifacts(input: {
  workspacePath: string
  revision: string
  checkpoints?: readonly Pick<FoundationDocumentCheckpoint, 'path' | 'status'>[]
  documents?:
    | ReadonlyMap<FoundationDocumentPath, string>
    | Record<string, string>
}): Promise<DerivedFoundationAuditArtifacts> {
  checkpointList(input)
  assertRevision(input.revision)
  const workspace = resolve(input.workspacePath)
  const documents = await readDocuments({
    workspace,
    documents: input.documents,
  })
  const existing = await loadExistingFoundationAuditArtifacts({
    workspace,
    revision: input.revision,
    documents,
  })
  if (existing) return existing
  const documentDigestsValue = documentDigests(documents)
  const paths = foundationAuditArtifactPaths(workspace, input.revision)
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const manifest: FoundationAuditManifest = {
    revision: input.revision,
    status: 'index_staged',
    catalogVersion: FOUNDATION_FACT_CATALOG_VERSION,
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    needsAction: 'foundation fact extraction is not part of Task 4A',
  }
  await durableJson(paths.sectionIndex, {
    revision: input.revision,
    documentDigests: documentDigestsValue,
    sections: sectionIndex,
    digest: manifest.sectionIndexDigest,
  })
  await durableJson(paths.manifest, manifest)
  const loaded = await loadExistingFoundationAuditArtifacts({
    workspace,
    revision: input.revision,
    documents,
  })
  if (!loaded) throw new Error('foundation audit index was not staged')
  return loaded
}
export function artifactPathsRelativeToWorkspace(
  workspacePath: string,
  paths: FoundationAuditArtifactPaths,
): Omit<FoundationAuditArtifactPaths, 'root'> {
  const root = resolve(workspacePath)
  return {
    sectionIndex: relative(root, paths.sectionIndex).replaceAll('\\', '/'),
    manifest: relative(root, paths.manifest).replaceAll('\\', '/'),
  }
}
