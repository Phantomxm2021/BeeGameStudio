import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { z } from 'zod/v4'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENT_IDS,
  type FoundationDocumentPath,
} from './delivery-workflow/types'
import {
  canonicalDocumentEvidenceEntries,
  documentEvidenceEntrySchema,
  renderDocumentEvidenceRegister,
  validateDocumentEvidenceEntries,
} from './document-evidence'
import {
  authoritySidecarPath,
  validateFoundationAuthoritySidecar,
  type FoundationAuthoritySidecar,
} from './foundation-authority-sidecar'

const upstreamReferenceSchema = z
  .object({
    path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    authorityId: z.string().trim().min(1),
  })
  .strict()

const riskSchema = z
  .object({
    riskId: z.string().trim().min(1),
    statement: z.string().trim().min(1),
    mitigation: z.string().trim().min(1),
    owner: z.string().trim().min(1),
  })
  .strict()

const openDecisionSchema = z
  .object({
    decisionId: z
      .string()
      .trim()
      .min(1)
      .describe(
        'Exact future authorityId in <document-id>.<sectionId>.<suffix> form; the deferred open_decision record must reuse it unchanged.',
      ),
    question: z.string().trim().min(1),
    owner: z.string().trim().min(1),
    neededBy: z.string().trim().min(1),
    scheduleAuthorityId: z
      .string()
      .trim()
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/)
      .optional(),
  })
  .strict()

export const completeGameDocumentSectionSchema = z
  .object({
    sectionId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    body: z.string().trim().min(1),
  })
  .strict()

const authoredProductionMaterialSchema = z
  .object({
    materialId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    format: z.enum(['markdown_table', 'mermaid', 'inline_svg']),
    body: z.string().trim().min(1),
  })
  .strict()

const evidenceRegisterMaterialSchema = z
  .object({
    materialId: z.string().trim().min(1),
    title: z.string().trim().min(1),
    format: z.literal('evidence_register'),
    entries: z.array(documentEvidenceEntrySchema).min(1),
  })
  .strict()

export const productionMaterialSchema = z.discriminatedUnion('format', [
  authoredProductionMaterialSchema,
  evidenceRegisterMaterialSchema,
])

export const completeGameDocumentSubmissionSchema = z
  .object({
    title: z.string().trim().min(1),
    executiveSummary: z.string().trim().min(1),
    sections: z.array(completeGameDocumentSectionSchema).min(1),
    productionMaterials: z.array(productionMaterialSchema).min(1),
    auditAppendix: z
      .object({
        acceptanceCriteria: z.array(z.string().trim().min(1)).min(1),
        upstreamReferences: z.array(upstreamReferenceSchema),
        risks: z.array(riskSchema),
        openDecisions: z.array(openDecisionSchema),
      })
      .strict(),
  })
  .strict()

export const completeGameDocumentAuditAppendixSchema =
  completeGameDocumentSubmissionSchema.shape.auditAppendix

export type CompleteGameDocumentSubmission = z.infer<
  typeof completeGameDocumentSubmissionSchema
>

type AuthoredProductionMaterial = Extract<
  CompleteGameDocumentSubmission['productionMaterials'][number],
  { body: string }
>
type InlineSvgProductionMaterial = AuthoredProductionMaterial & {
  format: 'inline_svg'
}

export type CompleteGameDocumentAuditAppendix = z.infer<
  typeof completeGameDocumentAuditAppendixSchema
>

export type UpstreamAuthorityReference = z.infer<
  typeof upstreamReferenceSchema
>

export type CompleteGameDocumentArtifact = Readonly<{
  artifactId: string
  path: string
  mediaType: 'image/svg+xml'
  digest: string
  content: string
}>

function bytewise(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left), Buffer.from(right))
}

function normalizedHeading(text: string): string {
  return text.normalize('NFKC').trim().replaceAll(/\s+/g, ' ').toLowerCase()
}

function authoredHeadings(markdown: string): Array<{ level: number; text: string }> {
  const headings: Array<{ level: number; text: string }> = []
  let fence: string | undefined
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trimStart()
    if (line.startsWith('```') || line.startsWith('~~~')) {
      const marker = line.slice(0, 3)
      fence = fence === undefined ? marker : fence === marker ? undefined : fence
      continue
    }
    if (fence) continue
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) headings.push({ level: match[1]!.length, text: match[2]! })
  }
  return headings
}

