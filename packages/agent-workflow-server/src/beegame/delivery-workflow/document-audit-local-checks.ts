import {
  validateDocumentAuditCoverage,
  type CoverageManifest,
  type DerivedDocumentManifest,
  type DocumentAuditProtocolProofKind,
} from './document-audit-manifest'

export type LocalAuditResult = Readonly<{
  checkId: string
  status: 'PASS' | 'ISSUE'
}>

export type LocalAuditMetrics = Readonly<{
  l0Pass: number
  l0Issue: number
  l1Pass: number
  l1Issue: number
  escalated: number
}>

export function runDocumentAuditLocalChecks(input: {
  coverage: CoverageManifest
  manifest: DerivedDocumentManifest
}): {
  results: LocalAuditResult[]
  escalatedCheckIds: string[]
  metrics: LocalAuditMetrics
} {
  validateDocumentAuditCoverage(input.coverage, input.manifest)
  const proofByKind = new Map(
    input.manifest.protocolProofs.map(proof => [proof.kind, proof]),
  )
  const results: LocalAuditResult[] = []
  const escalatedCheckIds: string[] = []
  let l0Pass = 0
  let l0Issue = 0
  let l1Pass = 0

  for (const check of input.coverage.checks) {
    if (check.kind === 'global') {
      const proof = proofByKind.get(check.checkId.slice('global:'.length) as DocumentAuditProtocolProofKind)
      if (!proof) throw new Error(`missing protocol proof: ${check.checkId}`)
      results.push({ checkId: check.checkId, status: proof.status })
      if (proof.status === 'PASS') l0Pass += 1
      else l0Issue += 1
      continue
    }
    if (check.kind === 'contract') {
      const source = input.manifest.documents.find(document => document.path === check.sourcePath)
      const target = input.manifest.documents.find(document => document.path === check.targetPath)
      if (!source || !target || !source.sections.some(section => section.sectionId === check.sourceSectionIds[0]))
        throw new Error(`declared contract endpoint is unavailable: ${check.checkId}`)
      results.push({ checkId: check.checkId, status: 'PASS' })
      l1Pass += 1
    }
    escalatedCheckIds.push(check.checkId)
  }

  return {
    results,
    escalatedCheckIds,
    metrics: { l0Pass, l0Issue, l1Pass, l1Issue: 0, escalated: escalatedCheckIds.length },
  }
}
