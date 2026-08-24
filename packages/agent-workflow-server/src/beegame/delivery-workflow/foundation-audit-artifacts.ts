import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, rename, readdir } from 'node:fs/promises'
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
import type { AuditIssue } from './foundation-issue-registry'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
} from './foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, type FoundationSemanticManifest } from './foundation-semantic-audit'

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

export type FoundationDeterministicReviewArtifactPaths = {
  root: string
  review: string
  issueRegistry: string
  manifest: string
  marker: string
}

export type FoundationDeterministicReview = {
  revision: string
  reviewDigest: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndexDigest: string
  factStoreDigest: string
  manifestDigest: string
  catalogVersion: string
  contractGraphDigest: string
  issues: AuditIssue[]
  paths: FoundationDeterministicReviewArtifactPaths
  digests: { issueRegistry: string; manifest: string; marker: string }
}

export type FoundationFinalReview = {
  revision: string
  reviewDigest: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndexDigest: string
  factStoreDigest: string
  deterministicReviewDigest: string
  semanticManifestDigest: string
  issues: AuditIssue[]
  paths: FoundationDeterministicReviewArtifactPaths
  digests: { issueRegistry: string; manifest: string; marker: string }
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
}): Promise<LoadedCommittedFoundationDerivedArtifacts> {
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

export async function loadCommittedFoundationDerivedArtifacts(input: { workspacePath: string; revision: string }): Promise<LoadedCommittedFoundationDerivedArtifacts | undefined> {
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

type LoadedCommittedFoundationDerivedArtifacts = {
  paths: FoundationDerivedArtifactPaths
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndex: FoundationSectionIndex
  factStore: FoundationFactStore
  digests: { factStore: string; manifest: string; marker: string; sectionIndex: string }
}

async function loadFoundationDerivedDirectory(input: { revision: string; paths: FoundationDerivedArtifactPaths }): Promise<LoadedCommittedFoundationDerivedArtifacts | undefined> {
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
  return {
    paths,
    documentDigests: documentDigests as Array<{ path: FoundationDocumentPath; digest: string }>,
    sectionIndex: sectionRefs as FoundationSectionIndex,
    factStore: closedFactStore,
    digests: { sectionIndex: String(section.digest), factStore: String(fact.digest), manifest: String(marker.manifestDigest), marker: stableDigest(marker) },
  }
}

export function foundationDeterministicReviewArtifactPaths(
  workspacePath: string,
  revision: string,
  reviewDigest: string,
): FoundationDeterministicReviewArtifactPaths {
  assertRevision(revision)
  if (!/^[a-f0-9]{64}$/.test(reviewDigest))
    throw new Error('deterministic review digest is invalid')
  const root = join(
    resolve(workspacePath),
    '.beegame',
    'audit',
    'foundation',
    revision,
    'staging',
    'review',
  )
  const review = join(root, reviewDigest)
  return {
    root,
    review,
    issueRegistry: join(review, 'issue-registry.json'),
    manifest: join(review, 'manifest.json'),
    marker: join(review, 'COMMITTED.json'),
  }
}

function deterministicReviewDigest(input: {
  revision: string
  documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]
  sectionIndexDigest: string
  factStoreDigest: string
  manifestDigest: string
  catalogVersion: string
  contractGraphDigest: string
  issues: readonly AuditIssue[]
}): string {
  return stableDigest({
    revision: input.revision,
    documentDigests: input.documentDigests,
    sectionIndexDigest: input.sectionIndexDigest,
    factStoreDigest: input.factStoreDigest,
    manifestDigest: input.manifestDigest,
    catalogVersion: input.catalogVersion,
    contractGraphDigest: input.contractGraphDigest,
    issues: input.issues,
  })
}

function canonicalDocumentDigests(
  value: Record<string, string> | readonly { path: FoundationDocumentPath; digest: string }[],
): Array<{ path: FoundationDocumentPath; digest: string }> {
  const entries = Array.isArray(value)
    ? value.map(item => ({ path: item.path, digest: item.digest }))
    : Object.entries(value).map(([path, digest]) => ({ path: path as FoundationDocumentPath, digest }))
  const result = entries.sort((left, right) => left.path.localeCompare(right.path))
  if (
    result.length !== CANONICAL_FOUNDATION_DOCUMENTS.length ||
    new Set(result.map(item => item.path)).size !== result.length ||
    result.some(item => !CANONICAL_FOUNDATION_DOCUMENTS.includes(item.path)) ||
    result.some(item => !isDigest(item.digest))
  )
    throw new Error('deterministic review requires exactly eight document digests')
  return result
}

function validateIssueIdentity(issues: readonly AuditIssue[]): void {
  const ids = new Set<string>()
  for (const issue of issues) {
    if (!issue.id || ids.has(issue.id))
      throw new Error('duplicate deterministic issue identity')
    ids.add(issue.id)
  }
}

export async function publishDeterministicFoundationReview(input: {
  workspacePath: string
  revision: string
  documentDigests: Record<string, string> | readonly { path: FoundationDocumentPath; digest: string }[]
  sectionIndex: FoundationSectionIndex
  factStore: FoundationFactStore
  issues: readonly AuditIssue[]
}): Promise<FoundationDeterministicReview> {
  if (Object.keys(input).some(key => !['workspacePath', 'revision', 'documentDigests', 'sectionIndex', 'factStore', 'issues'].includes(key)))
    throw new Error('caller-supplied deterministic manifest is not accepted')
  const manifest = FOUNDATION_AUDIT_PRODUCTION_MANIFEST
  const documentDigests = canonicalDocumentDigests(input.documentDigests)
  validateIssueIdentity(input.issues)
  if (input.issues.some(issue => issue.type === 'semantic'))
    throw new Error('deterministic review prefix cannot contain semantic issues')
  const sectionIndexDigest = digestSectionIndex(input.sectionIndex)
  const factStoreDigest = digestFactStore(input.factStore)
  if (manifest.catalogVersion !== FOUNDATION_FACT_CATALOG_VERSION)
    throw new Error('deterministic review catalog version is stale')
  const reviewDigest = deterministicReviewDigest({
    revision: input.revision,
    documentDigests,
    sectionIndexDigest,
    factStoreDigest,
    manifestDigest: manifest.digest,
    catalogVersion: manifest.catalogVersion,
    contractGraphDigest: manifest.contractGraphDigest,
    issues: input.issues,
  })
  const paths = foundationDeterministicReviewArtifactPaths(
    input.workspacePath,
    input.revision,
    reviewDigest,
  )
  // A revision has one deterministic prefix. If a different binding already
  // exists under the same staging root, it is stale rather than a new run.
  try {
    const entries = await readdir(paths.root, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === reviewDigest) continue
      try {
        const marker = JSON.parse(await readFile(join(paths.root, entry.name, 'COMMITTED.json'), 'utf8')) as Record<string, unknown>
        if (marker.revision === input.revision)
          throw new Error('stale deterministic review replay')
      } catch (error) {
        if (error instanceof Error && error.message === 'stale deterministic review replay') throw error
      }
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const existing = await loadDeterministicFoundationReview({
    workspacePath: input.workspacePath,
    revision: input.revision,
    reviewDigest,
  })
  if (existing) {
    if (
      existing.factStoreDigest !== factStoreDigest ||
      existing.sectionIndexDigest !== sectionIndexDigest
    )
      throw new Error('stale deterministic review replay')
    return existing
  }
  await mkdir(paths.root, { recursive: true })
  const temporaryReview = join(paths.root, `.${reviewDigest}.${process.pid}.tmp`)
  await mkdir(temporaryReview, { recursive: true })
  const temporaryPaths = {
    issueRegistry: join(temporaryReview, 'issue-registry.json'),
    manifest: join(temporaryReview, 'manifest.json'),
    marker: join(temporaryReview, 'COMMITTED.json'),
  }
  const issueValue = {
    revision: input.revision,
    status: 'deterministic_prefix' as const,
    reviewDigest,
    documentDigests,
    sectionIndexDigest,
    factStoreDigest,
    manifestDigest: manifest.digest,
    catalogVersion: manifest.catalogVersion,
    contractGraphDigest: manifest.contractGraphDigest,
    issues: input.issues,
  }
  const manifestValue = {
    revision: input.revision,
    status: 'deterministic_ready' as const,
    reviewDigest,
    manifest,
  }
  const issueText = `${JSON.stringify(issueValue, null, 2)}\n`
  const manifestText = `${JSON.stringify(manifestValue, null, 2)}\n`
  const issueRegistryDigest = sha256(issueText)
  const manifestDigest = sha256(manifestText)
  await writeFile(temporaryPaths.issueRegistry, issueText, { encoding: 'utf8' })
  await writeFile(temporaryPaths.manifest, manifestText, { encoding: 'utf8' })
  const marker = {
    revision: input.revision,
    status: 'committed' as const,
    reviewDigest,
    issueRegistryDigest,
    manifestDigest,
    sectionIndexDigest,
    factStoreDigest,
  }
  const markerText = `${JSON.stringify(marker, null, 2)}\n`
  await writeFile(temporaryPaths.marker, markerText, { encoding: 'utf8' })
  await validateDeterministicReviewFiles({
    paths: {
      ...paths,
      issueRegistry: temporaryPaths.issueRegistry,
      manifest: temporaryPaths.manifest,
      marker: temporaryPaths.marker,
    },
    revision: input.revision,
    reviewDigest,
  })
  try {
    await rename(temporaryReview, paths.review)
  } catch (error) {
    const replay = await loadDeterministicFoundationReview({
      workspacePath: input.workspacePath,
      revision: input.revision,
      reviewDigest,
    }).catch(() => undefined)
    if (!replay) throw error
    return replay
  }
  return {
    revision: input.revision,
    reviewDigest,
    documentDigests,
    sectionIndexDigest,
    factStoreDigest,
    manifestDigest: manifest.digest,
    catalogVersion: manifest.catalogVersion,
    contractGraphDigest: manifest.contractGraphDigest,
    issues: [...input.issues],
    paths,
    digests: {
      issueRegistry: issueRegistryDigest,
      manifest: manifestDigest,
      marker: stableDigest(marker),
    },
  }
}

function validateReviewSection(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exactKeys(value, ['documentPath', 'sectionId', 'heading', 'startLine', 'endLine', 'digest']))
    throw new Error(`deterministic review ${label} SectionRef is invalid`)
  const section = value as Record<string, unknown>
  if (
    typeof section.documentPath !== 'string' ||
    !CANONICAL_FOUNDATION_DOCUMENTS.includes(section.documentPath as FoundationDocumentPath) ||
    typeof section.sectionId !== 'string' ||
    !/^[a-z0-9._-]+$/.test(section.sectionId) ||
    typeof section.heading !== 'string' ||
    !section.heading.trim() ||
    typeof section.startLine !== 'number' ||
    !Number.isInteger(section.startLine) ||
    section.startLine < 1 ||
    typeof section.endLine !== 'number' ||
    !Number.isInteger(section.endLine) ||
    section.endLine < section.startLine ||
    !isDigest(section.digest)
  )
    throw new Error(`deterministic review ${label} SectionRef is invalid`)
}

function validateReviewIssue(value: unknown, index: number, allowSemantic = false): void {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`deterministic review issue ${index} is invalid`)
  const issue = value as Record<string, unknown>
  const allowed = ['id', 'severity', 'type', 'source', 'target', 'expected', 'actual', 'fixDocument', 'fixSectionId', 'reasonCode']
  const required = ['id', 'severity', 'type', 'source', 'expected', 'actual', 'fixDocument', 'fixSectionId']
  if (!exactKeys(issue, required.concat(issue.target !== undefined ? ['target'] : []).concat(issue.reasonCode !== undefined ? ['reasonCode'] : allowed.filter(() => false))))
    throw new Error(`deterministic review issue ${index} has unknown or missing fields`)
  if (typeof issue.id !== 'string' || !/^AUD-[A-F0-9]{24}$/.test(issue.id))
    throw new Error(`deterministic review issue ${index} identity is invalid`)
  if (!['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(String(issue.severity)) || !['schema', 'rule', 'contract', 'semantic'].includes(String(issue.type)))
    throw new Error(`deterministic review issue ${index} classification is invalid`)
  if (issue.type === 'semantic' && !allowSemantic)
    throw new Error('deterministic review prefix cannot contain semantic issues')
  if (typeof issue.expected !== 'string' || !issue.expected.trim() || typeof issue.actual !== 'string' || !issue.actual.trim())
    throw new Error(`deterministic review issue ${index} text is invalid`)
  validateReviewSection(issue.source, `issue ${index} source`)
  if (issue.target !== undefined) validateReviewSection(issue.target, `issue ${index} target`)
  if (typeof issue.fixDocument !== 'string' || !CANONICAL_FOUNDATION_DOCUMENTS.includes(issue.fixDocument as FoundationDocumentPath) || typeof issue.fixSectionId !== 'string' || !/^[a-z0-9._-]+$/.test(issue.fixSectionId))
    throw new Error(`deterministic review issue ${index} fix target is invalid`)
  if (issue.reasonCode !== undefined && (typeof issue.reasonCode !== 'string' || !issue.reasonCode.trim()))
    throw new Error(`deterministic review issue ${index} reason code is invalid`)
}

async function validateDeterministicReviewFiles(input: {
  paths: FoundationDeterministicReviewArtifactPaths
  revision: string
  reviewDigest: string
}): Promise<void> {
  const marker = JSON.parse(await readFile(input.paths.marker, 'utf8')) as unknown
  const issueText = await readFile(input.paths.issueRegistry, 'utf8')
  const manifestText = await readFile(input.paths.manifest, 'utf8')
  const issueValue = JSON.parse(issueText) as unknown
  const manifestValue = JSON.parse(manifestText) as unknown
  if (!marker || typeof marker !== 'object' || Array.isArray(marker) || !exactKeys(marker, ['revision', 'status', 'reviewDigest', 'issueRegistryDigest', 'manifestDigest', 'sectionIndexDigest', 'factStoreDigest']))
    throw new Error('deterministic review marker shape is invalid')
  const markerObject = marker as Record<string, unknown>
  if (markerObject.revision !== input.revision || markerObject.status !== 'committed' || markerObject.reviewDigest !== input.reviewDigest || !isDigest(markerObject.issueRegistryDigest) || !isDigest(markerObject.manifestDigest) || !isDigest(markerObject.sectionIndexDigest) || !isDigest(markerObject.factStoreDigest) || sha256(issueText) !== markerObject.issueRegistryDigest || sha256(manifestText) !== markerObject.manifestDigest)
    throw new Error('deterministic review marker binding is invalid')
  if (!issueValue || typeof issueValue !== 'object' || Array.isArray(issueValue) || !exactKeys(issueValue, ['revision', 'status', 'reviewDigest', 'documentDigests', 'sectionIndexDigest', 'factStoreDigest', 'manifestDigest', 'catalogVersion', 'contractGraphDigest', 'issues']))
    throw new Error('deterministic review registry shape is invalid')
  const issueObject = issueValue as Record<string, unknown>
  if (issueObject.revision !== input.revision || issueObject.status !== 'deterministic_prefix' || issueObject.reviewDigest !== input.reviewDigest || !Array.isArray(issueObject.documentDigests) || !isDigest(issueObject.sectionIndexDigest) || !isDigest(issueObject.factStoreDigest) || issueObject.manifestDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest || issueObject.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion || issueObject.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest || !Array.isArray(issueObject.issues))
    throw new Error('deterministic review registry binding is invalid')
  canonicalDocumentDigests(issueObject.documentDigests as never)
  ;(issueObject.issues as unknown[]).forEach((value, index) => validateReviewIssue(value, index))
  validateIssueIdentity(issueObject.issues as AuditIssue[])
  if (!manifestValue || typeof manifestValue !== 'object' || Array.isArray(manifestValue) || !exactKeys(manifestValue, ['revision', 'status', 'reviewDigest', 'manifest']))
    throw new Error('deterministic review manifest shape is invalid')
  const manifestObject = manifestValue as Record<string, unknown>
  const production = manifestObject.manifest
  if (!production || typeof production !== 'object' || Array.isArray(production) || !exactKeys(production, ['version', 'catalogVersion', 'schemaKeys', 'contracts', 'deferredSemanticKeys', 'digest', 'contractGraphDigest']))
    throw new Error('deterministic production manifest shape is invalid')
  const productionObject = production as Record<string, unknown>
  if (manifestObject.revision !== input.revision || manifestObject.status !== 'deterministic_ready' || manifestObject.reviewDigest !== input.reviewDigest || typeof productionObject.version !== 'string' || typeof productionObject.catalogVersion !== 'string' || !Array.isArray(productionObject.schemaKeys) || !Array.isArray(productionObject.contracts) || !Array.isArray(productionObject.deferredSemanticKeys) || !isDigest(productionObject.digest) || !isDigest(productionObject.contractGraphDigest))
    throw new Error('deterministic production manifest binding is invalid')
  if (
    productionObject.schemaKeys.some(item => typeof item !== 'string') ||
    productionObject.contracts.some(item => !item || typeof item !== 'object' || Array.isArray(item) || !exactKeys(item, ['id', 'sourceFactKey', 'targetFactKey', 'relation', 'source', 'target', 'severity']))
  )
    throw new Error('deterministic production manifest declarations are invalid')
  const { digest: _embeddedDigest, ...embeddedWithoutDigest } = productionObject
  const { digest: _authorityDigest, ...authorityWithoutDigest } = FOUNDATION_AUDIT_PRODUCTION_MANIFEST
  if (
    stableDigest(embeddedWithoutDigest) !== stableDigest(authorityWithoutDigest) ||
    productionObject.digest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest ||
    productionObject.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
    productionObject.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest
  )
    throw new Error('deterministic production manifest is not the service-owned authority')
}

export async function loadDeterministicFoundationReview(input: {
  workspacePath: string
  revision: string
  reviewDigest: string
}): Promise<FoundationDeterministicReview | undefined> {
  const paths = foundationDeterministicReviewArtifactPaths(
    input.workspacePath,
    input.revision,
    input.reviewDigest,
  )
  try {
    await validateDeterministicReviewFiles({ paths, revision: input.revision, reviewDigest: input.reviewDigest })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
  let marker: Record<string, unknown>
  try {
    marker = JSON.parse(await readFile(paths.marker, 'utf8')) as Record<string, unknown>
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error('deterministic review marker is malformed')
  }
  const [issueText, manifestText] = await Promise.all([
    readFile(paths.issueRegistry, 'utf8'),
    readFile(paths.manifest, 'utf8'),
  ])
  if (
    marker.revision !== input.revision ||
    marker.status !== 'committed' ||
    marker.reviewDigest !== input.reviewDigest ||
    sha256(issueText) !== marker.issueRegistryDigest ||
    sha256(manifestText) !== marker.manifestDigest
  )
    throw new Error('deterministic review binding is invalid')
  const issueValue = JSON.parse(issueText) as Record<string, unknown>
  const manifestValue = JSON.parse(manifestText) as Record<string, unknown>
  if (
    issueValue.revision !== input.revision ||
    issueValue.reviewDigest !== input.reviewDigest ||
    issueValue.status !== 'deterministic_prefix' ||
    manifestValue.revision !== input.revision ||
    manifestValue.reviewDigest !== input.reviewDigest ||
    !Array.isArray(issueValue.issues) ||
    !Array.isArray(issueValue.documentDigests) ||
    typeof issueValue.sectionIndexDigest !== 'string' ||
    typeof issueValue.factStoreDigest !== 'string' ||
    typeof issueValue.manifestDigest !== 'string' ||
    typeof issueValue.catalogVersion !== 'string' ||
    typeof issueValue.contractGraphDigest !== 'string'
  )
    throw new Error('deterministic review shape is invalid')
  validateIssueIdentity(issueValue.issues as AuditIssue[])
  const documentDigests = canonicalDocumentDigests(issueValue.documentDigests as never)
  if (
    deterministicReviewDigest({
      revision: input.revision,
      documentDigests,
      sectionIndexDigest: String(issueValue.sectionIndexDigest),
      factStoreDigest: String(issueValue.factStoreDigest),
      manifestDigest: String(issueValue.manifestDigest),
      catalogVersion: String(issueValue.catalogVersion),
      contractGraphDigest: String(issueValue.contractGraphDigest),
      issues: issueValue.issues as AuditIssue[],
    }) !== input.reviewDigest ||
    marker.sectionIndexDigest !== issueValue.sectionIndexDigest ||
    marker.factStoreDigest !== issueValue.factStoreDigest
  )
    throw new Error('deterministic review digest binding is invalid')
  return {
    revision: input.revision,
    reviewDigest: input.reviewDigest,
    documentDigests,
    sectionIndexDigest: String(issueValue.sectionIndexDigest),
    factStoreDigest: String(issueValue.factStoreDigest),
    manifestDigest: String(issueValue.manifestDigest),
    catalogVersion: String(issueValue.catalogVersion),
    contractGraphDigest: String(issueValue.contractGraphDigest),
    issues: issueValue.issues as AuditIssue[],
    paths,
    digests: {
      issueRegistry: String(marker.issueRegistryDigest),
      manifest: String(marker.manifestDigest),
      marker: stableDigest(marker),
    },
  }
}

function foundationFinalReviewArtifactPaths(workspacePath: string, revision: string, reviewDigest: string): FoundationDeterministicReviewArtifactPaths {
  if (!/^[a-f0-9]{64}$/.test(reviewDigest)) throw new Error('final review digest is invalid')
  const root = join(resolve(workspacePath), '.beegame', 'audit', 'foundation', revision, 'review', reviewDigest)
  return { root: join(resolve(workspacePath), '.beegame', 'audit', 'foundation', revision, 'review'), review: root, issueRegistry: join(root, 'issue-registry.json'), manifest: join(root, 'manifest.json'), marker: join(root, 'COMMITTED.json') }
}

function finalReviewDigest(input: { revision: string; documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]; sectionIndexDigest: string; factStoreDigest: string; deterministicReviewDigest: string; semanticManifestDigest: string; semanticResultDigests: readonly { checkId: string; packetIdentity: string; admittedResultDigest: string; confirmationDigest?: string }[]; issues: readonly AuditIssue[] }): string {
  return sha256(canonicalJson({ revision: input.revision, documentDigests: input.documentDigests, sectionIndexDigest: input.sectionIndexDigest, factStoreDigest: input.factStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, semanticManifestDigest: input.semanticManifestDigest, semanticResultDigests: input.semanticResultDigests, issues: input.issues }))
}

/** Publishes the one final review registry after all semantic results are admitted. */
export async function publishFoundationSemanticReview(input: {
  workspacePath: string
  revision: string
  documentDigests: readonly { path: FoundationDocumentPath; digest: string }[]
  sectionIndexDigest: string
  factStoreDigest: string
  deterministicReviewDigest: string
  semanticManifest: FoundationSemanticManifest
  semanticResultDigests: readonly { checkId: string; packetIdentity: string; admittedResultDigest: string; confirmationDigest?: string }[]
  issues: readonly AuditIssue[]
}): Promise<FoundationFinalReview> {
  if (input.semanticManifest.digest !== FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest) throw new Error('semantic manifest is not service authority')
  if (!/^[a-f0-9]{64}$/.test(input.deterministicReviewDigest) || !/^[a-f0-9]{64}$/.test(input.sectionIndexDigest) || !/^[a-f0-9]{64}$/.test(input.factStoreDigest)) throw new Error('final review binding digest is invalid')
  if (input.documentDigests.length !== 8 || new Set(input.documentDigests.map(item => item.path)).size !== 8) throw new Error('final review requires eight document digests')
  const expectedSemanticChecks = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(item => item.checkId).sort()
  const actualSemanticChecks = input.semanticResultDigests.map(item => item.checkId).sort()
  if (input.semanticResultDigests.length !== 10 || JSON.stringify(expectedSemanticChecks) !== JSON.stringify(actualSemanticChecks) || input.semanticResultDigests.some(item => typeof item.checkId !== 'string' || !/^[a-f0-9]{64}$/.test(item.packetIdentity) || !/^[a-f0-9]{64}$/.test(item.admittedResultDigest) || (item.confirmationDigest !== undefined && !/^[a-f0-9]{64}$/.test(item.confirmationDigest)))) throw new Error('semantic result ledger is invalid')
  const ids = new Set<string>()
  for (const [index, issue] of input.issues.entries()) { validateReviewIssue(issue, index, true); if (ids.has(issue.id)) throw new Error('duplicate final review issue identity'); ids.add(issue.id) }
  const semanticResultDigests = [...input.semanticResultDigests].sort((a, b) => a.checkId.localeCompare(b.checkId))
  const documentDigests = canonicalDocumentDigests(input.documentDigests)
  const issues = [...input.issues].sort((a, b) => a.id.localeCompare(b.id))
  const reviewDigest = finalReviewDigest({ revision: input.revision, documentDigests, sectionIndexDigest: input.sectionIndexDigest, factStoreDigest: input.factStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, semanticManifestDigest: input.semanticManifest.digest, semanticResultDigests, issues })
  const paths = foundationFinalReviewArtifactPaths(input.workspacePath, input.revision, reviewDigest)
  const existing = await loadFoundationSemanticReview({ workspacePath: input.workspacePath, revision: input.revision, reviewDigest }).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error })
  if (existing) return existing
  await mkdir(paths.root, { recursive: true })
  const temporary = join(paths.root, `.${reviewDigest}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`)
  await mkdir(temporary, { recursive: true })
  const issueValue = { revision: input.revision, status: 'committed' as const, reviewDigest, documentDigests, sectionIndexDigest: input.sectionIndexDigest, factStoreDigest: input.factStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, semanticManifestDigest: input.semanticManifest.digest, semanticResultDigests, issues }
  const manifestValue = { revision: input.revision, status: 'audit_ready' as const, reviewDigest, semanticManifest: input.semanticManifest }
  const issueText = `${JSON.stringify(issueValue, null, 2)}\n`; const manifestText = `${JSON.stringify(manifestValue, null, 2)}\n`
  const issueRegistryDigest = sha256(issueText); const manifestDigest = sha256(manifestText)
  await writeFile(join(temporary, 'issue-registry.json'), issueText, 'utf8'); await writeFile(join(temporary, 'manifest.json'), manifestText, 'utf8')
  const marker = { revision: input.revision, status: 'committed' as const, reviewDigest, issueRegistryDigest, manifestDigest, sectionIndexDigest: input.sectionIndexDigest, factStoreDigest: input.factStoreDigest, deterministicReviewDigest: input.deterministicReviewDigest, semanticManifestDigest: input.semanticManifest.digest, semanticResultDigests }
  await writeFile(join(temporary, 'COMMITTED.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
  const markerText = await readFile(join(temporary, 'COMMITTED.json'), 'utf8')
  const parsed = JSON.parse(markerText) as Record<string, unknown>
  if (parsed.status !== 'committed' || parsed.reviewDigest !== reviewDigest || parsed.issueRegistryDigest !== issueRegistryDigest || parsed.manifestDigest !== manifestDigest) throw new Error('final review temporary marker validation failed')
  try { await rename(temporary, paths.review) } catch (error) {
    const replay = await loadFoundationSemanticReview({ workspacePath: input.workspacePath, revision: input.revision, reviewDigest }).catch(() => undefined)
    if (!replay) throw error
    return replay
  }
  const committed = await loadFoundationSemanticReview({ workspacePath: input.workspacePath, revision: input.revision, reviewDigest })
  if (!committed) throw new Error('final review was not committed')
  return committed
}

export async function loadFoundationSemanticReview(input: { workspacePath: string; revision: string; reviewDigest: string }): Promise<FoundationFinalReview | undefined> {
  const paths = foundationFinalReviewArtifactPaths(input.workspacePath, input.revision, input.reviewDigest)
  const [issueText, manifestText, markerText] = await Promise.all([readFile(paths.issueRegistry, 'utf8'), readFile(paths.manifest, 'utf8'), readFile(paths.marker, 'utf8')])
  const issueValue = JSON.parse(issueText) as Record<string, unknown>; const manifestValue = JSON.parse(manifestText) as Record<string, unknown>; const marker = JSON.parse(markerText) as Record<string, unknown>
  if (!exactKeys(marker, ['revision', 'status', 'reviewDigest', 'issueRegistryDigest', 'manifestDigest', 'sectionIndexDigest', 'factStoreDigest', 'deterministicReviewDigest', 'semanticManifestDigest', 'semanticResultDigests']) || !exactKeys(issueValue, ['revision', 'status', 'reviewDigest', 'documentDigests', 'sectionIndexDigest', 'factStoreDigest', 'deterministicReviewDigest', 'semanticManifestDigest', 'semanticResultDigests', 'issues']) || !exactKeys(manifestValue, ['revision', 'status', 'reviewDigest', 'semanticManifest']) || marker.revision !== input.revision || marker.status !== 'committed' || marker.reviewDigest !== input.reviewDigest || marker.sectionIndexDigest !== issueValue.sectionIndexDigest || marker.factStoreDigest !== issueValue.factStoreDigest || marker.deterministicReviewDigest !== issueValue.deterministicReviewDigest || marker.semanticManifestDigest !== issueValue.semanticManifestDigest || sha256(issueText) !== marker.issueRegistryDigest || sha256(manifestText) !== marker.manifestDigest || !Array.isArray(issueValue.issues) || issueValue.status !== 'committed' || issueValue.reviewDigest !== input.reviewDigest || !Array.isArray(issueValue.semanticResultDigests) || JSON.stringify(issueValue.semanticResultDigests) !== JSON.stringify(marker.semanticResultDigests) || issueValue.semanticResultDigests.length !== 10 || manifestValue.revision !== input.revision || manifestValue.reviewDigest !== input.reviewDigest || manifestValue.status !== 'audit_ready' || (manifestValue.semanticManifest as Record<string, unknown> | undefined)?.digest !== FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest) throw new Error('final review marker or binding is invalid')
  const expectedSemanticChecks = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(item => item.checkId).sort(); const ledger = issueValue.semanticResultDigests as Array<{ checkId: string; packetIdentity: string; admittedResultDigest: string; confirmationDigest?: string }>; if (JSON.stringify(ledger.map(item => item.checkId).sort()) !== JSON.stringify(expectedSemanticChecks)) throw new Error('final review semantic result ledger is incomplete')
  for (const entry of ledger) {
    if (!exactKeys(entry as Record<string, unknown>, ['checkId', 'packetIdentity', 'admittedResultDigest', ...(Object.hasOwn(entry, 'confirmationDigest') ? ['confirmationDigest'] : [])]) || typeof entry.checkId !== 'string' || !isDigest(entry.packetIdentity) || !isDigest(entry.admittedResultDigest) || (entry.confirmationDigest !== undefined && !isDigest(entry.confirmationDigest))) throw new Error('final review semantic result ledger entry is invalid')
  }
  const issues = [...(issueValue.issues as AuditIssue[])].sort((a, b) => a.id.localeCompare(b.id)); const ids = new Set<string>(); issues.forEach((issue, index) => { validateReviewIssue(issue, index, true); if (ids.has(issue.id)) throw new Error('duplicate final review issue identity'); ids.add(issue.id) })
  const documentDigests = canonicalDocumentDigests(issueValue.documentDigests as never)
  if (finalReviewDigest({ revision: input.revision, documentDigests, sectionIndexDigest: String(issueValue.sectionIndexDigest), factStoreDigest: String(issueValue.factStoreDigest), deterministicReviewDigest: String(issueValue.deterministicReviewDigest), semanticManifestDigest: String(issueValue.semanticManifestDigest), semanticResultDigests: issueValue.semanticResultDigests as never[], issues }) !== input.reviewDigest) throw new Error('final review digest binding is invalid')
  return { revision: input.revision, reviewDigest: input.reviewDigest, documentDigests, sectionIndexDigest: String(issueValue.sectionIndexDigest), factStoreDigest: String(issueValue.factStoreDigest), deterministicReviewDigest: String(issueValue.deterministicReviewDigest), semanticManifestDigest: String(issueValue.semanticManifestDigest), issues, paths, digests: { issueRegistry: String(marker.issueRegistryDigest), manifest: String(marker.manifestDigest), marker: stableDigest(marker) } }
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
  if (['derived_committed', 'deterministic_ready', 'semantic_review', 'audit_ready'].includes(input.state.status)) {
    const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath: input.workspacePath, revision: input.state.revision })
    const derivedRoot = `.beegame/audit/foundation/${input.state.revision}/derived`
    const expectedDocumentDigests = Object.fromEntries(committed?.documentDigests.map(item => [item.path, item.digest]) ?? [])
    if (!committed || !input.state.derived || !sameJson(input.state.documentDigests, expectedDocumentDigests) || input.state.derived.manifestPath !== `${derivedRoot}/manifest.json` || input.state.derived.markerPath !== `${derivedRoot}/COMMITTED.json` || input.state.derived.factStorePath !== `${derivedRoot}/fact-store.json` || input.state.derived.sectionIndexPath !== `${derivedRoot}/section-index.json` || committed.digests.manifest !== input.state.derived.manifestDigest || committed.digests.marker !== input.state.derived.markerDigest || committed.digests.factStore !== input.state.derived.factStoreDigest || committed.digests.sectionIndex !== input.state.derived.sectionIndexDigest)
      throw new Error('foundation derived commit does not match state bindings')
    const staged = await loadFoundationAuditArtifacts({ workspacePath: input.workspacePath, revision: input.state.revision })
    if (!staged) throw new Error('foundation audit staged index is missing')
    if (input.state.status !== 'derived_committed') {
      if (!input.state.deterministic) throw new Error('foundation deterministic review binding is missing')
      if (input.state.deterministic.sectionIndexDigest !== input.state.derived?.sectionIndexDigest || input.state.deterministic.factStoreDigest !== input.state.derived?.factStoreDigest)
        throw new Error('foundation deterministic review digests do not match derived authority')
      const review = await loadDeterministicFoundationReview({ workspacePath: input.workspacePath, revision: input.state.revision, reviewDigest: input.state.deterministic.reviewDigest })
      if (!review || review.sectionIndexDigest !== input.state.deterministic.sectionIndexDigest || review.factStoreDigest !== input.state.deterministic.factStoreDigest || review.digests.issueRegistry !== input.state.deterministic.issueRegistryDigest || review.digests.manifest !== input.state.deterministic.manifestDigest || review.digests.marker !== input.state.deterministic.markerDigest || input.state.deterministic.issueRegistryPath !== relative(resolve(input.workspacePath), review.paths.issueRegistry).replaceAll('\\', '/') || input.state.deterministic.manifestPath !== relative(resolve(input.workspacePath), review.paths.manifest).replaceAll('\\', '/') || input.state.deterministic.markerPath !== relative(resolve(input.workspacePath), review.paths.marker).replaceAll('\\', '/'))
        throw new Error('foundation deterministic review does not match state bindings')
      if (input.state.status === 'audit_ready') {
        if (!input.state.review) throw new Error('foundation final review binding is missing')
        const final = await loadFoundationSemanticReview({ workspacePath: input.workspacePath, revision: input.state.revision, reviewDigest: input.state.review.reviewDigest })
        const finalRoot = `.beegame/audit/foundation/${input.state.revision}/review/${input.state.review.reviewDigest}`
        if (!final || final.digests.issueRegistry !== input.state.review.issueRegistryDigest || final.digests.manifest !== input.state.review.manifestDigest || final.digests.marker !== input.state.review.markerDigest || input.state.review.issueRegistryPath !== `${finalRoot}/issue-registry.json` || input.state.review.manifestPath !== `${finalRoot}/manifest.json` || input.state.review.markerPath !== `${finalRoot}/COMMITTED.json` || final.sectionIndexDigest !== input.state.review.sectionIndexDigest || final.factStoreDigest !== input.state.review.factStoreDigest || final.semanticManifestDigest !== input.state.review.semanticManifestDigest)
          throw new Error('foundation final review does not match state bindings')
      }
    }
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