export function validateSectionHeadingStructure(
  sections: readonly { sectionId: string; body: string }[],
): void {
  const seen = new Set<string>()
  for (const section of sections) {
    let priorLevel = 2
    for (const heading of authoredHeadings(section.body)) {
      if (heading.level < 3 || heading.level > 4)
        throw new Error(
          `section heading level is invalid: ${section.sectionId}:H${heading.level}`,
        )
      if (heading.level > priorLevel + 1)
        throw new Error(
          `section heading level is skipped: ${section.sectionId}:H${heading.level}`,
        )
      const normalized = normalizedHeading(heading.text)
      if (seen.has(normalized))
        throw new Error(`section heading is duplicated: ${heading.text}`)
      seen.add(normalized)
      priorLevel = heading.level
    }
  }
}

function headingAnchor(title: string): string {
  return title
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{Letter}\p{Number}\s-]/gu, '')
    .replaceAll(/\s+/g, '-')
    .replaceAll(/-+/g, '-')
}

function renderCanonicalTableOfContents(
  path: FoundationDocumentPath,
): readonly string[] {
  const contract = getGameDocumentContract(path)
  const headings = [
    'Executive Summary',
    ...contract.sections.map(section => section.title),
    'Production Materials',
    'Audit Appendix',
  ]
  return [
    '## Table of Contents',
    '',
    ...headings.map(title => `- [${title}](#${headingAnchor(title)})`),
    '',
  ]
}

function documentArtifactSlug(path: FoundationDocumentPath): string {
  return CANONICAL_PROJECT_DOCUMENT_IDS[path]
    .toLowerCase()
    .replaceAll('_', '-')
}

export function completeGameDocumentArtifactPath(
  path: FoundationDocumentPath,
  materialId: string,
): string {
  return `docs/artifacts/${documentArtifactSlug(path)}/${materialId}.svg`
}

export function prepareCompleteGameDocumentArtifacts(
  path: FoundationDocumentPath,
  value: CompleteGameDocumentSubmission,
): readonly CompleteGameDocumentArtifact[] {
  const parsed = validateCompleteGameDocumentSubmission(path, value)
  return Object.freeze(
    parsed.productionMaterials
      .filter(
        (material): material is InlineSvgProductionMaterial =>
          material.format === 'inline_svg',
      )
      .map(material => {
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(material.materialId))
          throw new Error(`production material artifact ID is unsafe: ${material.materialId}`)
        const content = `${material.body.trim()}\n`
        return Object.freeze({
          artifactId: material.materialId,
          path: completeGameDocumentArtifactPath(path, material.materialId),
          mediaType: 'image/svg+xml' as const,
          digest: createHash('sha256').update(content).digest('hex'),
          content,
        })
      }),
  )
}

function externalArtifactReference(
  path: FoundationDocumentPath,
  material: AuthoredProductionMaterial,
): string {
  if (material.format !== 'inline_svg')
    throw new Error(`production material is not an SVG artifact: ${material.materialId}`)
  const contract = getGameDocumentContract(path).productionMaterials.find(
    candidate => candidate.materialId === material.materialId,
  )!
  return [
    `![${material.title}](artifacts/${documentArtifactSlug(path)}/${material.materialId}.svg)`,
    '',
    `- Artifact ID: \`${material.materialId}\``,
    `- Contract purpose: ${contract.purpose}`,
  ].join('\n')
}

