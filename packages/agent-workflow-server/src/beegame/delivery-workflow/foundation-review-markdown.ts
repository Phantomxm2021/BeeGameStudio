import { fromMarkdown } from 'mdast-util-from-markdown'
import { toString } from 'mdast-util-to-string'
import { z } from 'zod'
import {
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import { foundationReviewConflictContentSchema } from './foundation-review'

type PhrasingContent = {
  type: string
  value?: string
  children?: PhrasingContent[]
}

type Content = {
  type: string
  children?: Content[]
  depth?: number
  ordered?: boolean | null
}

type Heading = Content & {
  type: 'heading'
  depth: number
  children: PhrasingContent[]
}
type Paragraph = Content & { type: 'paragraph'; children: PhrasingContent[] }
type List = Content & { type: 'list'; ordered: boolean; children: ListItem[] }
type ListItem = Content & { type: 'listItem'; children: Content[] }

const laneSchema = z.enum(['core-design', 'technical-assets', 'presentation'])
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export type FoundationReviewCandidate = z.infer<
  typeof foundationReviewConflictContentSchema
> & { reference: `${FoundationDocumentLaneId}:C${number}` }

export type FoundationReviewLaneReceipt = {
  revision: string
  lane: FoundationDocumentLaneId
  projectionDigest: string
  candidates: FoundationReviewCandidate[]
}

type ExpectedReceiptIdentity = {
  revision: string
  lane: FoundationDocumentLaneId
  projectionDigest: string
}

function fail(message: string): never {
  throw new Error(`foundation review lane Markdown ${message}`)
}

function phrasingText(node: { children: PhrasingContent[] }): string {
  return node.children
    .map(child =>
      child.type === 'inlineCode' ? `\`${toString(child)}\`` : toString(child),
    )
    .join('')
}

function headingText(node: Heading): string {
  return phrasingText(node)
}

function paragraphText(node: Paragraph): string {
  return phrasingText(node)
}

function isHeading(node: Content | undefined): node is Heading {
  return (
    node?.type === 'heading' &&
    typeof node.depth === 'number' &&
    !!node.children
  )
}

function isParagraph(node: Content | undefined): node is Paragraph {
  return node?.type === 'paragraph' && !!node.children
}

function looksLikeMarkdownTable(node: Content): boolean {
  if (!isParagraph(node)) return false
  const lines = paragraphText(node)
    .split('\n')
    .map(line => line.trim())
  for (let index = 1; index < lines.length; index += 1) {
    const header = lines[index - 1]
    const divider = lines[index]
    if (!header?.includes('|') || !divider?.includes('|')) continue
    let hasDash = false
    let isDivider = true
    for (const character of divider) {
      if (character === '-') hasDash = true
      else if (character !== '|' && character !== ':' && character !== ' ') {
        isDivider = false
        break
      }
    }
    if (hasDash && isDivider) return true
  }
  return false
}

function assertNoMarkdownTables(nodes: readonly Content[]): void {
  for (const node of nodes) {
    if (node.type === 'table' || looksLikeMarkdownTable(node))
      fail('tables are forbidden')
    if (node.children) assertNoMarkdownTables(node.children)
  }
}

function identityValue(
  node: Content | undefined,
  label: string,
  expected: string,
  mismatch: string,
): void {
  if (node?.type !== 'paragraph')
    fail(`${label.toLowerCase()} paragraph is invalid`)
  const paragraph = node as Paragraph
  const [prefix, value] = paragraph.children
  if (
    paragraph.children.length !== 2 ||
    prefix?.type !== 'text' ||
    prefix.value !== `${label}: ` ||
    value?.type !== 'inlineCode'
  )
    fail(`${label.toLowerCase()} paragraph is invalid`)
  if (toString(value) !== expected) fail(`${mismatch} does not match`)
}

function isCandidateReference(
  value: string,
  lane: FoundationDocumentLaneId,
): value is `${FoundationDocumentLaneId}:C${number}` {
  const prefix = `${lane}:C`
  if (!value.startsWith(prefix)) return false
  const suffix = value.slice(prefix.length)
  if (!suffix || suffix === '0' || suffix.startsWith('0')) return false
  for (const character of suffix)
    if (character < '0' || character > '9') return false
  return Number.isSafeInteger(Number(suffix))
}

function candidateHeading(
  node: Content | undefined,
  lane: FoundationDocumentLaneId,
): { reference: `${FoundationDocumentLaneId}:C${number}`; title: string } {
  if (node?.type !== 'heading' || node.depth !== 2)
    fail('candidate heading is invalid')
  const heading = node as Heading
  const [referenceNode, ...titleNodes] = heading.children
  if (referenceNode?.type !== 'inlineCode') fail('candidate heading is invalid')
  const reference = toString(referenceNode)
  const titleText = titleNodes
    .map(child =>
      child.type === 'inlineCode' ? `\`${toString(child)}\`` : toString(child),
    )
    .join('')
  if (!titleText.startsWith(' — ')) fail('candidate heading is invalid')
  if (!isCandidateReference(reference, lane))
    fail('candidate reference is outside lane authority')
  const title = titleText.slice(' — '.length).trim()
  if (!title) fail('candidate heading is invalid')
  return { reference, title }
}

function parseSingleParagraph(nodes: Content[], heading: string): string {
  if (nodes.length !== 1 || !isParagraph(nodes[0]))
    fail(`${heading} content is invalid`)
  const value = paragraphText(nodes[0]).trim()
  if (!value) fail(`${heading} content is invalid`)
  return value
}

function listItems(nodes: Content[], heading: string): ListItem[] {
  if (!nodes.length) fail(`${heading} list must not be empty`)
  if (nodes.length !== 1 || nodes[0]?.type !== 'list' || nodes[0].ordered)
    fail(`${heading} list is invalid`)
  const list = nodes[0] as List
  if (!list.children.length) fail(`${heading} list must not be empty`)
  return list.children
}

function itemLines(
  item: ListItem,
  heading: string,
  preserveInlineCode = false,
): string[] {
  if (item.children.length !== 1 || item.children[0]?.type !== 'paragraph')
    fail(`${heading} list item is invalid`)
  const paragraph = item.children[0] as Paragraph
  return (
    preserveInlineCode ? paragraphText(paragraph) : toString(paragraph)
  ).split('\n')
}

function labeledFields(
  item: ListItem,
  heading: string,
  labels: readonly string[],
  preserveInlineCode = false,
): Record<string, string> {
  const fields: Record<string, string> = {}
  let activeLabel: string | undefined
  for (const originalLine of itemLines(item, heading, preserveInlineCode)) {
    const line = originalLine.trimStart()
    const label = labels.find(candidate => line.startsWith(`${candidate}: `))
    if (label) {
      if (label !== labels[Object.keys(fields).length])
        fail(`${heading} list item is invalid`)
      fields[label] = line.slice(label.length + 2)
      activeLabel = label
      continue
    }
    if (!activeLabel) fail(`${heading} list item is invalid`)
    fields[activeLabel] += `\n${line}`
  }
  if (labels.some(label => !fields[label]?.trim()))
    fail(`${heading} list item is invalid`)
  return fields
}

function parseEvidence(nodes: Content[]): Array<{
  path: string
  location: string
  observed: string
}> {
  return listItems(nodes, 'Evidence').map(item => {
    const fields = labeledFields(item, 'Evidence', [
      'Path',
      'Location',
      'Observed',
    ])
    const displayedFields = labeledFields(
      item,
      'Evidence',
      ['Path', 'Location', 'Observed'],
      true,
    )
    return {
      path: fields.Path!.trim(),
      location: fields.Location!.trim(),
      observed: displayedFields.Observed!.trim(),
    }
  })
}

function parseChanges(
  nodes: Content[],
): Array<{ path: string; action: string }> {
  return listItems(nodes, 'Changes').map(item => {
    const fields = labeledFields(item, 'Changes', ['Path', 'Action'])
    return { path: fields.Path!.trim(), action: fields.Action!.trim() }
  })
}

function parseAcceptance(nodes: Content[]): string[] {
  return listItems(nodes, 'Acceptance').map(item => {
    const lines = itemLines(item, 'Acceptance')
    const value = lines
      .map(line => line.trimStart())
      .join('\n')
      .trim()
    if (!value) fail('Acceptance list item is invalid')
    return value
  })
}

function assertLaneAuthority(
  candidate: {
    evidence: Array<{ path: string }>
    changes: Array<{ path: string }>
  },
  lane: FoundationDocumentLaneId,
): void {
  const ownedPaths = new Set(foundationDocumentLaneById(lane).ownedPaths)
  for (const evidence of candidate.evidence ?? [])
    if (!ownedPaths.has(evidence.path as never))
      fail('evidence path is outside lane authority')
  for (const change of candidate.changes ?? [])
    if (!ownedPaths.has(change.path as never))
      fail('change path is outside lane authority')
}

function parseCandidate(
  nodes: Content[],
  start: number,
  lane: FoundationDocumentLaneId,
): { candidate: FoundationReviewCandidate; next: number } {
  const { reference, title } = candidateHeading(nodes[start], lane)
  const expectedHeadings = [
    'Problem',
    'Evidence',
    'Required outcome',
    'Changes',
    'Acceptance',
  ]
  const sections = new Map<string, Content[]>()
  let index = start + 1
  for (const expectedHeading of expectedHeadings) {
    const heading = nodes[index]
    if (
      !isHeading(heading) ||
      heading.depth !== 3 ||
      headingText(heading) !== expectedHeading
    )
      fail('candidate headings are invalid')
    index += 1
    const contentStart = index
    while (
      index < nodes.length &&
      !(
        nodes[index]?.type === 'heading' && (nodes[index] as Heading).depth <= 3
      )
    )
      index += 1
    sections.set(expectedHeading, nodes.slice(contentStart, index))
  }
  const raw = {
    title,
    problem: parseSingleParagraph(sections.get('Problem')!, 'Problem'),
    evidence: parseEvidence(sections.get('Evidence')!),
    requiredOutcome: parseSingleParagraph(
      sections.get('Required outcome')!,
      'Required outcome',
    ),
    changes: parseChanges(sections.get('Changes')!),
    acceptance: parseAcceptance(sections.get('Acceptance')!),
  }
  assertLaneAuthority(raw, lane)
  return {
    candidate: {
      reference,
      ...foundationReviewConflictContentSchema.parse(raw),
    },
    next: index,
  }
}

export function parseFoundationReviewLaneMarkdown(
  markdown: string,
  expected: ExpectedReceiptIdentity,
): FoundationReviewLaneReceipt {
  laneSchema.parse(expected.lane)
  digestSchema.parse(expected.revision)
  digestSchema.parse(expected.projectionDigest)
  const tree = fromMarkdown(markdown)
  const nodes = tree.children as unknown as Content[]
  assertNoMarkdownTables(nodes)
  const h1 = nodes[0]
  if (
    !isHeading(h1) ||
    h1.depth !== 1 ||
    headingText(h1) !== 'Foundation Review Packet'
  )
    fail('requires exactly one H1 Foundation Review Packet')
  if (
    nodes.filter(node => node.type === 'heading' && node.depth === 1).length !==
    1
  )
    fail('requires exactly one H1 Foundation Review Packet')
  identityValue(nodes[1], 'Revision', expected.revision, 'revision')
  identityValue(nodes[2], 'Lane', expected.lane, 'lane')
  identityValue(
    nodes[3],
    'Projection',
    expected.projectionDigest,
    'projection digest',
  )

  const candidates: FoundationReviewCandidate[] = []
  let index = 4
  while (index < nodes.length) {
    if (
      nodes[index]?.type !== 'heading' ||
      (nodes[index] as Heading).depth !== 2
    )
      fail('candidate heading is invalid')
    const parsed = parseCandidate(nodes, index, expected.lane)
    if (
      candidates.some(
        candidate => candidate.reference === parsed.candidate.reference,
      )
    )
      fail('candidate references must be unique')
    candidates.push(parsed.candidate)
    if (candidates.length > 8) fail('contains more than 8 candidates')
    index = parsed.next
  }
  return {
    revision: expected.revision,
    lane: expected.lane,
    projectionDigest: expected.projectionDigest,
    candidates,
  }
}

export function foundationReviewLaneMarkdownInstruction(
  expected: ExpectedReceiptIdentity,
): string {
  laneSchema.parse(expected.lane)
  const ownedPaths = foundationDocumentLaneById(expected.lane).ownedPaths.join(
    ', ',
  )
  return [
    'Return exactly one Foundation Review Packet Markdown receipt and nothing else.',
    'Markdown tables are forbidden. Use only the headings, paragraphs, and unordered lists in this grammar.',
    '# Foundation Review Packet',
    `Revision: \`${expected.revision}\``,
    `Lane: \`${expected.lane}\``,
    `Projection: \`${expected.projectionDigest}\``,
    '## `<lane>:C1` — `<title>`',
    '### Problem',
    '<problem>',
    '### Evidence',
    '- Path: `<lane-owned-canonical-path>`',
    '  Location: `<stable-location>`',
    '  Observed: `<bounded-observation>`',
    '### Required outcome',
    '<one unambiguous outcome>',
    '### Changes',
    '- Path: `<lane-owned-canonical-path>`',
    '  Action: `<required action>`',
    '### Acceptance',
    '- `<mechanically-checkable condition>`',
    `Every evidence and change path must be one of: ${ownedPaths}. Report at most 8 candidates; candidate references must be unique.`,
  ].join('\n\n')
}
