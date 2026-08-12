import { describe, expect, test } from 'bun:test'
import {
  buildFoundationDocumentDraftTurnPrompt,
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
      `<!-- beegame-part:${section.sectionId}:1 -->`,
      `Production authority for ${section.sectionId} with implementation and acceptance detail.`,
      `<!-- beegame-part:${section.sectionId}:2 -->`,
      `Additional production decisions and acceptance criteria for ${section.sectionId}.`,
      '',
    ]),
    '<!-- beegame-draft-cursor:1:0 -->',
    '',
  ].join('\n')
}

describe('foundation document draft groups', () => {
  test('bounds each native turn and keeps canonical contract order', () => {
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
  })

  test('derives the next bounded turn from a durable on-disk cursor', () => {
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
    expect(prompt).toContain(
      'continue bounded native file calls until this active group is complete',
    )
    expect(prompt).toContain('<!-- beegame-draft-cursor:1:1 -->')
    expect(prompt).toContain('<!-- beegame-draft-cursor:2:0 -->')
    expect(prompt).toContain('2,400 UTF-8 bytes')
    expect(prompt).toContain('Do not rewrite or reread the completed prefix')
    expect(prompt).not.toContain(
      getGameDocumentContract(path).sections.at(-1)!.sectionId,
    )
  })

  test('resumes a partially streamed section from its durable chunk cursor', () => {
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
      `<!-- beegame-part:${firstSection.sectionId}:1 -->`,
      'The first bounded native write has landed durably.',
      '',
      '<!-- beegame-draft-cursor:0:1 -->',
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
      completedGroupCount: 0,
      completedPartCount: 1,
      complete: false,
    })
    expect(prompt).toContain('resume chunk 2/2')
    expect(prompt).toContain('<!-- beegame-draft-cursor:0:1 -->')
    expect(prompt).toContain('<!-- beegame-draft-cursor:1:0 -->')
    expect(prompt).not.toContain('native Write')
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

  test('rejects a native replacement that exceeds the durable byte limit', () => {
    const path = 'docs/GDD.md'
    const section = foundationDocumentDraftGroups(path)[0]!.sections[0]!
    const markdown = [
      '# Game Design Document',
      '<!-- beegame-executive-summary -->',
      '## Executive Summary',
      'Summary.',
      `<!-- beegame-section:${section.sectionId} -->`,
      `## ${section.title}`,
      `<!-- beegame-part:${section.sectionId}:1 -->`,
      'x'.repeat(2_401),
      '<!-- beegame-draft-cursor:0:1 -->',
    ].join('\n')

    expect(() => inspectFoundationDocumentDraft(path, markdown)).toThrow(
      /exceeds 2400 bytes/i,
    )
  })
})