export async function resolveUpstreamAuthorityReferences(input: {
  workspacePath: string
  targetPath: FoundationDocumentPath
  references: readonly unknown[]
}): Promise<readonly UpstreamAuthorityReference[]> {
  const references = z.array(upstreamReferenceSchema).parse(input.references)
  const contract = getGameDocumentContract(input.targetPath)
  const allowedPaths = new Set(contract.allowedUpstreamPaths)
  const keys = references.map(
    reference => `${reference.path}\u0000${reference.authorityId}`,
  )
  if (new Set(keys).size !== keys.length)
    throw new Error('upstream authority references are duplicated')

  for (const reference of references) {
    if (!allowedPaths.has(reference.path))
      throw new Error(
        `upstream authority path is not allowed for ${input.targetPath}: ${reference.path}`,
      )
    let markdown: string
    let rawSidecar: string
    try {
      ;[markdown, rawSidecar] = await Promise.all([
        readFile(resolve(input.workspacePath, reference.path), 'utf8'),
        readFile(
          resolve(input.workspacePath, authoritySidecarPath(reference.path)),
          'utf8',
        ),
      ])
    } catch {
      throw new Error(
        `upstream authority source is missing: ${reference.path} — ${reference.authorityId}`,
      )
    }
    let storedSidecar: unknown
    try {
      storedSidecar = JSON.parse(rawSidecar)
    } catch {
      throw new Error(
        `upstream authority sidecar is invalid: ${reference.path} — ${reference.authorityId}`,
      )
    }
    const sidecar = validateFoundationAuthoritySidecar({
      documentPath: reference.path,
      markdown,
      value: storedSidecar,
    })
    if (
      !sidecar.records.some(record => record.authorityId === reference.authorityId)
    )
      throw new Error(
        `upstream authority ID does not exist: ${reference.path} — ${reference.authorityId}`,
      )
  }

  return Object.freeze(
    [...references]
      .sort((left, right) =>
        bytewise(
          `${left.path}\u0000${left.authorityId}`,
          `${right.path}\u0000${right.authorityId}`,
        ),
      )
      .map(reference => Object.freeze({ ...reference })),
  )
}

export function assertOpenDecisionClosure(input: {
  audit: CompleteGameDocumentAuditAppendix
  authority: FoundationAuthoritySidecar
  trustedScheduleAuthorityIds: ReadonlySet<string>
}): void {
  const auditById = new Map(
    input.audit.openDecisions.map(decision => [decision.decisionId, decision]),
  )
  const authorityDecisions = input.authority.records.filter(
    record => record.kind === 'open_decision',
  )
  const authorityById = new Map(
    authorityDecisions.map(record => [record.authorityId, record]),
  )
  if (
    auditById.size !== input.audit.openDecisions.length ||
    authorityById.size !== authorityDecisions.length
  )
    throw new Error('open decision closure contains duplicate IDs')
  const auditIds = [...auditById.keys()].sort(bytewise)
  const authorityIds = [...authorityById.keys()].sort(bytewise)
  if (
    auditIds.length !== authorityIds.length ||
    auditIds.some((authorityId, index) => authorityIds[index] !== authorityId)
  )
    throw new Error('audit and authority open decision closure does not match')

  for (const decisionId of auditIds) {
    const auditDecision = auditById.get(decisionId)!
    const authorityRecord = authorityById.get(decisionId)!
    if (authorityRecord.state !== 'deferred' || !authorityRecord.decision)
      throw new Error(`open decision authority is not deferred: ${decisionId}`)
    if (auditDecision.owner !== authorityRecord.decision.owner)
      throw new Error(`open decision owner does not match authority: ${decisionId}`)
    if (auditDecision.neededBy !== authorityRecord.decision.neededBy)
      throw new Error(
        `open decision needed-by does not match authority: ${decisionId}`,
      )
    const concreteDate = /^\d{4}-\d{2}-\d{2}(?:$|T)/.test(
      auditDecision.neededBy,
    )
    if (
      concreteDate &&
      (!auditDecision.scheduleAuthorityId ||
        !input.trustedScheduleAuthorityIds.has(
          auditDecision.scheduleAuthorityId,
        ))
    )
      throw new Error(
        `open decision concrete date requires trusted schedule authority: ${decisionId}`,
      )
  }
}

function assertExactOrder(
  actual: readonly string[],
  expected: readonly string[],
  label: string,
  path: FoundationDocumentPath,
): void {
  if (
    actual.length !== expected.length ||
    expected.some((value, index) => actual[index] !== value)
  )
    throw new Error(`${label} must exactly match the canonical order for ${path}`)
}

function assertUniqueIds(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length)
    throw new Error(`${label} IDs are duplicated`)
}

