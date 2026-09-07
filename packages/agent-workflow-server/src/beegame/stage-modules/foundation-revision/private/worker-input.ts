import { prepareRevisionRequest } from './request-preparation'
import { revisionDigest } from './json-digest'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { getGameDocumentContract } from './domain/game-document-contracts'
import { REVISION_FACT_HANDOFF_CONSTRAINTS } from './domain/fact-handoff-constraints'
import type { FoundationDocumentPath } from './domain/types'
import type { RevisionFact } from './fact-evidence'

// Frozen structural preservation projection, not a second document audit.
function completeDocumentRepairContract(path: FoundationDocumentPath) {
  const contract = getGameDocumentContract(path)
  return {
    documentTitle: {
      position: 'first_non_blank_line',
      headingPrefix: '# ',
    },
    executiveSummary: {
      marker: '<!-- beegame-executive-summary -->',
      heading: '## Executive Summary',
    },
    sections: contract.sections.map(section => ({
      sectionId: section.sectionId,
      marker: `<!-- beegame-section:${section.sectionId} -->`,
      heading: `## ${section.title}`,
    })),
    productionMaterials: {
      marker: '<!-- beegame-production-materials -->',
      heading: '## Production Materials',
      entries: contract.productionMaterials.map(material => ({
        materialId: material.materialId,
        marker: `<!-- beegame-material:${material.materialId} -->`,
        heading: `### ${material.title}`,
        format: material.format,
      })),
    },
    auditAppendix: {
      optional: true,
      marker: '<!-- beegame-audit-appendix -->',
      heading: '## Audit Appendix',
      acceptanceHeading: '### Acceptance Criteria',
    },
    additionalH2: 'forbidden',
    supportingContent: 'must be nested under one of the declared H2 headings',
  }
}

/** Reconstructs private repair packets from accepted public bytes, without filesystem/model execution. */
export function prepareRevisionWorkerInputs(value: unknown) {
  const prepared = prepareRevisionRequest(value)
  const { source } = prepared
  return prepared.batches.map(batch => {
    // Preserve admitted source issue order, independently of sorted batch IDs.
    const entries = source.issues.filter(entry => batch.issueIds.includes(entry.issue.id))
    const issues = entries.map(entry => entry.issue)
    const document = prepared.staging.documents.find(doc => doc.path === batch.documentPath)!
    const base = { protocolVersion: 1 as const, producer: 'foundation-revision' as const, kind: 'repair_packet' as const,
      requestDigest: prepared.requestDigest, round: prepared.round, sourceReviewResultId: source.resultId,
      sourceReviewResultDigest: revisionDigest(source), baseDocumentDigest: document.digest,
      documentPath: batch.documentPath, issueIds: [...batch.issueIds], sectionIds: [...batch.sectionIds], issues }
    if (batch.scope === 'document') {
      const packet = { ...base, scope: 'document' as const, sections: [], normalizedFacts: [], factConstraints: [],
        documentContract: completeDocumentRepairContract(batch.documentPath),
        document: { documentPath: batch.documentPath, digest: document.digest, text: document.content } }
      return { packet, packetDigest: revisionDigest(packet) }
    }
    const refs = new Set<string>()
    const paths = new Set<FoundationDocumentPath>([batch.documentPath])
    for (const issue of issues) {
      if (!('sectionId' in issue.source) || issue.remediation.scope !== 'section')
        throw new Error('Revision section packet requires section issue authority')
      refs.add(`${issue.source.documentPath}\0${issue.source.sectionId}`)
      paths.add(issue.source.documentPath)
      if ('target' in issue && issue.target) {
        refs.add(`${issue.target.documentPath}\0${issue.target.sectionId}`)
        paths.add(issue.target.documentPath)
      }
      if ('supportingSections' in issue) for (const supporting of issue.supportingSections ?? []) {
        refs.add(`${supporting.documentPath}\0${supporting.sectionId}`)
        paths.add(supporting.documentPath)
      }
      paths.add(issue.remediation.documentPath)
      for (const sectionId of issue.remediation.sectionIds) refs.add(`${issue.remediation.documentPath}\0${sectionId}`)
    }
    // Per-document indexing preserves the old packet's evidence-document order.
    // Cross-document evidence remains bound to source, not another worker's edits.
    const sections = [...paths].flatMap(path => {
      const content = source.documents.find(doc => doc.path === path)!.content
      return buildFoundationSectionIndex({ documents: { [path]: content } })
        .filter(section => (path === batch.documentPath && batch.sectionIds.includes(section.sectionId)) || refs.has(`${path}\0${section.sectionId}`))
        .map(section => ({ ...section, text: content.split('\n').slice(section.startLine - 1, section.endLine).join('\n') }))
    })
    const facts = new Map<string, RevisionFact>()
    for (const entry of entries) for (const fact of entry.facts)
      if (refs.has(`${fact.source.documentPath}\0${fact.source.sectionId}`)) facts.set(fact.key, fact)
    const normalizedFacts = [...facts.values()].sort((left, right) => left.key.localeCompare(right.key))
    const factConstraints = REVISION_FACT_HANDOFF_CONSTRAINTS.filter(constraint => constraint.owner.documentPath === batch.documentPath &&
      batch.sectionIds.includes(constraint.owner.sectionId)).map(constraint => structuredClone(constraint))
      .sort((left, right) => left.key.localeCompare(right.key))
    const packet = { ...base, scope: 'section' as const, sections, normalizedFacts, factConstraints }
    return { packet, packetDigest: revisionDigest(packet) }
  })
}
