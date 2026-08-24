import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

export type FoundationAuditManifest = {
  revision: string
  status: 'index_staged'
  catalogVersion: typeof FOUNDATION_FACT_CATALOG_VERSION
  sectionIndexDigest: string
  needsAction: 'foundation fact extraction is not part of Task 4A'
}

export type FoundationAuditArtifactPaths = {
  root: string
  sectionIndex: string
  manifest: string
  factStore: string
  derivedManifest: string
  commitMarker: string
  derived: string
}
export type DerivedFoundationAuditArtifacts = {
  revision: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndex: FoundationSectionIndex
  manifest: FoundationAuditManifest
  paths: FoundationAuditArtifactPaths
}

export type FoundationDerivedManifest = {
  revision: string
  sectionIndexDigest: string
  factStoreDigest: string
  normalizedFactDigest: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
}

export type CommittedDerivedFoundationAuditArtifacts = {
  revision: string
  sectionIndex: FoundationSectionIndex
  factStore: unknown
  manifest: FoundationDerivedManifest
  paths: FoundationAuditArtifactPaths
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
  const derived = join(base, revision, 'derived')
  assertDescendant(base, root)
  return {
    root,
    sectionIndex: join(root, 'section-index.json'),
    manifest: join(root, 'manifest.json'),
    factStore: join(root, 'fact-store.json'),
    derivedManifest: join(derived, 'derived-manifest.json'),
    commitMarker: join(derived, 'COMMITTED.json'),
    derived,
  }
}
export function relativeFoundationAuditArtifactPaths(
  revision: string,
): Omit<FoundationAuditArtifactPaths, 'root' | 'derived'> & { derived: string } {
  assertRevision(revision)
  const root = `.beegame/audit/foundation/${revision}/staging`
  return {
    sectionIndex: `${root}/section-index.json`,
    manifest: `${root}/manifest.json`,
    factStore: `${root}/fact-store.json`,
    derived: `.beegame/audit/foundation/${revision}/derived`,
    derivedManifest: `.beegame/audit/foundation/${revision}/derived/derived-manifest.json`,
    commitMarker: `.beegame/audit/foundation/${revision}/derived/COMMITTED.json`,
  }
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
      (input.expectedState.status !== 'index_staged' &&
        input.expectedState.status !== 'extracting_facts' &&
        input.expectedState.status !== 'facts_staged') ||
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
    const committed = await loadCommittedDerivedFoundationAuditArtifacts({
      workspacePath: input.workspacePath,
      revision: input.state.revision,
    })
    return committed as unknown as DerivedFoundationAuditArtifacts
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
): Pick<FoundationAuditArtifactPaths, 'sectionIndex' | 'manifest'> {
  const root = resolve(workspacePath)
  return {
    sectionIndex: relative(root, paths.sectionIndex).replaceAll('\\', '/'),
    manifest: relative(root, paths.manifest).replaceAll('\\', '/'),
  }
}

function canonicalDigest(value: unknown): string {
  return sha256(JSON.stringify(value))
}

export async function publishDerivedFoundationAuditArtifacts(input: {
  workspacePath: string
  revision: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndex: FoundationSectionIndex & { digest?: string }
  factStore: unknown
  normalizedFactDigest: string
}): Promise<CommittedDerivedFoundationAuditArtifacts> {
  assertRevision(input.revision)
  if (!isDigest(input.normalizedFactDigest))
    throw new Error('normalized foundation fact digest is invalid')
  const paths = foundationAuditArtifactPaths(input.workspacePath, input.revision)
  const sectionIndexDigest = input.sectionIndex.digest ?? digestSectionIndex(input.sectionIndex)
  const factStoreDigest = canonicalDigest(input.factStore)
  const manifest: FoundationDerivedManifest = {
    revision: input.revision,
    sectionIndexDigest,
    factStoreDigest,
    normalizedFactDigest: input.normalizedFactDigest,
    documentDigests: input.documentDigests,
  }
  const marker = {
    status: 'committed' as const,
    revision: input.revision,
    sectionIndexDigest,
    factStoreDigest,
    derivedManifestDigest: canonicalDigest(manifest),
  }
  try {
    return await loadCommittedDerivedFoundationAuditArtifacts({
      workspacePath: input.workspacePath,
      revision: input.revision,
    })
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('derived directory is missing')) throw error
  }
  const parent = dirname(paths.derived)
  const temporary = join(parent, `.derived-${randomUUID()}.tmp`)
  await mkdir(temporary, { recursive: true })
  try {
    await writeFile(join(temporary, 'section-index.json'), `${JSON.stringify(input.sectionIndex, null, 2)}\n`, 'utf8')
    await writeFile(join(temporary, 'fact-store.json'), `${JSON.stringify(input.factStore, null, 2)}\n`, 'utf8')
    await writeFile(join(temporary, 'derived-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await writeFile(join(temporary, 'COMMITTED.json'), `${JSON.stringify(marker, null, 2)}\n`, 'utf8')
    await rename(temporary, paths.derived)
  } catch (error) {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return loadCommittedDerivedFoundationAuditArtifacts({
        workspacePath: input.workspacePath,
        revision: input.revision,
      })
    throw error
  }
  return loadCommittedDerivedFoundationAuditArtifacts({
    workspacePath: input.workspacePath,
    revision: input.revision,
  })
}

export async function loadCommittedDerivedFoundationAuditArtifacts(input: {
  workspacePath: string
  revision: string
}): Promise<CommittedDerivedFoundationAuditArtifacts> {
  assertRevision(input.revision)
  const paths = foundationAuditArtifactPaths(input.workspacePath, input.revision)
  let directory: Awaited<ReturnType<typeof stat>>
  try {
    directory = await stat(paths.derived)
  } catch {
    throw new Error('derived directory is missing')
  }
  if (!directory.isDirectory()) throw new Error('derived directory is invalid')
  const [sectionRaw, factsRaw, manifestRaw, markerRaw] = await Promise.all(
    ['section-index.json', 'fact-store.json', 'derived-manifest.json', 'COMMITTED.json'].map(async name => {
      try { return JSON.parse(await readFile(join(paths.derived, name), 'utf8')) as unknown }
      catch { throw new Error(`derived commit marker or artifact is missing: ${name}`) }
    }),
  )
  if (!markerRaw || typeof markerRaw !== 'object' || (markerRaw as Record<string, unknown>).status !== 'committed')
    throw new Error('derived commit marker is invalid')
  if (!manifestRaw || typeof manifestRaw !== 'object' || (manifestRaw as Record<string, unknown>).revision !== input.revision)
    throw new Error('derived manifest is invalid')
  const manifest = manifestRaw as FoundationDerivedManifest
  if (
    (markerRaw as Record<string, unknown>).revision !== input.revision ||
    (markerRaw as Record<string, unknown>).sectionIndexDigest !== manifest.sectionIndexDigest ||
    (markerRaw as Record<string, unknown>).factStoreDigest !== manifest.factStoreDigest ||
    (markerRaw as Record<string, unknown>).derivedManifestDigest !== canonicalDigest(manifest) ||
    canonicalDigest(factsRaw) !== manifest.factStoreDigest
  ) throw new Error('derived commit marker digest is invalid')
  const sectionIndex = sectionRaw as FoundationSectionIndex
  if (digestSectionIndex(sectionIndex) !== manifest.sectionIndexDigest)
    throw new Error('derived section index digest is invalid')
  return { revision: input.revision, sectionIndex, factStore: factsRaw, manifest, paths }
}
