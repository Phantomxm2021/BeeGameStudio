import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'
import type {
  GameDocumentProductionMaterialContract,
  GameDocumentSectionContract,
} from './delivery-workflow/game-document-contracts'
import type { FoundationDocumentPath } from './delivery-workflow/types'
import { validateCompleteGameDocumentMarkdown } from './complete-game-document'

const SECTIONS_PER_TURN = 1
const SECTION_PART_COUNT = 2
const MAX_NATIVE_REPLACEMENT_BYTES = 2_400

export type FoundationDocumentDraftGroup = Readonly<{
  groupIndex: number
  sections: readonly GameDocumentSectionContract[]
  productionMaterials: readonly GameDocumentProductionMaterialContract[]
}>

export type FoundationDocumentDraftProgress = Readonly<{
  completedGroupCount: number
  completedPartCount: number
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
    return Object.freeze({
      completedGroupCount: 0,
      completedPartCount: 0,
      complete: false,
    })

  const cursorMatches = [
    ...markdown.matchAll(/<!-- beegame-draft-cursor:(\d+):(\d+) -->/g),
  ]
  if (cursorMatches.length === 0) {
    validateCompleteGameDocumentMarkdown(path, markdown)
    return Object.freeze({
      completedGroupCount: foundationDocumentDraftGroups(path).length,
      completedPartCount: 0,
      complete: true,
    })
  }
  if (cursorMatches.length !== 1)
    throw new Error('foundation document draft requires exactly one cursor')

  const completedGroupCount = Number(cursorMatches[0]![1])
  const completedPartCount = Number(cursorMatches[0]![2])
  const groups = foundationDocumentDraftGroups(path)
  const activeGroup = groups[completedGroupCount]
  const partCount = activeGroup
    ? foundationDocumentDraftPartCount(activeGroup)
    : 0
  if (
    !Number.isInteger(completedGroupCount) ||
    !Number.isInteger(completedPartCount) ||
    completedGroupCount < 0 ||
    completedGroupCount >= groups.length ||
    completedPartCount < 0 ||
    completedPartCount >= partCount ||
    (completedGroupCount === 0 && completedPartCount === 0)
  )
    throw new Error('foundation document draft cursor group is invalid')

  const cursor = `<!-- beegame-draft-cursor:${completedGroupCount}:${completedPartCount} -->`
  const nonBlankLines = markdown
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (nonBlankLines.at(-1) !== cursor)
    throw new Error('foundation document draft cursor must be at the end')

  const contract = getGameDocumentContract(path)
  const completedSections = groups
    .slice(0, completedGroupCount)
    .flatMap(group => group.sections)
  const activeSections =
    completedPartCount > 0 ? activeGroup?.sections ?? [] : []
  const expectedSections = [...completedSections, ...activeSections]
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
  const finalGroupIndex = groups.length - 1
  const expectedMaterials =
    completedGroupCount === finalGroupIndex
      ? groups[finalGroupIndex]!.productionMaterials.slice(
          0,
          completedPartCount,
        )
      : []
  const actualMaterialMarkers = nonBlankLines.filter(line =>
    line.startsWith('<!-- beegame-material:'),
  )
  const expectedMaterialMarkers = expectedMaterials.map(
    material => `<!-- beegame-material:${material.materialId} -->`,
  )
  if (
    actualMaterialMarkers.length !== expectedMaterialMarkers.length ||
    expectedMaterialMarkers.some(
      (marker, index) => actualMaterialMarkers[index] !== marker,
    ) ||
    nonBlankLines.includes('<!-- beegame-production-materials -->') !==
      (completedGroupCount === finalGroupIndex && completedPartCount > 0)
  )
    throw new Error('foundation document draft material group is invalid')
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
  const actualPartMarkers = nonBlankLines.filter(line =>
    line.startsWith('<!-- beegame-part:'),
  )
  const expectedPartMarkersBySection = expectedSections.map((section, index) => {
    const completedParts =
      index < completedSections.length
        ? SECTION_PART_COUNT
        : completedPartCount
    return Array.from(
      { length: completedParts },
      (_, partIndex) =>
        `<!-- beegame-part:${section.sectionId}:${partIndex + 1} -->`,
    )
  })
  const expectedPartMarkers = expectedPartMarkersBySection.flat()
  if (
    actualPartMarkers.length !== expectedPartMarkers.length ||
    expectedPartMarkers.some(
      (marker, index) => actualPartMarkers[index] !== marker,
    )
  )
    throw new Error('foundation document draft part order is invalid')
  expectedPartMarkersBySection.forEach((sectionParts, sectionIndex) => {
    sectionParts.forEach((marker, partIndex) => {
      const nextBoundary =
        sectionParts[partIndex + 1] ??
        expectedSectionMarkers[sectionIndex + 1] ??
        (expectedMaterials.length > 0
          ? '<!-- beegame-production-materials -->'
          : cursor)
      assertBoundedDraftPart(
        markdown,
        partIndex === 0
          ? sectionIndex === 0
            ? undefined
            : expectedSectionMarkers[sectionIndex]!
          : marker,
        marker,
        nextBoundary,
      )
    })
  })
  expectedMaterials.forEach((material, index) => {
    assertNonEmptyDraftRange(
      lines,
      expectedMaterialMarkers[index]!,
      `### ${material.title}`,
      expectedMaterialMarkers[index + 1] ?? cursor,
    )
    assertBoundedDraftPart(
      markdown,
      index === 0
        ? '<!-- beegame-production-materials -->'
        : expectedMaterialMarkers[index]!,
      expectedMaterialMarkers[index]!,
      expectedMaterialMarkers[index + 1] ?? cursor,
    )
  })
  if (contract.sections.length < expectedSections.length)
    throw new Error('foundation document draft exceeds its contract')
  return Object.freeze({
    completedGroupCount,
    completedPartCount,
    complete: false,
  })
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
  const partCount = foundationDocumentDraftPartCount(group)
  const nextPart = input.progress.completedPartCount + 1
  const isFirst = group.groupIndex === 0
  const isFinal = group.groupIndex === groups.length - 1
  const currentCursor = `<!-- beegame-draft-cursor:${group.groupIndex}:${input.progress.completedPartCount} -->`
  const checkpointInstructions = isFinal
    ? group.productionMaterials
        .slice(input.progress.completedPartCount)
        .map((material, offset) => {
          const materialIndex = input.progress.completedPartCount + offset
          const materialCursor = `<!-- beegame-draft-cursor:${group.groupIndex}:${materialIndex} -->`
          const nextMaterialCursor = `<!-- beegame-draft-cursor:${group.groupIndex}:${materialIndex + 1} -->`
          return materialIndex === 0
            ? `Checkpoint ${materialIndex + 1}, native Edit: replace ${materialCursor} with <!-- beegame-production-materials -->, ## Production Materials, <!-- beegame-material:${material.materialId} -->, ### ${material.title}, and its complete bounded ${material.format} body${materialIndex + 1 === partCount ? '; leave no cursor' : `; finish with ${nextMaterialCursor}`}.`
            : `Checkpoint ${materialIndex + 1}, native Edit: replace ${materialCursor} with <!-- beegame-material:${material.materialId} -->, ### ${material.title}, and its complete bounded ${material.format} body${materialIndex + 1 === partCount ? '; leave no cursor' : `; finish with ${nextMaterialCursor}`}.`
        })
    : [
        ...(input.progress.completedPartCount === 0
          ? [
              isFirst
                ? `Checkpoint 1: native Write creates the title, a concise <!-- beegame-executive-summary --> with ## Executive Summary, the section marker and heading, <!-- beegame-part:${group.sections[0]?.sectionId}:1 -->, one bounded content chunk, then <!-- beegame-draft-cursor:0:1 -->.`
                : `Checkpoint 1, native Edit: replace ${currentCursor} with the section marker and heading, <!-- beegame-part:${group.sections[0]?.sectionId}:1 -->, one bounded content chunk, and <!-- beegame-draft-cursor:${group.groupIndex}:1 -->.`,
            ]
          : []),
        `Checkpoint 2, native Edit: replace <!-- beegame-draft-cursor:${group.groupIndex}:1 --> with <!-- beegame-part:${group.sections[0]?.sectionId}:2 --> and the final bounded content chunk, then <!-- beegame-draft-cursor:${group.groupIndex + 1}:0 -->.`,
      ]
  const groupContract = {
    path: input.path,
    discipline: contract.discipline,
    purpose: contract.purpose,
    groupIndex: group.groupIndex,
    groupCount: groups.length,
    currentPart: input.progress.completedPartCount,
    partCount,
    maxNativeReplacementBytes: MAX_NATIVE_REPLACEMENT_BYTES,
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
    `Active bounded document group ${group.groupIndex + 1}/${groups.length}, resume chunk ${nextPart}/${partCount}. Author only this group at ${input.path}; do not author later groups in this turn.`,
    `${contract.upstreamSections.length && input.progress.completedPartCount === 0 ? `Read the small authority index ${input.projectionRelativePath} once. Select only the upstream sections directly required for this active section and read each exact source range by its startLine and lineCount; never read a whole upstream document. Then ` : ''}continue bounded native file calls until this active group is complete. Perform one native file call for each checkpoint below, in order, and start the next checkpoint immediately after the prior tool succeeds. Every content or new_string value must be at most ${MAX_NATIVE_REPLACEMENT_BYTES.toLocaleString('en-US')} UTF-8 bytes; never generate the whole section as one tool input.`,
    ...checkpointInstructions,
    isFirst
      ? 'Do not reread the target after writing this bounded group.'
      : 'Do not rewrite or reread the completed prefix. The cursor is the only edit target.',
    'The confirmed brief and projected upstream authority are binding. Define only this discipline\'s owned facts; reference upstream facts instead of copying them and do not invent behavior delegated to a downstream owner.',
    'Write production-ready human development authority, not a skeleton: make concrete choices, state boundaries and tradeoffs, use units and dense tables where useful, and include observable acceptance criteria. Do not repeat the brief, upstream prose, or another section.',
    'Do not write YAML front matter, an Audit Appendix, workflow metadata, or another project file. Do not claim verified license status without concrete evidence.',
    'BGS mechanically validates every proposed checkpoint before the native tool writes it. After this group\'s final checkpoint succeeds, end the turn normally. If interrupted, the durable cursor resumes at the next missing checkpoint.',
    JSON.stringify(groupContract),
  ].join('\n\n')
}

export function foundationDocumentDraftPartCount(
  group: FoundationDocumentDraftGroup,
): number {
  return group.productionMaterials.length || SECTION_PART_COUNT
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

function assertBoundedDraftPart(
  markdown: string,
  replacementStartMarker: string | undefined,
  contentMarker: string,
  nextBoundary: string,
): void {
  const contentStart = markdown.indexOf(contentMarker)
  const replacementStart = replacementStartMarker
    ? markdown.indexOf(replacementStartMarker)
    : 0
  const end = markdown.indexOf(
    nextBoundary,
    contentStart + contentMarker.length,
  )
  if (replacementStart < 0 || contentStart < replacementStart || end <= contentStart)
    throw new Error(`foundation document draft part is incomplete: ${contentMarker}`)
  const body = markdown.slice(contentStart + contentMarker.length, end).trim()
  if (!body)
    throw new Error(`foundation document draft part is empty: ${contentMarker}`)
  if (
    Buffer.byteLength(markdown.slice(replacementStart, end), 'utf8') >
    MAX_NATIVE_REPLACEMENT_BYTES
  )
    throw new Error(
      `foundation document draft part exceeds ${MAX_NATIVE_REPLACEMENT_BYTES} bytes: ${contentMarker}`,
    )
}
