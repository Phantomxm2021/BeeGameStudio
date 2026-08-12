import { describe, expect, test } from 'bun:test'
import {
  authorizeFoundationDocumentDraftMutation,
  type FoundationDocumentMutationInput,
} from './foundation-document-mutation'
import { foundationDocumentDraftGroups } from './foundation-document-draft'

const path = 'docs/GDD.md' as const
const sections = foundationDocumentDraftGroups(path)[0]!.sections
const section = sections[0]!

function firstWrite(cursor = '<!-- beegame-draft-cursor:0:1 -->') {
  return [
    '# Game Design Document',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    'Concrete product promise and scope.',
    `<!-- beegame-section:${section.sectionId} -->`,
    `## ${section.title}`,
    `<!-- beegame-part:${section.sectionId}:1 -->`,
    'Concrete production decisions and observable acceptance criteria.',
    cursor,
  ].join('\n')
}

function completeFirstGroupWrite() {
  const secondSection = sections[1]!
  return firstWrite().replace(
    '<!-- beegame-draft-cursor:0:1 -->',
    [
      `<!-- beegame-part:${section.sectionId}:2 -->`,
      'The second bounded part completes this section without authoring another section.',
      `<!-- beegame-section:${secondSection.sectionId} -->`,
      `## ${secondSection.title}`,
      `<!-- beegame-part:${secondSection.sectionId}:1 -->`,
      'The next section begins inside the same bounded native replacement.',
      `<!-- beegame-part:${secondSection.sectionId}:2 -->`,
      'The next section also completes inside the same bounded native replacement.',
      '<!-- beegame-draft-cursor:1:0 -->',
    ].join('\n'),
  )
}

function authorize(input: {
  currentMarkdown?: string
  toolName: 'Write' | 'Edit'
  mutation: FoundationDocumentMutationInput
}) {
  return authorizeFoundationDocumentDraftMutation({ path, ...input })
}

describe('foundation document native mutation authority', () => {
  test('rejects a partial section because the native write must commit the whole group', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: firstWrite() },
      }),
    ).toMatchObject({ behavior: 'deny' })
  })

  test('allows one bounded native write to complete exactly one section group', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: completeFirstGroupWrite() },
      }),
    ).toEqual({ behavior: 'allow' })
  })

  test('rejects a write that omits the durable cursor', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: firstWrite('').trimEnd() },
      }),
    ).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/cursor/i),
    })
  })

  test('requires Edit to replace only the current cursor and advance one full group', () => {
    const currentMarkdown = completeFirstGroupWrite()
    const nextGroup = foundationDocumentDraftGroups(path)[1]!
    const valid = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: '<!-- beegame-draft-cursor:1:0 -->',
        new_string: nextGroup.sections.flatMap(nextSection => [
          `<!-- beegame-section:${nextSection.sectionId} -->`,
          `## ${nextSection.title}`,
          `<!-- beegame-part:${nextSection.sectionId}:1 -->`,
          'The first half contains bounded production authority.',
          `<!-- beegame-part:${nextSection.sectionId}:2 -->`,
          'The second half contains observable acceptance criteria.',
        ]).concat('<!-- beegame-draft-cursor:2:0 -->').join('\n'),
      },
    })
    const rewritesPrefix = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: 'Concrete product promise and scope.',
        new_string: 'A rewritten prefix.',
      },
    })

    expect(valid).toEqual({ behavior: 'allow' })
    expect(rewritesPrefix).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/cursor/i),
    })
  })
})
