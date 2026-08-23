import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { validateCompleteGameDocumentMarkdown } from '../complete-game-document'
import { GAME_DOCUMENT_CONTRACTS, getGameDocumentContract } from './game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

export type DocumentAuditCheck =
  | {
      checkId: `section:${string}:${string}`
      kind: 'section'
      targetPath: FoundationDocumentPath
      targetSectionIds: readonly string[]
    }
  | {
      checkId: `contract:${string}:${string}->${string}`
      kind: 'contract'
      sourcePath: FoundationDocumentPath
      sourceSectionIds: readonly [string]
      targetPath: FoundationDocumentPath
      targetScope: 'document'
      constraint: 'authority_consistency'
    }
  | {
      checkId: `global:${string}`
      kind: 'global'
      targetPath?: FoundationDocumentPath
      targetSectionIds: readonly string[]
    }

export type DocumentAuditProtocolProofKind =
  | 'all-required-documents-present'
  | 'canonical-section-markers-valid'
  | 'production-material-markers-valid'
  | 'canonical-markdown-valid'

export type DocumentAuditProtocolProof = Readonly<{
  kind: DocumentAuditProtocolProofKind
  status: 'PASS' | 'ISSUE'
  evidenceDigest: string
}>

export type DerivedDocumentManifest = Readonly<{
  version: 1
  revision: string
  documents: readonly Readonly<{
    path: FoundationDocumentPath
    digest: string
    sections: readonly Readonly<{ sectionId: string; digest: string }>[]
    facts: readonly never[]
  }>[]
  protocolProofs: readonly DocumentAuditProtocolProof[]
  digest: string
}>

export type CoverageManifest = Readonly<{
  version: 1
  sourceRevision: string
  manifestDigest: string
  contractDigest: string
  checks: readonly DocumentAuditCheck[]
  digest: string
}>

const GLOBAL_CHECK_IDS = [
  'global:all-required-documents-present',
  'global:canonical-section-markers-valid',
  'global:production-material-markers-valid',
  'global:canonical-markdown-valid',
] as const

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex')
}
function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
      .sort(bytewiseCompare)
      .map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function protocolEvidenceDigest(
  kind: DocumentAuditProtocolProofKind,
  documents: DerivedDocumentManifest['documents'],
): string {
  return sha256(canonicalJson({ kind, documents }))
}

function protocolProofs(
  documents: DerivedDocumentManifest['documents'],
): readonly DocumentAuditProtocolProof[] {
  return GLOBAL_CHECK_IDS.map(checkId => {
    const kind = checkId.slice('global:'.length) as DocumentAuditProtocolProofKind
    const status = 'PASS' as const
    return Object.freeze({
      kind,
      status,
      evidenceDigest: protocolEvidenceDigest(kind, documents),
    })
  })
}

function canonicalManifestBody(manifest: Omit<DerivedDocumentManifest, 'digest'>): string {
  return canonicalJson(manifest)
}

export function deriveDocumentAuditManifestDigest(
  manifest: Omit<DerivedDocumentManifest, 'digest'>,
): string {
  return sha256(canonicalManifestBody(manifest))
}

function canonicalCoverageBody(coverage: Omit<CoverageManifest, 'digest'>): string {
  return canonicalJson(coverage)
}

function contractDigest(): string {
  return sha256(canonicalJson(GAME_DOCUMENT_CONTRACTS))
}

function auditChecks(): readonly DocumentAuditCheck[] {
  const checks: DocumentAuditCheck[] = []
  for (const targetPath of CANONICAL_FOUNDATION_DOCUMENTS) {
    const contract = getGameDocumentContract(targetPath)
    for (const section of contract.sections)
      checks.push({
        checkId: `section:${targetPath}:${section.sectionId}`,
        kind: 'section',
        targetPath,
        targetSectionIds: Object.freeze([section.sectionId]),
      })
    for (const upstream of contract.upstreamSections)
      for (const sectionId of upstream.sectionIds)
        checks.push({
          checkId: `contract:${upstream.path}:${sectionId}->${targetPath}`,
          kind: 'contract',
          sourcePath: upstream.path,
          sourceSectionIds: Object.freeze([sectionId]),
          targetPath,
          targetScope: 'document',
          constraint: 'authority_consistency',
        })
  }
  for (const checkId of GLOBAL_CHECK_IDS)
    checks.push({ checkId, kind: 'global', targetSectionIds: Object.freeze([]) })
  return Object.freeze(
    checks.sort((left, right) => bytewiseCompare(left.checkId, right.checkId)),
  )
}

function hasExactValues<T>(actual: readonly T[], expected: readonly T[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index])
}

function sameCheck(actual: DocumentAuditCheck, expected: DocumentAuditCheck): boolean {
  return canonicalJson(actual) === canonicalJson(expected)
}

function validateCheckSet(checks: readonly DocumentAuditCheck[]): void {
  const expected = auditChecks()
  if (
    checks.length !== expected.length ||
    checks.some((check, index) => !sameCheck(check, expected[index]!))
  )
    throw new Error('document audit coverage checks must exactly match canonical contracts')
  if (new Set(checks.map(check => check.checkId)).size !== checks.length)
    throw new Error('document audit coverage check IDs must be unique')
}

