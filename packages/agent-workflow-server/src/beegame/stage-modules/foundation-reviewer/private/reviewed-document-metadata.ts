type FrontMatter = {
  lines: string[]
  versionIndex: number
  updatedAtIndex: number
  version: string
  updatedAt: string
}

function frontMatter(content: string, validateValues: boolean): FrontMatter {
  const lines = content.split('\n')
  if (lines[0]?.trim() !== '---')
    throw new Error('Reviewed document front matter is missing')
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (closingIndex < 1) throw new Error('Reviewed document front matter is invalid')
  const indexes = (field: string) => lines
    .map((line, index) => ({ index, field: line.slice(0, line.indexOf(':')).trim() }))
    .filter(entry => entry.index > 0 && entry.index < closingIndex && entry.field === field)
    .map(entry => entry.index)
  const versions = indexes('version')
  const updatedAts = indexes('updated_at')
  if (versions.length !== 1 || updatedAts.length !== 1)
    throw new Error('Reviewed document service metadata is invalid')
  const value = (index: number) => lines[index]!.slice(lines[index]!.indexOf(':') + 1).trim()
  const version = value(versions[0]!)
  const updatedAt = value(updatedAts[0]!)
  if (validateValues) {
    const parts = version.split('.')
    if (parts.length !== 3 || parts.some(part => !/^\d+$/.test(part) || String(Number(part)) !== part))
      throw new Error('Reviewed document previous version is invalid')
    if (!Number.isFinite(Date.parse(updatedAt)))
      throw new Error('Reviewed document previous updated_at is invalid')
  }
  return { lines, versionIndex: versions[0]!, updatedAtIndex: updatedAts[0]!, version, updatedAt }
}

function authoredContent(metadata: FrontMatter): string {
  return metadata.lines
    .filter((_line, index) => index !== metadata.versionIndex && index !== metadata.updatedAtIndex)
    .join('\n')
}

/**
 * Seal the service-owned metadata before the Reviewer publishes its result.
 * Model-only metadata edits are discarded; a real authored-content change
 * advances PATCH exactly once and receives one monotonic review timestamp.
 */
export function sealReviewedDocument(input: {
  sourceContent: string
  reviewedContent: string
  reviewedAt?: string
}): string {
  if (input.sourceContent === input.reviewedContent) return input.sourceContent
  const source = frontMatter(input.sourceContent, true)
  const reviewed = frontMatter(input.reviewedContent, false)
  if (authoredContent(source) === authoredContent(reviewed)) return input.sourceContent

  const previousTimestamp = Date.parse(source.updatedAt)
  const reviewedAt = input.reviewedAt ?? new Date(Math.max(Date.now(), previousTimestamp + 1)).toISOString()
  const reviewedTimestamp = Date.parse(reviewedAt)
  if (!Number.isFinite(reviewedTimestamp) || reviewedTimestamp <= previousTimestamp)
    throw new Error('Reviewed document updated_at must advance')
  const parts = source.version.split('.').map(Number)
  reviewed.lines[reviewed.versionIndex] = `version: ${parts[0]}.${parts[1]}.${parts[2]! + 1}`
  reviewed.lines[reviewed.updatedAtIndex] = `updated_at: ${reviewedAt}`
  return reviewed.lines.join('\n')
}