function assertMaterialFormat(
  format: 'markdown_table' | 'mermaid' | 'inline_svg' | 'evidence_register',
  body: string,
  materialId: string,
  allowExternalSvg = false,
): void {
  const lines = body.split('\n').map(line => line.trim())
  const valid =
    format === 'markdown_table' || format === 'evidence_register'
      ? lines.filter(line => line.startsWith('|') && line.endsWith('|')).length >= 3 &&
        lines.some(line => line.includes('---'))
      : format === 'mermaid'
        ? lines.includes('```mermaid') && lines.includes('```')
        : ((body.includes('<svg ') || body.includes('<svg>')) &&
            body.includes('</svg>')) ||
          (allowExternalSvg &&
            body.includes(`/${materialId}.svg)`) &&
            !body.includes('<svg'))
  if (!valid)
    throw new Error(`production material format is invalid: ${materialId}:${format}`)
}

export function validateCompleteGameDocumentSubmission(
  path: FoundationDocumentPath,
  value: unknown,
): CompleteGameDocumentSubmission {
  const submitted = completeGameDocumentSubmissionSchema.parse(value)
  const parsed: CompleteGameDocumentSubmission = {
    ...submitted,
    auditAppendix: {
      ...submitted.auditAppendix,
      upstreamReferences: [...submitted.auditAppendix.upstreamReferences].sort(
        (left, right) =>
          bytewise(
            `${left.path}\u0000${left.authorityId}`,
            `${right.path}\u0000${right.authorityId}`,
          ),
      ),
    },
    productionMaterials: submitted.productionMaterials.map(material =>
      material.format === 'evidence_register'
        ? {
            ...material,
            entries: canonicalDocumentEvidenceEntries(material.entries).map(
              entry => ({
                ...entry,
                evidenceRefs: entry.evidenceRefs.map(reference => ({
                  ...reference,
                })),
              }),
            ),
          }
        : {
            ...material,
            body:
              material.format === 'mermaid' &&
              !material.body
                .split('\n')
                .some(line => line.trim() === '```mermaid')
                ? `\`\`\`mermaid\n${material.body.trim()}\n\`\`\``
                : material.body,
          },
    ),
  }
  const contract = getGameDocumentContract(path)
  assertExactOrder(
    parsed.sections.map(section => section.sectionId),
    contract.sections.map(section => section.sectionId),
    'complete game document sections',
    path,
  )
  assertExactOrder(
    parsed.productionMaterials.map(material => material.materialId),
    contract.productionMaterials.map(material => material.materialId),
    'complete game document production materials',
    path,
  )

  parsed.sections.forEach((section, index) => {
    if (section.title !== contract.sections[index]?.title)
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)
  })
  validateSectionHeadingStructure(parsed.sections)
  parsed.productionMaterials.forEach((material, index) => {
    const expected = contract.productionMaterials[index]
    if (material.title !== expected?.title || material.format !== expected.format)
      throw new Error(`production material contract is invalid: ${material.materialId}`)
    if (material.format !== 'evidence_register')
      assertMaterialFormat(material.format, material.body, material.materialId)
  })

  const allowedUpstreamPaths = new Set(contract.allowedUpstreamPaths)
  assertUniqueIds(
    parsed.auditAppendix.upstreamReferences.map(
      reference => `${reference.path}\u0000${reference.authorityId}`,
    ),
    'upstream authority reference',
  )
  if (
    parsed.auditAppendix.upstreamReferences.some(
      reference => !allowedUpstreamPaths.has(reference.path),
    )
  )
    throw new Error(`upstream authority reference is not allowed for ${path}`)
  assertUniqueIds(
    parsed.auditAppendix.risks.map(risk => risk.riskId),
    'risk',
  )
  assertUniqueIds(
    parsed.auditAppendix.openDecisions.map(decision => decision.decisionId),
    'open decision',
  )
  const authorityPrefix = `${CANONICAL_PROJECT_DOCUMENT_IDS[path].toLowerCase()}.`
  for (const decision of parsed.auditAppendix.openDecisions) {
    const ownsCanonicalSection = contract.sections.some(section =>
      decision.decisionId.startsWith(
        `${authorityPrefix}${section.sectionId}.`,
      ),
    )
    if (!ownsCanonicalSection)
      throw new Error(
        `open decision ID must use ${authorityPrefix}<sectionId>.<suffix>: ${decision.decisionId}`,
      )
  }
  return parsed
}

