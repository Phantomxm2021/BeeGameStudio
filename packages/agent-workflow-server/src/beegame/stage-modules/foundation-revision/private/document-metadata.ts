import { z } from 'zod/v4'

type RevisionDocumentMetadata = Readonly<{
  version: string
  updatedAt: string
}>

const updatedAtSchema = z.string().datetime({ offset: true })

function parseVersion(value: string): [number, number, number] {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('Revision document version is invalid')
  const numbers = parts.map(Number)
  if (numbers.some((part, index) =>
    !Number.isSafeInteger(part) || part < 0 || String(part) !== parts[index]))
    throw new Error('Revision document version is invalid')
  return [numbers[0]!, numbers[1]!, numbers[2]!]
}

function frontMatter(markdown: string): { lines: string[]; closingIndex: number } {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---')
    throw new Error('Revision document front matter is missing')
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 1)
    throw new Error('Revision document front matter is invalid')
  return { lines, closingIndex }
}

function parseMetadata(markdown: string): RevisionDocumentMetadata {
  const { lines, closingIndex } = frontMatter(markdown)
  const values = new Map<'version' | 'updated_at', string>()
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index] ?? ''
    const separator = line.indexOf(':')
    if (separator < 1) continue
    const field = line.slice(0, separator).trim()
    if (field !== 'version' && field !== 'updated_at') continue
    if (values.has(field)) throw new Error('Revision document service metadata is invalid')
    const raw = line.slice(separator + 1).trim()
    const quoted = (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    const value = quoted ? raw.slice(1, -1).trim() : raw
    if (!value) throw new Error('Revision document service metadata is invalid')
    values.set(field, value)
  }
  const version = values.get('version')
  const updatedAt = values.get('updated_at')
  if (!version || !updatedAt) throw new Error('Revision document service metadata is invalid')
  parseVersion(version)
  if (!updatedAtSchema.safeParse(updatedAt).success)
    throw new Error('Revision document updated_at is invalid')
  return { version, updatedAt }
}

function hasServiceMetadata(markdown: string): boolean {
  const lines = markdown.split('\n')
  if (lines[0]?.trim() !== '---') return false
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 1) return false
  return lines.slice(1, closingIndex).some(line => {
    const separator = line.indexOf(':')
    if (separator < 1) return false
    const field = line.slice(0, separator).trim()
    return field === 'version' || field === 'updated_at'
  })
}

function comparableMetadata(markdown: string): string {
  const { lines, closingIndex } = frontMatter(markdown)
  for (let index = 1; index < closingIndex; index += 1) {
    const separator = lines[index]!.indexOf(':')
    if (separator < 1) continue
    const field = lines[index]!.slice(0, separator).trim()
    if (field === 'version' || field === 'updated_at')
      lines[index] = `${field}: <service-owned>`
  }
  return lines.join('\n')
}

function serviceMetadataLines(markdown: string, metadata: RevisionDocumentMetadata): string {
  const { lines, closingIndex } = frontMatter(markdown)
  let versionCount = 0
  let updatedAtCount = 0
  for (let index = 1; index < closingIndex; index += 1) {
    const separator = lines[index]!.indexOf(':')
    if (separator < 1) continue
    const field = lines[index]!.slice(0, separator).trim()
    if (field === 'version') {
      lines[index] = `version: ${metadata.version}`
      versionCount += 1
    } else if (field === 'updated_at') {
      lines[index] = `updated_at: ${metadata.updatedAt}`
      updatedAtCount += 1
    }
  }
  if (versionCount !== 1 || updatedAtCount !== 1)
    throw new Error('Revision document service metadata is invalid')
  return lines.join('\n')
}

function expectedMetadata(previous: RevisionDocumentMetadata, updatedAt?: string): RevisionDocumentMetadata {
  const parts = parseVersion(previous.version)
  const previousTimestamp = Date.parse(previous.updatedAt)
  if (!Number.isFinite(previousTimestamp))
    throw new Error('Revision document updated_at is invalid')
  if (parts[2] === Number.MAX_SAFE_INTEGER)
    throw new Error('Revision document version cannot advance')
  if (!updatedAt)
    throw new Error('Revision document updated_at requires an owner timestamp')
  const nextUpdatedAt = updatedAt
  if (!updatedAtSchema.safeParse(nextUpdatedAt).success || Date.parse(nextUpdatedAt) <= previousTimestamp)
    throw new Error('Revision document updated_at must advance')
  return {
    version: `${parts[0]}.${parts[1]}.${parts[2]! + 1}`,
    updatedAt: nextUpdatedAt,
  }
}

export function readRevisionDocumentMetadata(markdown: string): RevisionDocumentMetadata {
  return parseMetadata(markdown)
}

/**
 * Applies the Revision-owned metadata transition to one staged document.
 * The source document is the only version authority. A previous candidate is
 * accepted only as an exact retained-byte replay; it never causes another
 * increment. Worker-supplied service metadata may be unchanged or already be
 * the deterministic expected pair, but no other pair is accepted.
 */
export function advanceRevisionDocumentMetadata(input: {
  baseMarkdown: string
  candidateMarkdown: string
  previousCandidateMarkdown?: string
  updatedAt?: string
  allowAlreadyAdvanced?: boolean
}): string {
  if (input.previousCandidateMarkdown !== undefined &&
    input.candidateMarkdown === input.previousCandidateMarkdown)
    return input.candidateMarkdown

  // Older accepted Reviewer sources can predate the service-owned front
  // matter contract. Revision cannot invent a previous version authority for
  // those bytes, so it preserves them until Authoring supplies metadata.
  // Once either side advertises service metadata, the transition is strict.
  if (!hasServiceMetadata(input.baseMarkdown)) {
    if (hasServiceMetadata(input.candidateMarkdown))
      throw new Error('Revision candidate added service metadata without a source authority')
    return input.candidateMarkdown
  }

  const previous = parseMetadata(input.baseMarkdown)
  const candidate = parseMetadata(input.candidateMarkdown)
  if (comparableMetadata(input.baseMarkdown) === comparableMetadata(input.candidateMarkdown)) {
    if (input.candidateMarkdown !== input.baseMarkdown)
      throw new Error('Revision candidate changed service metadata without document progress')
    return input.candidateMarkdown
  }

  const isBasePair = candidate.version === previous.version && candidate.updatedAt === previous.updatedAt
  const candidateParts = parseVersion(candidate.version)
  const previousParts = parseVersion(previous.version)
  const isAlreadyAdvanced = candidateParts[0] === previousParts[0] && candidateParts[1] === previousParts[1] &&
    candidateParts[2] === previousParts[2]! + 1 && Date.parse(candidate.updatedAt) > Date.parse(previous.updatedAt)
  if (input.allowAlreadyAdvanced && isAlreadyAdvanced) return input.candidateMarkdown
  const expected = expectedMetadata(previous, input.updatedAt)
  const isExpectedPair = candidate.version === expected.version && candidate.updatedAt === expected.updatedAt
  if (!isBasePair && !isExpectedPair)
    throw new Error('Revision worker changed service-owned metadata')
  return isExpectedPair ? input.candidateMarkdown : serviceMetadataLines(input.candidateMarkdown, expected)
}
