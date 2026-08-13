import { describe, expect, test } from 'bun:test'
import {
  authorizeFoundationDocumentDraftMutation,
  type FoundationDocumentMutationInput,
} from './foundation-document-mutation'
import { foundationDocumentDraftGroups } from './foundation-document-draft'

const path = 'docs/GDD.md' as const
const section = foundationDocumentDraftGroups(path)[0]!.sections[0]!

function preamble(cursor = '<!-- beegame-draft-cursor:0:0 -->') {
  return [
    '# Game Design Document',
    '<!-- beegame-executive-summary -->',
    '## Executive Summary',
    'Concrete product promise and scope.',
    cursor,
  ].join('\n')
}

function completeSection(
  body = 'Concrete production decisions and observable acceptance criteria.',
  cursor = '<!-- beegame-draft-cursor:1:0 -->',
) {
  return [
    `<!-- beegame-section:${section.sectionId} -->`,
    `## ${section.title}`,
    body,
    cursor,
  ].join('\n')
}

function firstWrite() {
  return [preamble('').trimEnd(), completeSection()].join('\n')
}

function authorize(input: {
  currentMarkdown?: string
  toolName: 'Write' | 'Edit'
  mutation: FoundationDocumentMutationInput
}) {
  return authorizeFoundationDocumentDraftMutation({ path, ...input })
}

describe('foundation document native mutation authority', () => {
  test('allows only the title and summary as the first durable native write checkpoint', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: preamble() },
      }),
    ).toEqual({ behavior: 'allow' })
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: firstWrite() },
      }),
    ).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/title and summary checkpoint/i),
    })
  })

  test('rejects a write that omits the durable cursor', () => {
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: preamble('').trimEnd() },
      }),
    ).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/cursor/i),
    })
  })

  test('requires Edit to replace only the current cursor and advance one section', () => {
    const currentMarkdown = preamble()
    const valid = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: '<!-- beegame-draft-cursor:0:0 -->',
        new_string: completeSection(),
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

  test('rejects skipped sections and oversized section checkpoints', () => {
    const currentMarkdown = preamble()
    const secondSection = foundationDocumentDraftGroups(path)[1]!.sections[0]!
    const skipped = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: '<!-- beegame-draft-cursor:0:0 -->',
        new_string: [
          completeSection('', ''),
          `<!-- beegame-section:${secondSection.sectionId} -->`,
          `## ${secondSection.title}`,
          'Skipped into a second section.',
          '<!-- beegame-draft-cursor:2:0 -->',
        ].join('\n'),
      },
    })
    const oversized = authorize({
      currentMarkdown,
      toolName: 'Edit',
      mutation: {
        old_string: '<!-- beegame-draft-cursor:0:0 -->',
        new_string: completeSection('x'.repeat(4_801)),
      },
    })

    expect(skipped).toMatchObject({ behavior: 'deny' })
    expect(oversized).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/exceeds 4800 bytes/i),
    })
  })

  test('allows measured natural output but rejects tool arguments beyond the safe limit', () => {
    const currentMarkdown = preamble()
    const fixedBytes = Buffer.byteLength(completeSection(''), 'utf8')
    const measuredNaturalOutput = completeSection(
      'x'.repeat(4_632 - fixedBytes),
    )
    const newString = completeSection('x'.repeat(4_801 - fixedBytes))

    expect(Buffer.byteLength(measuredNaturalOutput, 'utf8')).toBe(4_632)
    expect(
      authorize({
        currentMarkdown,
        toolName: 'Edit',
        mutation: {
          old_string: '<!-- beegame-draft-cursor:0:0 -->',
          new_string: measuredNaturalOutput,
        },
      }),
    ).toEqual({ behavior: 'allow' })
    expect(Buffer.byteLength(newString, 'utf8')).toBe(4_801)
    expect(
      authorize({
        currentMarkdown,
        toolName: 'Edit',
        mutation: {
          old_string: '<!-- beegame-draft-cursor:0:0 -->',
          new_string: newString,
        },
      }),
    ).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/tool argument exceeds 4800 bytes/i),
    })

    const writePrefix = preamble('').trimEnd()
    const oversizedWrite = `${writePrefix}\n${'x'.repeat(
      4_801 - Buffer.byteLength(writePrefix, 'utf8') - 1,
    )}`
    expect(Buffer.byteLength(oversizedWrite, 'utf8')).toBe(4_801)
    expect(
      authorize({
        toolName: 'Write',
        mutation: { content: oversizedWrite },
      }),
    ).toMatchObject({
      behavior: 'deny',
      message: expect.stringMatching(/tool argument exceeds 4800 bytes/i),
    })
  })
})
