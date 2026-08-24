import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
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
  if (!/^[A-Za-z0-9._-]+$/.test(revision))
    throw new Error(
      'foundation audit revision must be a safe project-local identifier',
    )
}

export function foundationAuditArtifactPaths(
  workspacePath: string,
  revision: string,
): FoundationAuditArtifactPaths {
  assertRevision(revision)
  const root = join(
    resolve(workspacePath),
    '.beegame',
    'audit',
    'foundation',
    revision,
    'derived',
  )
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
}): readonly Pick<FoundationDocumentCheckpoint, 'path' | 'status'>[] {
  if (!input.checkpoints)
    throw new Error(
      'durable committed foundation checkpoints are required before audit derivation',
    )
  assertExactlyEightCommittedFoundationDocuments(input.checkpoints)
  return input.checkpoints
}

async function durableJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, path)
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
  const documents = new Map<FoundationDocumentPath, string>()
  for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
    let supplied: string | undefined
    if (input.documents instanceof Map) supplied = input.documents.get(path)
    else if (input.documents)
      supplied = (input.documents as Record<string, string>)[path]
    const content =
      supplied ??
      (await readFile(join(workspace, path), 'utf8').catch(() => {
        throw new Error(`committed foundation document is missing: ${path}`)
      }))
    documents.set(path, content)
  }
  const documentDigests = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path,
    digest: sha256(documents.get(path)!),
  }))
  const paths = foundationAuditArtifactPaths(workspace, input.revision)
  try {
    const prior = JSON.parse(await readFile(paths.sectionIndex, 'utf8')) as {
      revision?: unknown
      documentDigests?: unknown
    }
    if (
      prior.revision === input.revision &&
      JSON.stringify(prior.documentDigests) !== JSON.stringify(documentDigests)
    )
      throw new Error(
        'foundation audit revision is already bound to different document digests',
      )
  } catch (error) {
    if (error instanceof Error && error.message.includes('already bound'))
      throw error
    // A missing artifact is the normal first-derivation path. Malformed old
    // artifacts have no trusted binding and are replaced by this derivation.
  }
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
    documentDigests,
    sections: sectionIndex,
    digest: manifest.sectionIndexDigest,
  })
  await durableJson(paths.factStore, {
    revision: input.revision,
    documentDigests,
    facts: factStore,
    digest: manifest.factStoreDigest,
  })
  await durableJson(paths.manifest, manifest)
  return {
    revision: input.revision,
    documentDigests,
    sectionIndex,
    factStore,
    manifest,
    paths,
  }
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
