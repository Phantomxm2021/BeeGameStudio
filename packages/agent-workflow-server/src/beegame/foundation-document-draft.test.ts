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
      `Production authority for ${section.sectionId} with implementation and acceptance detail.`,
      '',
    ]),
    '<!-- beegame-draft-cursor:1 -->',
    '',
  ].join('\n')
}

describe('foundation document draft groups', () => {
  test('bounds each native turn and keeps canonical contract order', () => {
    const path = 'docs/GDD.md'
    const contract = getGameDocumentContract(path)
    const groups = foundationDocumentDraftGroups(path)

    expect(groups.length).toBe(5)
    expect(groups.slice(0, -1).every(group => group.sections.length <= 3)).toBe(
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
    expect(prompt).toContain('<!-- beegame-draft-cursor:1 -->')
    expect(prompt).toContain('native Edit')
    expect(prompt).toContain('Do not rewrite or reread the completed prefix')
    expect(prompt).not.toContain(
      getGameDocumentContract(path).sections.at(-1)!.sectionId,
    )
  })

  test('rejects skipped, duplicated, and trailing draft content', () => {
    const path = 'docs/GDD.md'
    const first = firstGroupMarkdown(path)
    expect(() =>
      inspectFoundationDocumentDraft(
        path,
        first.replace(
          '<!-- beegame-draft-cursor:1 -->',
          '<!-- beegame-draft-cursor:2 -->',
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
})
