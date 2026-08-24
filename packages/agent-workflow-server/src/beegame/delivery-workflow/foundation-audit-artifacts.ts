import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import {
  buildFoundationSectionIndex,
  digestSectionIndex,
  type FoundationSectionIndex,
} from './foundation-section-index'
import {
  createFoundationFactStore,
  digestFactStore,
  extractFoundationFacts,
  type FoundationFactStore,
} from './foundation-fact-store'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentCheckpoint,
  type FoundationDocumentPath,
} from './types'
import type { FoundationAuditState } from './foundation-audit-state'

export type FoundationAuditManifest = {
  revision: string
  sectionIndexDigest: string
  factStoreDigest: string
}

export type FoundationAuditArtifactPaths = {
  root: string
  sectionIndex: string
  factStore: string
  manifest: string
}

export type DerivedFoundationAuditArtifacts = {
  revision: string
  documentDigests: Array<{ path: FoundationDocumentPath; digest: string }>
  sectionIndex: FoundationSectionIndex
  factStore: FoundationFactStore
  manifest: FoundationAuditManifest
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
  const root = join(base, revision, 'derived')
  assertDescendant(base, root)
  return {
    root,
    sectionIndex: join(root, 'section-index.json'),
    factStore: join(root, 'fact-store.json'),
    manifest: join(root, 'manifest.json'),
  }
}

export function relativeFoundationAuditArtifactPaths(
  revision: string,
): Omit<FoundationAuditArtifactPaths, 'root'> {
  assertRevision(revision)
  const root = `.beegame/audit/foundation/${revision}/derived`
  return {
    sectionIndex: `${root}/section-index.json`,
    factStore: `${root}/fact-store.json`,
    manifest: `${root}/manifest.json`,
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
    digest: sha256(documents.get(path)! as string),
  }))
}

function exactKeys(value: object, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort()
  return JSON.stringify(actual) === JSON.stringify([...keys].sort())
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

async function readArtifact(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`foundation audit artifact is malformed: ${path}`)
  }
}

