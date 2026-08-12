import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type {
  GameDocumentProductionMaterialContract,
  GameDocumentSectionContract,
} from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'

const SECTIONS_PER_TURN = 1

export type FoundationDocumentDraftGroup = Readonly<{
  groupIndex: number
  sections: readonly GameDocumentSectionContract[]
  productionMaterials: readonly GameDocumentProductionMaterialContract[]
}>

export type FoundationDocumentDraftProgress = Readonly<{
  completedGroupCount: number
  complete: boolean
}>

export function foundationDocumentDraftGroups(
  path: FoundationDocumentPath,
): readonly FoundationDocumentDraftGroup[] {
  const contract = getGameDocumentContract(path)
  const groups: FoundationDocumentDraftGroup[] = []
  for (
    let sectionIndex = 0;
    sectionIndex < contract.sections.length;
    sectionIndex += SECTIONS_PER_TURN
  ) {
    groups.push(
      Object.freeze({
        groupIndex: groups.length,
        sections: Object.freeze(
          contract.sections.slice(
            sectionIndex,
            sectionIndex + SECTIONS_PER_TURN,
          ),
        ),
        productionMaterials: Object.freeze([]),
      }),
    )
  }
  groups.push(
    Object.freeze({
      groupIndex: groups.length,
      sections: Object.freeze([]),
      productionMaterials: Object.freeze([...contract.productionMaterials]),
    }),
  )
  return Object.freeze(groups)
}

export function inspectFoundationDocumentDraft(
  path: FoundationDocumentPath,
  markdown: string | undefined,
): FoundationDocumentDraftProgress {
  if (!markdown?.trim())
    return Object.freeze({ completedGroupCount: 0, complete: false })

  const cursorMatches = [
    ...markdown.matchAll(/<!-- beegame-draft-cursor:(\d+) -->/g),
  ]
  if (cursorMatches.length === 0) {
    validateCompleteGameDocumentMarkdown(path, markdown)
    return Object.freeze({
      completedGroupCount: foundationDocumentDraftGroups(path).length,
      complete: true,
    })
  }
  if (cursorMatches.length !== 1)
    throw new Error('foundation document draft requires exactly one cursor')

  const completedGroupCount = Number(cursorMatches[0]![1])
  const groups = foundationDocumentDraftGroups(path)
  if (
    !Number.isInteger(completedGroupCount) ||
    completedGroupCount <= 0 ||
    completedGroupCount >= groups.length
  )
    throw new Error('foundation document draft cursor group is invalid')

  const cursor = `<!-- beegame-draft-cursor:${completedGroupCount} -->`
  const nonBlankLines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (nonBlankLines.at(-1) !== cursor)
    throw new Error('foundation document draft cursor must be at the end')

  const contract = getGameDocumentContract(path)
  const expectedSections = groups
    .slice(0, completedGroupCount)
    .flatMap(group => group.sections)
  const actualSectionMarkers = nonBlankLines.filter(line =>
    line.startsWith('<!-- beegame-section:'),
  )
  const expectedSectionMarkers = expectedSections.map(
    section => `<!-- beegame-section:${section.sectionId} -->`,
  )
  if (
    actualSectionMarkers.length !== expectedSectionMarkers.length ||
    expectedSectionMarkers.some(
      (marker, index) => actualSectionMarkers[index] !== marker,
    )
  )
    throw new Error('foundation document draft section group is invalid')
  if (
    nonBlankLines.some(line =>
      line.startsWith('<!-- beegame-material:'),
    ) ||
    nonBlankLines.includes('<!-- beegame-production-materials -->')
  )
    throw new Error('foundation document draft material group is premature')
  if (
    nonBlankLines[0] === undefined ||
    !nonBlankLines[0].startsWith('# ') ||
    nonBlankLines[0].startsWith('## ') ||
    nonBlankLines.filter(line => line === '<!-- beegame-executive-summary -->')
      .length !== 1
  )
    throw new Error('foundation document draft title or summary is invalid')

  const lines = markdown.split('\n').map(line => line.trimEnd())
  assertNonEmptyDraftRange(
    lines,
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    expectedSectionMarkers[0]!,
  )
  expectedSections.forEach((section, index) =>
    assertNonEmptyDraftRange(
      lines,
      expectedSectionMarkers[index]!,
      `## ${section.title}`,
      expectedSectionMarkers[index + 1] ?? cursor,
    ),
  )
  if (contract.sections.length < expectedSections.length)
    throw new Error('foundation document draft exceeds its contract')
  return Object.freeze({ completedGroupCount, complete: false })
}