export function validateDerivedDocumentManifest(manifest: DerivedDocumentManifest): void {
  if (manifest.version !== 1) throw new Error('derived document manifest version is invalid')
  if (!manifest.revision) throw new Error('derived document manifest revision is required')
  if (!hasExactValues(manifest.documents.map(document => document.path), CANONICAL_FOUNDATION_DOCUMENTS))
    throw new Error('derived document manifest paths must exactly match canonical order')
  for (const document of manifest.documents) {
    const contract = getGameDocumentContract(document.path)
    if (!/^[a-f0-9]{64}$/.test(document.digest))
      throw new Error(`derived document digest is invalid: ${document.path}`)
    if (!hasExactValues(document.sections.map(section => section.sectionId), contract.sections.map(section => section.sectionId)))
      throw new Error(`derived document sections are invalid: ${document.path}`)
    if (document.facts.length !== 0)
      throw new Error(`derived document facts must remain empty: ${document.path}`)
    for (const section of document.sections)
      if (!/^[a-f0-9]{64}$/.test(section.digest))
        throw new Error(`derived section digest is invalid: ${document.path}#${section.sectionId}`)
  }
  if (!hasExactValues(manifest.protocolProofs.map(proof => proof.kind), GLOBAL_CHECK_IDS.map(id => id.slice('global:'.length) as DocumentAuditProtocolProofKind)))
    throw new Error('derived document protocol proofs must exactly match global checks')
  for (const proof of manifest.protocolProofs) {
    if (proof.status !== 'PASS' && proof.status !== 'ISSUE')
      throw new Error(`derived document protocol proof status is invalid: ${proof.kind}`)
    if (proof.evidenceDigest !== protocolEvidenceDigest(proof.kind, manifest.documents))
      throw new Error(`derived document protocol proof is stale: ${proof.kind}`)
  }
  const expectedDigest = deriveDocumentAuditManifestDigest({
    version: manifest.version,
    revision: manifest.revision,
    documents: manifest.documents,
    protocolProofs: manifest.protocolProofs,
  })
  if (manifest.digest !== expectedDigest)
    throw new Error('derived document manifest digest is invalid')
}

export async function buildDerivedDocumentManifest(input: {
  workspacePath: string
  revision: string
}): Promise<DerivedDocumentManifest> {
  const documents = await Promise.all(
    CANONICAL_FOUNDATION_DOCUMENTS.map(async path => {
      const bytes = await readFile(join(input.workspacePath, path))
      const markdown = bytes.toString('utf8')
      validateCompleteGameDocumentMarkdown(path, markdown)
      const contract = getGameDocumentContract(path)
      const markerOffsets = contract.sections.map(section => {
        const marker = Buffer.from(`<!-- beegame-section:${section.sectionId} -->`)
        const offset = bytes.indexOf(marker)
        if (offset < 0 || bytes.indexOf(marker, offset + marker.length) >= 0)
          throw new Error(`canonical section marker is invalid: ${path}#${section.sectionId}`)
        return offset
      })
      const productionMarker = Buffer.from('<!-- beegame-production-materials -->')
      const productionOffset = bytes.indexOf(productionMarker)
      if (productionOffset < 0) throw new Error(`production material marker is invalid: ${path}`)
      return Object.freeze({
        path,
        digest: sha256(bytes),
        sections: Object.freeze(
          contract.sections.map((section, index) =>
            Object.freeze({
              sectionId: section.sectionId,
              digest: sha256(bytes.subarray(markerOffsets[index]!, markerOffsets[index + 1] ?? productionOffset)),
            }),
          ),
        ),
        facts: Object.freeze([]) as readonly never[],
      })
    }),
  )
  const frozenDocuments = Object.freeze(documents)
  const proofs = Object.freeze(protocolProofs(frozenDocuments))
  const body = {
    version: 1 as const,
    revision: input.revision,
    documents: frozenDocuments,
    protocolProofs: proofs,
  }
  const manifest = Object.freeze({ ...body, digest: deriveDocumentAuditManifestDigest(body) })
  validateDerivedDocumentManifest(manifest)
  return manifest
}

export function buildDocumentAuditCoverage(input: {
  sourceRevision: string
  manifest: DerivedDocumentManifest
}): CoverageManifest {
  validateDerivedDocumentManifest(input.manifest)
  if (input.sourceRevision !== input.manifest.revision)
    throw new Error('coverage source revision must match derived document manifest revision')
  const body = {
    version: 1 as const,
    sourceRevision: input.sourceRevision,
    manifestDigest: input.manifest.digest,
    contractDigest: contractDigest(),
    checks: auditChecks(),
  }
  return Object.freeze({ ...body, digest: sha256(canonicalCoverageBody(body)) })
}

export function validateDocumentAuditCoverage(
  coverage: CoverageManifest,
  manifest: DerivedDocumentManifest,
): void {
  validateDerivedDocumentManifest(manifest)
  if (coverage.version !== 1) throw new Error('coverage manifest version is invalid')
  if (coverage.sourceRevision !== manifest.revision)
    throw new Error('coverage source revision does not match derived document manifest')
  if (coverage.manifestDigest !== manifest.digest)
    throw new Error('coverage manifest digest does not match derived document manifest')
  if (coverage.contractDigest !== contractDigest())
    throw new Error('coverage contract digest is stale')
  validateCheckSet(coverage.checks)
  if (
    coverage.digest !==
    sha256(
      canonicalCoverageBody({
        version: coverage.version,
        sourceRevision: coverage.sourceRevision,
        manifestDigest: coverage.manifestDigest,
        contractDigest: coverage.contractDigest,
        checks: coverage.checks,
      }),
    )
  )
    throw new Error('coverage manifest digest is invalid')
}