export async function validateCompleteGameDocumentEvidence(
  workspacePath: string,
  path: FoundationDocumentPath,
  value: unknown,
): Promise<CompleteGameDocumentSubmission> {
  const parsed = validateCompleteGameDocumentSubmission(path, value)
  for (const material of parsed.productionMaterials) {
    if (material.format !== 'evidence_register') continue
    await validateDocumentEvidenceEntries({
      workspacePath,
      entries: material.entries,
    })
  }
  const upstreamReferences = await resolveUpstreamAuthorityReferences({
    workspacePath,
    targetPath: path,
    references: parsed.auditAppendix.upstreamReferences,
  })
  return {
    ...parsed,
    auditAppendix: {
      ...parsed.auditAppendix,
      upstreamReferences: upstreamReferences.map(reference => ({
        ...reference,
      })),
    },
  }
}

export function renderCompleteGameDocument(
  path: FoundationDocumentPath,
  value: CompleteGameDocumentSubmission,
): string {
  const parsed = validateCompleteGameDocumentSubmission(path, value)
  const lines: string[] = [
    `# ${parsed.title}`,
    '',
    ...renderCanonicalTableOfContents(path),
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    '',
    parsed.executiveSummary,
    '',
  ]
  for (const section of parsed.sections)
    lines.push(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      '',
      section.body,
      '',
    )

  lines.push(
    '<!-- beegame-production-materials -->',
    '## Production Materials',
    '',
  )
  for (const material of parsed.productionMaterials)
    lines.push(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
      '',
      material.format === 'evidence_register'
        ? renderDocumentEvidenceRegister(material.entries)
        : material.format === 'inline_svg'
          ? externalArtifactReference(path, material)
          : material.body,
      '',
    )

  lines.push(
    '<!-- beegame-audit-appendix -->',
    '## Audit Appendix',
    '',
    '### Acceptance Criteria',
    '',
    ...parsed.auditAppendix.acceptanceCriteria.map(item => `- ${item}`),
    '',
  )
  if (parsed.auditAppendix.upstreamReferences.length)
    lines.push(
      '### Upstream Authority',
      '',
      ...parsed.auditAppendix.upstreamReferences.map(
        reference => `- \`${reference.path}\` — \`${reference.authorityId}\``,
      ),
      '',
    )
  if (parsed.auditAppendix.risks.length)
    lines.push(
      '### Risks',
      '',
      ...parsed.auditAppendix.risks.map(
        risk =>
          `- **${risk.riskId}** — ${risk.statement}; mitigation: ${risk.mitigation}; owner: ${risk.owner}`,
      ),
      '',
    )
  if (parsed.auditAppendix.openDecisions.length)
    lines.push(
      '### Open Decisions',
      '',
      ...parsed.auditAppendix.openDecisions.map(
        decision =>
          `- **${decision.decisionId}** — ${decision.question}; owner: ${decision.owner}; needed by: ${decision.neededBy}`,
      ),
      '',
    )
  return `${lines.join('\n').trim()}\n`
}

export function completeGameDocumentSectionMarkers(
  path: FoundationDocumentPath,
): readonly string[] {
  return getGameDocumentContract(path).sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
}

function substantiveContentBlocks(lines: readonly string[]): string[] {
  const blocks: string[] = []
  let current: string[] = []
  const flush = () => {
    const normalized = current.map(line => line.trim()).join(' ').trim()
    current = []
    if (normalized.length >= 160) blocks.push(normalized)
  }
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    if (trimmed.startsWith('#') || trimmed.startsWith('<!--') || trimmed === '---') {
      flush()
      continue
    }
    current.push(trimmed)
  }
  flush()
  return blocks
}

const EMPTY_TEMPLATE_SENTENCES = [
  'No upstream authority; this section is an original fact owner.',
  'No known section-specific risks.',
  'No unresolved section decisions.',
] as const

function markerIndex(lines: readonly string[], marker: string): number {
  return lines.indexOf(marker)
}