export function buildFoundationDocumentDraftTurnPrompt(input: {
  path: FoundationDocumentPath
  progress: FoundationDocumentDraftProgress
  projectionRelativePath: string
  confirmedBriefDigest?: unknown
  changeRequest?: unknown
  systemDeliveryContract?: unknown
}): string {
  const contract = getGameDocumentContract(input.path)
  const groups = foundationDocumentDraftGroups(input.path)
  if (input.progress.complete)
    return `The assigned document ${input.path} already satisfies the complete contract. Do not rewrite it; end the turn normally.`
  const group = groups[input.progress.completedGroupCount]
  if (!group)
    throw new Error('foundation document draft group is unavailable')
  const nextCursor = group.groupIndex + 1
  const isFirst = group.groupIndex === 0
  const isFinal = group.groupIndex === groups.length - 1
  const groupContract = {
    path: input.path,
    discipline: contract.discipline,
    purpose: contract.purpose,
    groupIndex: group.groupIndex,
    groupCount: groups.length,
    sections: group.sections,
    productionMaterials: group.productionMaterials,
    ...(typeof input.confirmedBriefDigest === 'string'
      ? { confirmedBriefDigest: input.confirmedBriefDigest }
      : {}),
    ...(typeof input.changeRequest === 'string' && input.changeRequest.trim()
      ? { changeRequest: input.changeRequest.trim() }
      : {}),
    ...(input.path === 'docs/TECHNICAL_DESIGN.md' &&
    input.systemDeliveryContract &&
    typeof input.systemDeliveryContract === 'object'
      ? { systemDeliveryContract: input.systemDeliveryContract }
      : {}),
  }
  return [
    `Active bounded document group ${group.groupIndex + 1}/${groups.length}. Author only this group at ${input.path}; do not author later groups in this turn.`,
    isFirst
      ? `${contract.upstreamSections.length ? `Read the small authority index ${input.projectionRelativePath} once. Select only the upstream sections directly required for this active section and read each exact source range by its startLine and lineCount; never read a whole upstream document. Then ` : ''}use native Write to create the title, <!-- beegame-executive-summary --> with ## Executive Summary, the exact group section below, and finish the file with <!-- beegame-draft-cursor:${nextCursor} -->.`
      : isFinal
        ? `Use native Edit to replace the sole <!-- beegame-draft-cursor:${group.groupIndex} --> with <!-- beegame-production-materials -->, ## Production Materials, and every exact production material below. Do not leave a draft cursor.`
        : `Read the refreshed small authority index ${input.projectionRelativePath} once. Select only the upstream sections directly required for this active section and read each exact source range by its startLine and lineCount; never read a whole upstream document. Then use native Edit to replace the sole <!-- beegame-draft-cursor:${group.groupIndex} --> with the exact group section below followed by <!-- beegame-draft-cursor:${nextCursor} -->.`,
    isFirst
      ? 'Do not reread the target after writing this bounded group.'
      : 'Do not rewrite or reread the completed prefix. The cursor is the only edit target.',
    'The confirmed brief and projected upstream authority are binding. Define only this discipline\'s owned facts; reference upstream facts instead of copying them and do not invent behavior delegated to a downstream owner.',
    'Write production-ready human development authority, not a skeleton: make concrete choices, state boundaries and tradeoffs, use units and dense tables where useful, and include observable acceptance criteria. Do not repeat the brief, upstream prose, or another section.',
    'Do not write YAML front matter, an Audit Appendix, workflow metadata, or another project file. Do not claim verified license status without concrete evidence.',
    'Keep every tool input bounded to this group. End the turn normally immediately after the write or edit succeeds; BGS validates the on-disk checkpoint before the next group.',
    JSON.stringify(groupContract),
  ].join('\n\n')
}

function assertNonEmptyDraftRange(
  lines: readonly string[],
  marker: string,
  heading: string,
  nextMarker: string,
): void {
  const markerIndex = lines.indexOf(marker)
  const nextMarkerIndex = lines.indexOf(nextMarker)
  let headingIndex = -1
  for (let index = markerIndex + 1; index < nextMarkerIndex; index += 1) {
    if (lines[index]?.trim()) {
      headingIndex = index
      break
    }
  }
  if (
    markerIndex < 0 ||
    nextMarkerIndex <= markerIndex ||
    headingIndex < 0 ||
    lines[headingIndex]!.trim() !== heading ||
    !lines
      .slice(headingIndex + 1, nextMarkerIndex)
      .some(line => line.trim())
  )
    throw new Error(`foundation document draft content is invalid: ${marker}`)
}
