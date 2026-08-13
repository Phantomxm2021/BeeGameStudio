import { describe, expect, test } from 'bun:test'
import {
  buildFoundationDocumentDraftTurnPrompt,
  foundationDocumentDraftPartCount,
  foundationDocumentDraftGroups,
  inspectFoundationDocumentDraft,
} from './foundation-document-draft'
import { getGameDocumentContract } from './delivery-workflow/game-document-contracts'

function firstGroupMarkdown(path: 'docs/GDD.md'): string {
  const group = foundationDocumentDraftGroups(path)[0]!
  return [
    '# Game Design Document',
    '',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    'A production-ready summary with concrete player, scope, and acceptance authority.',
    '',
    ...group.sections.flatMap(section => [
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `Production authority for ${section.sectionId} with implementation and acceptance detail.`,
      `Additional production decisions and acceptance criteria for ${section.sectionId}.`,
      '',
    ]),
    '<!-- beegame-draft-cursor:1:0 -->',
    '',
  ].join('\n')
}

describe('foundation document draft groups', () => {
  test('serializes every remaining bounded checkpoint in canonical order', () => {
    const path = 'docs/GDD.md'
    const contract = getGameDocumentContract(path)
    const groups = foundationDocumentDraftGroups(path)

    expect(groups.length).toBe(contract.sections.length + 1)
    expect(groups.slice(0, -1).every(group => group.sections.length === 1)).toBe(
      true,
    )
    expect(groups.flatMap(group => group.sections.map(section => section.sectionId))).toEqual(
      contract.sections.map(section => section.sectionId),
    )
    expect(groups.at(-1)?.productionMaterials).toEqual(
      contract.productionMaterials,
    )
    expect(foundationDocumentDraftPartCount(groups[0]!)).toBe(1)
    const emptyProgress = inspectFoundationDocumentDraft(path, undefined)
    const firstPrompt = buildFoundationDocumentDraftTurnPrompt({
      path,
      progress: emptyProgress,
      projectionRelativePath:
        '.beegame/workflow/document-projections/dispatch.json',
    })
    expect(emptyProgress.started).toBe(false)
    expect(firstPrompt).toContain('Checkpoint 1: native Write creates only')
    expect(firstPrompt).toContain('<!-- beegame-draft-cursor:0:0 -->')
    expect(firstPrompt).toContain('Checkpoint 2, native Edit')
    expect(firstPrompt).toContain('one complete bounded section')
    expect(firstPrompt).toContain('<!-- beegame-draft-cursor:1:0 -->')
    expect(firstPrompt).not.toContain('beegame-part')
    expect(firstPrompt).toContain('Continuous bounded document sequence 1/13')
    expect(firstPrompt).toContain('Continuous bounded document sequence 13/13')
    expect(firstPrompt).toContain(
      `<!-- beegame-section:${contract.sections.at(-1)!.sectionId} -->`,
    )
    expect(firstPrompt).toContain(
      `<!-- beegame-material:${contract.productionMaterials.at(-1)!.materialId} -->`,
    )
    expect(firstPrompt.indexOf('Continuous bounded document sequence 1/13')).toBeLessThan(
      firstPrompt.indexOf('Continuous bounded document sequence 13/13'),
    )
    expect(firstPrompt).toContain(
      'Wait for each native tool result before generating the next checkpoint',
    )
  })

  test('derives only the remaining sequence from a durable on-disk cursor', () => {
    const path = 'docs/GDD.md'
    const markdown = firstGroupMarkdown(path)
    const progress = inspectFoundationDocumentDraft(path, markdown)
    const prompt = buildFoundationDocumentDraftTurnPrompt({
      path,
      progress,
      projectionRelativePath:
        '.beegame/workflow/document-projections/dispatch.json',
    })

    expect(progress.completedGroupCount).toBe(1)
    expect(progress.complete).toBe(false)
    expect(prompt).toContain('<!-- beegame-draft-cursor:1:0 -->')
    expect(prompt).toContain('native Edit')
    expect(prompt).toContain('<!-- beegame-draft-cursor:2:0 -->')
    expect(prompt).toContain('3,600 UTF-8 bytes')
    expect(prompt).toContain('"maxNativeReplacementBytes":4800')
    expect(prompt).toContain('Do not rewrite or reread the completed prefix')
    expect(prompt).toContain(
      getGameDocumentContract(path).sections.at(-1)!.sectionId,
    )
    expect(prompt).not.toContain(
      `<!-- beegame-section:${getGameDocumentContract(path).sections[0]!.sectionId} -->`,
    )
    expect(prompt).toContain(
      'Wait for each native tool result before generating the next checkpoint',
    )
  })

  test('rejects obsolete partial-section cursors and markers', () => {
    const path = 'docs/GDD.md'
    const firstSection = foundationDocumentDraftGroups(path)[0]!.sections[0]!
    const markdown = [
      '# Game Design Document',
      '',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      'Concrete product promise and scope.',
      '',
      `<!-- beegame-section:${firstSection.sectionId} -->`,
      `## ${firstSection.title}`,
      'The first bounded native write has landed durably.',
      '',
      '<!-- beegame-draft-cursor:0:1 -->',
      '',
    ].join('\n')

    expect(() => inspectFoundationDocumentDraft(path, markdown)).toThrow(
      /cursor|part/i,
    )
  })

  test('resumes after the title and summary landed without a section body', () => {
    const path = 'docs/GDD.md'
    const markdown = [
      '# Game Design Document',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      'Concrete product promise and scope.',
      '<!-- beegame-draft-cursor:0:0 -->',
      '',
    ].join('\n')
    const progress = inspectFoundationDocumentDraft(path, markdown)
    const prompt = buildFoundationDocumentDraftTurnPrompt({
      path,
      progress,
      projectionRelativePath:
        '.beegame/workflow/document-projections/dispatch.json',
    })

    expect(progress).toMatchObject({
      started: true,
      completedGroupCount: 0,
      completedPartCount: 0,
      complete: false,
    })
    expect(prompt).not.toContain('native Write')
    expect(prompt).toContain('Checkpoint 1, native Edit')
    expect(prompt).toContain('one complete bounded section')
    expect(prompt).toContain('<!-- beegame-draft-cursor:1:0 -->')
    expect(prompt).not.toContain('beegame-part')
  })

  test('bounds the preamble and complete first section as independent checkpoints', () => {
    const path = 'docs/GDD.md'
    const section = foundationDocumentDraftGroups(path)[0]!.sections[0]!
    const valid = [
      '# Game Design Document',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      's'.repeat(3_000),
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      'p'.repeat(3_000),
      '<!-- beegame-draft-cursor:1:0 -->',
    ].join('\n')
    expect(inspectFoundationDocumentDraft(path, valid)).toMatchObject({
      started: true,
      completedGroupCount: 1,
      completedPartCount: 0,
    })
    expect(() =>
      inspectFoundationDocumentDraft(
        path,
        valid.replace('s'.repeat(3_000), 's'.repeat(4_801)),
      ),
    ).toThrow(/exceeds 4800 bytes/i)
  })

  test('rejects skipped, duplicated, and trailing draft content', () => {
    const path = 'docs/GDD.md'
    const first = firstGroupMarkdown(path)
    expect(() =>
      inspectFoundationDocumentDraft(
        path,
        first.replace(
          '<!-- beegame-draft-cursor:1:0 -->',
          '<!-- beegame-draft-cursor:2:0 -->',
        ),
      ),
    ).toThrow(/cursor|group/i)
    expect(() =>
      inspectFoundationDocumentDraft(
        path,
        `${first}unexpected trailing body`,
      ),
    ).toThrow(/cursor.*end/i)
  })

  test('rejects a native replacement beyond the measured safe byte limit', () => {
    const path = 'docs/GDD.md'
    const section = foundationDocumentDraftGroups(path)[0]!.sections[0]!
    const markdown = [
      '# Game Design Document',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      'Summary.',
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      'x'.repeat(4_801),
      '<!-- beegame-draft-cursor:1:0 -->',
    ].join('\n')

    expect(() => inspectFoundationDocumentDraft(path, markdown)).toThrow(
      /exceeds 4800 bytes/i,
    )
  })
})