function assertNonEmptyRange(
  lines: readonly string[],
  start: number,
  end: number,
  label: string,
): void {
  if (start < 0 || end <= start || !lines.slice(start + 1, end).some(line => line.trim()))
    throw new Error(`complete game document ${label} is empty or invalid`)
}

/** Validate the compact Markdown transport used by real document workers. */
export function validateCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
): string {
  const body = z.string().trim().min(1).parse(value)
  const lines = body.split('\n').map(line => line.trimEnd())
  if (!lines[0]?.startsWith('# ') || lines[0].startsWith('## '))
    throw new Error('complete game document requires one document title')
  if (EMPTY_TEMPLATE_SENTENCES.some(sentence => body.includes(sentence)))
    throw new Error('complete game document contains an empty template sentence')

  const blocks = substantiveContentBlocks(lines)
  if (new Set(blocks).size !== blocks.length)
    throw new Error('complete game document repeats a substantive content block')

  const contract = getGameDocumentContract(path)
  const summaryMarker = '<!-- beegame-executive-summary -->'
  const productionMarker = '<!-- beegame-production-materials -->'
  const auditMarker = '<!-- beegame-audit-appendix -->'
  const sectionMarkers = contract.sections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  const materialMarkers = contract.productionMaterials.map(
    material => `<!-- beegame-material:${material.materialId} -->`,
  )
  const actualSectionMarkers = lines.filter(line => line.startsWith('<!-- beegame-section:'))
  const actualMaterialMarkers = lines.filter(line => line.startsWith('<!-- beegame-material:'))
  assertExactOrder(actualSectionMarkers, sectionMarkers, 'complete game document sections', path)
  assertExactOrder(actualMaterialMarkers, materialMarkers, 'complete game document production materials', path)

  const summaryIndex = markerIndex(lines, summaryMarker)
  const productionIndex = markerIndex(lines, productionMarker)
  const auditIndex = markerIndex(lines, auditMarker)
  const sectionIndexes = sectionMarkers.map(marker => markerIndex(lines, marker))
  const materialIndexes = materialMarkers.map(marker => markerIndex(lines, marker))
  const orderedIndexes = [summaryIndex, ...sectionIndexes, productionIndex, ...materialIndexes, auditIndex]
  if (orderedIndexes.some(index => index < 0) || orderedIndexes.some((index, offset) => offset > 0 && index <= orderedIndexes[offset - 1]!))
    throw new Error(`complete game document structure must exactly match the canonical order for ${path}`)

  if (lines[summaryIndex + 1] !== '## Executive Summary')
    throw new Error('complete game document executive summary heading is invalid')
  assertNonEmptyRange(lines, summaryIndex + 1, sectionIndexes[0]!, 'executive summary')

  contract.sections.forEach((section, index) => {
    const start = sectionIndexes[index]!
    const end = sectionIndexes[index + 1] ?? productionIndex
    if (lines[start + 1] !== `## ${section.title}`)
      throw new Error(`complete game document section title is invalid: ${section.sectionId}`)
    assertNonEmptyRange(lines, start + 1, end, `section:${section.sectionId}`)
  })
  validateSectionHeadingStructure(
    contract.sections.map((section, index) => {
      const start = sectionIndexes[index]!
      const end = sectionIndexes[index + 1] ?? productionIndex
      return {
        sectionId: section.sectionId,
        body: lines.slice(start + 2, end).join('\n'),
      }
    }),
  )

  if (lines[productionIndex + 1] !== '## Production Materials')
    throw new Error('complete game document production materials heading is invalid')
  contract.productionMaterials.forEach((material, index) => {
    const start = materialIndexes[index]!
    const end = materialIndexes[index + 1] ?? auditIndex
    if (lines[start + 1] !== `### ${material.title}`)
      throw new Error(`production material title is invalid: ${material.materialId}`)
    const materialBody = lines.slice(start + 2, end).join('\n').trim()
    assertMaterialFormat(
      material.format,
      materialBody,
      material.materialId,
      true,
    )
  })

  if (lines[auditIndex + 1] !== '## Audit Appendix')
    throw new Error('complete game document audit appendix heading is invalid')
  const acceptanceIndex = lines.indexOf('### Acceptance Criteria', auditIndex + 1)
  const acceptanceLines = lines.slice(acceptanceIndex + 1)
  const hasAcceptanceList = acceptanceLines.some(line =>
    line.trim().startsWith('- '),
  )
  const acceptanceTableLines = acceptanceLines.filter(line => {
    const trimmed = line.trim()
    return trimmed.startsWith('|') && trimmed.endsWith('|')
  })
  const hasAcceptanceTable =
    acceptanceTableLines.length >= 3 &&
    acceptanceTableLines.some(line => line.includes('---'))
  if (
    acceptanceIndex < auditIndex ||
    (!hasAcceptanceList && !hasAcceptanceTable)
  )
    throw new Error('complete game document acceptance criteria are empty or invalid')
  return `${body}\n`
}

