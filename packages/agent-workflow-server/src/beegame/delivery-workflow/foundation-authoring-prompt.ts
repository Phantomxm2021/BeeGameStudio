import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath, type WorkerDispatchRequest } from './types'
import { foundationAuthoringDocumentContract, FOUNDATION_AUTHORING_INSTRUCTION } from './foundation-authoring-contract'

export function isFoundationAuthor(request: WorkerDispatchRequest): boolean {
  return request.workerType === 'document-author' && request.contract.documentSet === 'foundation' && ['initial', 'parallel-draft'].includes(String(request.contract.authoringMode))
}

export function buildFoundationAuthorPrompt(request: WorkerDispatchRequest): string {
  if (
    typeof request.contract.priorFailureReason === 'string'
  )
    throw new Error('foundation document author retry contract is removed')
  {
    const path = request.contract.foundationDocumentPath as FoundationDocumentPath
    if (!CANONICAL_FOUNDATION_DOCUMENTS.includes(path))
      throw new Error('foundation author requires a canonical document path')
    return [
      `Author exactly one complete raw Markdown body for ${path}.`,
      `Canonical Foundation documents: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}`,
      'Markdown cross-document references may use only these exact canonical Foundation paths.',
      'Confirmed Brief settings are higher authority than free-form idea text.',
      'Use the confirmed brief and committed upstream projection as authority. The dedicated Reviewer owns format, content and quality audit.',
      'Do not write frontmatter or beegame protocol comments; the service owns their injection. Do not call tools or create other documents.',
      FOUNDATION_AUTHORING_INSTRUCTION,
      formatContract({
        ...request,
        contract: {
          ...request.contract,
          completeDocumentContract: foundationAuthoringDocumentContract(path),
        },
      }),
    ].join('\n')
  }
}

function formatContract(request: WorkerDispatchRequest): string {
  const {
    confirmedBriefContext: _confirmedBriefContext,
    ...contractWithoutDuplicatedBrief
  } = request.contract
  const initialFoundationAuthor =
    request.workerType === 'document-author' &&
    request.contract.documentSet === 'foundation' &&
    ['initial', 'parallel-draft'].includes(
      String(request.contract.authoringMode),
    )
  if (initialFoundationAuthor) {
    delete contractWithoutDuplicatedBrief.availableUpstreamPaths
    const completeDocumentContract =
      contractWithoutDuplicatedBrief.completeDocumentContract
    if (
      completeDocumentContract &&
      typeof completeDocumentContract === 'object' &&
      !Array.isArray(completeDocumentContract)
    ) {
      const {
        allowedUpstreamPaths: _allowedUpstreamPaths,
        upstreamSections: _upstreamSections,
        sections,
        productionMaterials,
        ...authorDocumentContract
      } = completeDocumentContract as Record<string, unknown>
      contractWithoutDuplicatedBrief.completeDocumentContract = {
        ...authorDocumentContract,
        mechanicalMarkdownProtocol: {
          documentTitle: {
            position: 'first_non_blank_line',
            headingPrefix: '# ',
          },
          executiveSummary: {
            heading: '## Executive Summary',
          },
          sections: Array.isArray(sections)
            ? sections.map(value => {
                const section = value as Record<string, unknown>
                return {
                  ...section,
                  heading: `## ${section.title}`,
                }
              })
            : sections,
          productionMaterials: {
            heading: '## Production Materials',
            entries: Array.isArray(productionMaterials)
              ? productionMaterials.map(value => {
                  const material = value as Record<string, unknown>
                  const serialization = material.serialization
                  const serializationRule =
                    serialization === 'markdown_table'
                      ? 'Markdown table only: include a header row, a separator row, and data rows; do not use a fenced code block, YAML, JSON, or a key-value list.'
                      : serialization === 'mermaid'
                        ? 'Mermaid only: use one fenced ```mermaid block; do not replace it with prose, JSON, YAML, or a key-value list.'
                        : serialization === 'inline_svg'
                          ? 'Inline SVG only: use one inline <svg>...</svg> block; do not replace it with a fenced code block, JSON, YAML, or a key-value list.'
                          : undefined
                  return {
                    ...material,
                    heading: `### ${material.title}`,
                    ...(serializationRule ? { serializationRule } : {}),
                  }
                })
              : productionMaterials,
          },
          closedHeadingSet: [
            '## Executive Summary',
            ...(Array.isArray(sections)
              ? sections.map(value => `## ${(value as Record<string, unknown>).title}`)
              : []),
            '## Production Materials',
          ],
          additionalH2: 'forbidden',
          supportingContent: 'must be nested under one of the closed H2 headings',
        },
      }
    }
    if (request.contract.foundationDocumentPath !== 'docs/TECHNICAL_DESIGN.md')
      delete contractWithoutDuplicatedBrief.systemDeliveryContract
  }
  return JSON.stringify(contractWithoutDuplicatedBrief)
}
