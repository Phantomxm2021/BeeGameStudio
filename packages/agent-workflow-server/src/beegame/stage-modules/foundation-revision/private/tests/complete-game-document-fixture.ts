import type { FoundationDocumentPath } from '../domain/types'

type Material =
  | { materialId: string; title: string; format: 'markdown_table' | 'mermaid' | 'inline_svg'; body: string }
  | { materialId: string; title: string; format: 'evidence_register'; entries: readonly unknown[] }

export type CompleteGameDocumentSubmission = {
  title: string
  executiveSummary: string
  sections: Array<{ sectionId: string; title: string; body: string }>
  productionMaterials: Material[]
  auditAppendix: {
    acceptanceCriteria: string[]
    upstreamReferences: Array<{ path: string; sectionId: string }>
    risks: Array<{ riskId: string; statement: string; mitigation: string; owner: string }>
    openDecisions: Array<{ decisionId: string; question: string; owner: string; neededBy: string }>
  }
}

/** Test-only fixture builder. Production has no structured document renderer. */
export function renderTestCompleteGameDocument(
  path: FoundationDocumentPath,
  value: CompleteGameDocumentSubmission,
): string {
  const lines = [
    `# ${value.title}`,
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    value.executiveSummary,
    '',
  ]
  for (const section of value.sections)
    lines.push(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      section.body,
      '',
    )
  lines.push('<!-- beegame-production-materials -->', '## Production Materials', '')
  for (const material of value.productionMaterials) {
    let body: string
    if (material.format === 'evidence_register')
      body = '| Evidence | Status |\n| --- | --- |\n| fixture | unverified |'
    else if (material.format === 'mermaid' && !material.body.includes('```mermaid'))
      body = `\`\`\`mermaid\n${material.body.trim()}\n\`\`\``
    else body = material.body
    lines.push(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      body,
      '',
    )
  }
  lines.push(
    '<!-- beegame-audit-appendix -->',
    '## Audit Appendix',
    '',
    '### Acceptance Criteria',
    '',
    ...value.auditAppendix.acceptanceCriteria.map(item => `- ${item}`),
    '',
  )
  return `${lines.join('\n').trim()}\n`
}

export function completeTestSubmission(
  path: FoundationDocumentPath,
): CompleteGameDocumentSubmission {
  const contract = { sections: [{ sectionId: 'design', title: 'Design' }], productionMaterials: [] as Array<{ materialId: string; title: string; format: Material['format'] }> }
  return {
    title: `Complete ${path}`,
    executiveSummary: 'This complete production document establishes actionable authority for the implementation team.',
    sections: contract.sections.map(section => ({
      sectionId: section.sectionId,
      title: section.title,
      body: `Production-ready ${section.title} authority with explicit implementation direction, ownership, constraints, and verification detail for the full game team.`,
    })),
    productionMaterials: contract.productionMaterials.map(material => ({
      materialId: material.materialId,
      title: material.title,
      format: material.format,
      ...(material.format === 'mermaid'
        ? { body: '```mermaid\ngraph TD\nA --> B\n```' }
        : material.format === 'inline_svg'
          ? { body: '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>' }
          : material.format === 'evidence_register'
            ? { entries: [{}] }
            : { body: '| Field | Value |\n| --- | --- |\n| authority | complete |' }),
    })) as Material[],
    auditAppendix: {
      acceptanceCriteria: ['The full production authority is actionable and mechanically verifiable.'],
      upstreamReferences: [],
      risks: [],
      openDecisions: [],
    },
  }
}