export function canonicalizeCompleteGameDocumentMarkdown(
  path: FoundationDocumentPath,
  value: unknown,
  metadata: { version: string; updatedAt: string },
): string {
  const authored = z.string().trim().min(1).parse(value)
  const lines = authored.split('\n')
  const bodyStart =
    lines[0]?.trim() === '---'
      ? lines.findIndex((line, index) => index > 0 && line.trim() === '---') + 1
      : 0
  if (bodyStart === 0 && lines[0]?.trim() === '---')
    throw new Error('complete game document front matter is incomplete')
  const bodyLines = lines.slice(bodyStart)
  const contract = getGameDocumentContract(path)
  const canonicalMarkers = new Map<string, string>([
    ...contract.sections.map(
      section =>
        [
          `beegame-section:${section.sectionId}`,
          `<!-- beegame-section:${section.sectionId} -->`,
        ] as const,
    ),
    ...contract.productionMaterials.map(
      material =>
        [
          `beegame-material:${material.materialId}`,
          `<!-- beegame-material:${material.materialId} -->`,
        ] as const,
    ),
  ])
  for (let index = 0; index < bodyLines.length; index += 1) {
    const line = bodyLines[index]!.trim()
    if (!line.startsWith('<!--') || !line.endsWith('-->')) continue
    const inner = line.slice('<!--'.length, -'-->'.length).trim()
    const separator = inner.indexOf(':')
    if (separator < 0) continue
    const key = `${inner.slice(0, separator).trim()}:${inner
      .slice(separator + 1)
      .trim()}`
    const canonical = canonicalMarkers.get(key)
    if (canonical) bodyLines[index] = canonical
  }
  const normalizeMarkerHeading = (
    marker: string,
    heading: string,
    acceptLocalizedHeading = false,
  ) => {
    const markerIndex = bodyLines.findIndex(line => line.trim() === marker)
    if (markerIndex < 0) return
    const headingIndex = bodyLines.findIndex(
      (line, index) => index > markerIndex && line.trim().length > 0,
    )
    if (headingIndex <= markerIndex) return
    const authoredHeading = bodyLines[headingIndex]!.trim()
    if (authoredHeading !== heading && !(acceptLocalizedHeading && authoredHeading.startsWith('## ')))
      return
    bodyLines.splice(markerIndex + 1, headingIndex - markerIndex, heading)
  }
  for (const [marker, heading] of [
    ['<!-- beegame-executive-summary -->', '## Executive Summary'],
    ['<!-- beegame-production-materials -->', '## Production Materials'],
    ['<!-- beegame-audit-appendix -->', '## Audit Appendix'],
  ] as const) {
    normalizeMarkerHeading(marker, heading, true)
  }
  for (const section of contract.sections)
    normalizeMarkerHeading(
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
    )
  for (const material of contract.productionMaterials)
    normalizeMarkerHeading(
      `<!-- beegame-material:${material.materialId} -->`,
      `### ${material.title}`,
    )
  const body = validateCompleteGameDocumentMarkdown(
    path,
    bodyLines.join('\n').trimStart(),
  )
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[path]
  return [
    '---',
    `document_id: ${documentId}`,
    `version: ${metadata.version}`,
    `updated_at: ${metadata.updatedAt}`,
    '---',
    body.trimEnd(),
    '',
  ].join('\n')
}