function validateDocumentDigestList(
  value: unknown,
  expected: readonly { path: FoundationDocumentPath; digest: string }[],
): void {
  if (!Array.isArray(value) || !sameJson(value, expected))
    throw new Error(
      'foundation audit artifact document digest binding is invalid',
    )
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
  const [sectionIndexRaw, factStoreRaw, manifestRaw] = await Promise.all([
    readArtifact(paths.sectionIndex),
    readArtifact(paths.factStore),
    readArtifact(paths.manifest),
  ])
  const present = [sectionIndexRaw, factStoreRaw, manifestRaw].filter(
    value => value !== undefined,
  ).length
  if (present === 0) {
    if (rootExists || input.expectedState)
      throw new Error('foundation audit artifact set is missing and immutable')
    return undefined
  }
  if (present !== 3)
    throw new Error('foundation audit artifact set is partial and immutable')

  const expectedDocuments = documentDigests(input.documents)
  if (
    !sectionIndexRaw ||
    !factStoreRaw ||
    !manifestRaw ||
    typeof sectionIndexRaw !== 'object' ||
    typeof factStoreRaw !== 'object' ||
    typeof manifestRaw !== 'object' ||
    !exactKeys(sectionIndexRaw, [
      'revision',
      'documentDigests',
      'sections',
      'digest',
    ]) ||
    !exactKeys(factStoreRaw, [
      'revision',
      'documentDigests',
      'facts',
      'digest',
    ]) ||
    !exactKeys(manifestRaw, [
      'revision',
      'sectionIndexDigest',
      'factStoreDigest',
    ])
  )
    throw new Error('foundation audit artifact set is malformed and immutable')
  const sectionObject = sectionIndexRaw as Record<string, unknown>
  const factObject = factStoreRaw as Record<string, unknown>
  const manifest = manifestRaw as Record<string, unknown>
  if (
    sectionObject.revision !== input.revision ||
    factObject.revision !== input.revision ||
    manifest.revision !== input.revision ||
    !isDigest(sectionObject.digest) ||
    !isDigest(factObject.digest) ||
    !isDigest(manifest.sectionIndexDigest) ||
    !isDigest(manifest.factStoreDigest)
  )
    throw new Error('foundation audit artifact revision or digest is invalid')
  validateDocumentDigestList(sectionObject.documentDigests, expectedDocuments)
  validateDocumentDigestList(factObject.documentDigests, expectedDocuments)
  if (
    !Array.isArray(sectionObject.sections) ||
    !Array.isArray(factObject.facts)
  )
    throw new Error('foundation audit artifact payload is invalid')
  const sectionIndex = buildFoundationSectionIndex({
    documents: input.documents,
  })
  const factStore = createFoundationFactStore(
    extractFoundationFacts({ documents: input.documents, sectionIndex }),
  )
  const sectionDigest = digestSectionIndex(sectionIndex)
  const factDigest = digestFactStore(factStore)
  if (
    sectionObject.digest !== sectionDigest ||
    factObject.digest !== factDigest ||
    manifest.sectionIndexDigest !== sectionDigest ||
    manifest.factStoreDigest !== factDigest ||
    !sameJson(sectionObject.sections, sectionIndex) ||
    !sameJson(factObject.facts, factStore)
  )
    throw new Error(
      'foundation audit artifact bytes do not match current documents',
    )
  const typedManifest: FoundationAuditManifest = {
    revision: input.revision,
    sectionIndexDigest: sectionDigest,
    factStoreDigest: factDigest,
  }
  if (
    input.expectedState &&
    (!sameJson(
      input.expectedState.documentDigests,
      Object.fromEntries(
        expectedDocuments.map(item => [item.path, item.digest]),
      ),
    ) ||
      !sameJson(input.expectedState.manifest, typedManifest) ||
      input.expectedState.sectionIndexPath !==
        relativeFoundationAuditArtifactPaths(input.revision).sectionIndex ||
      input.expectedState.factStorePath !==
        relativeFoundationAuditArtifactPaths(input.revision).factStore ||
      input.expectedState.manifestPath !==
        relativeFoundationAuditArtifactPaths(input.revision).manifest)
  )
    throw new Error(
      'foundation audit state does not match committed artifact bytes',
    )
  return {
    revision: input.revision,
    documentDigests: expectedDocuments,
    sectionIndex,
    factStore,
    manifest: typedManifest,
    paths,
  }
}

/** Shared fail-closed loader used by derivation and recovery. */
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
  const loaded = await loadFoundationAuditArtifacts({
    workspacePath: input.workspacePath,
    revision: input.state.revision,
    expectedState: input.state,
  })
  if (!loaded)
    throw new Error('foundation audit state refers to missing artifacts')
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
  const factStore = createFoundationFactStore(
    extractFoundationFacts({ documents, sectionIndex }),
  )
  const manifest: FoundationAuditManifest = {
    revision: input.revision,
    sectionIndexDigest: digestSectionIndex(sectionIndex),
    factStoreDigest: digestFactStore(factStore),
  }
  await durableJson(paths.sectionIndex, {
    revision: input.revision,
    documentDigests: documentDigestsValue,
    sections: sectionIndex,
    digest: manifest.sectionIndexDigest,
  })
  await durableJson(paths.factStore, {
    revision: input.revision,
    documentDigests: documentDigestsValue,
    facts: factStore,
    digest: manifest.factStoreDigest,
  })
  await durableJson(paths.manifest, manifest)
  const loaded = await loadExistingFoundationAuditArtifacts({
    workspace,
    revision: input.revision,
    documents,
  })
  if (!loaded) throw new Error('foundation audit artifacts were not committed')
  return loaded
}

export function artifactPathsRelativeToWorkspace(
  workspacePath: string,
  paths: FoundationAuditArtifactPaths,
): Omit<FoundationAuditArtifactPaths, 'root'> {
  const root = resolve(workspacePath)
  return {
    sectionIndex: relative(root, paths.sectionIndex).replaceAll('\\', '/'),
    factStore: relative(root, paths.factStore).replaceAll('\\', '/'),
    manifest: relative(root, paths.manifest).replaceAll('\\', '/'),
  }
}
