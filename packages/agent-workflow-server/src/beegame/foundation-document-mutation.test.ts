import { describe, expect, test } from 'bun:test'
import {
  authorizeFoundationDocumentDraftMutation,
  type FoundationDocumentMutationInput,
} from './foundation-document-mutation'
import { foundationDocumentDraftGroups } from './foundation-document-draft'

const path = 'docs/GDD.md' as const
const section = foundationDocumentDraftGroups(path)[0]!.sections[0]!

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

function authorize(input: {
  currentMarkdown?: string
  toolName: 'Write' | 'Edit'
  mutation: FoundationDocumentMutationInput
}) {
  return authorizeFoundationDocumentDraftMutation({ path, ...input })
}

describe('foundation document native mutation authority', () => {
  test('allows only one valid durable native write checkpoint', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: firstWrite() },
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

  test('requires Edit to replace only the current cursor and advance one part', () => {
    const currentMarkdown = firstWrite()
    const valid = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: '<!-- beegame-draft-cursor:0:1 -->',
        new_string: [
          `<!-- beegame-part:${section.sectionId}:2 -->`,
          'The final bounded decisions and acceptance criteria.',
          '<!-- beegame-draft-cursor:1:0 -->',
        ].join('\n'),
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
