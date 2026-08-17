import { describe, expect, test } from 'bun:test'
import {
  foundationReviewLaneMarkdownInstruction,
  parseFoundationReviewLaneMarkdown,
} from './foundation-review-markdown'

const revision = 'a'.repeat(64)
const projectionDigest = 'b'.repeat(64)

function markdown(overrides: { candidates?: string; identity?: string } = {}) {
  return [
    '# Foundation Review Packet',
    '',
    overrides.identity ??
      [
        `Revision: \`${revision}\``,
        'Lane: `core-design`',
        `Projection: \`${projectionDigest}\``,
      ].join('\n\n'),
    '',
    overrides.candidates ?? candidate('C1', '胜利条件冲突'),
    '',
  ].join('\n')
}

function candidate(
  id: string,
  title: string,
  overrides: {
    evidencePath?: string
    changes?: string
    headings?: string[]
  } = {},
) {
  const headings = overrides.headings ?? [
    'Problem',
    'Evidence',
    'Required outcome',
    'Changes',
    'Acceptance',
  ]
  const sections: Record<string, string> = {
    Problem: 'GDD 与关卡文档要求不同的唯一胜利状态。',
    Evidence: [
      `- Path: \`${overrides.evidencePath ?? 'docs/GDD.md'}\``,
      '  Location: ## 胜利条件',
      '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。',
    ].join('\n'),
    'Required outcome': '所有消费者使用同一个胜利状态。',
    Changes:
      overrides.changes ??
      '- Path: `docs/GDD.md`\n  Action: 保留唯一权威条件。',
    Acceptance: '- GDD 与关卡文档枚举完全一致。',
  }
  return [
    `## \`core-design:${id}\` — ${title}`,
    '',
    ...headings.flatMap(heading => [
      `### ${heading}`,
      '',
      sections[heading]!,
      '',
    ]),
  ]
    .join('\n')
    .trimEnd()
}

const expected = {
  revision,
  lane: 'core-design' as const,
  projectionDigest,
}

describe('foundation review lane Markdown', () => {
  test('parses a complete lane receipt without splitting inline code or pipes', () => {
    const receipt = parseFoundationReviewLaneMarkdown(markdown(), expected)

    expect(receipt).toEqual({
      revision,
      lane: 'core-design',
      projectionDigest,
      candidates: [
        {
          reference: 'core-design:C1',
          title: '胜利条件冲突',
          problem: 'GDD 与关卡文档要求不同的唯一胜利状态。',
          evidence: [
            {
              path: 'docs/GDD.md',
              location: '## 胜利条件',
              observed: '必须同时满足 `A | B`，但关卡文档只要求 A。',
            },
          ],
          requiredOutcome: '所有消费者使用同一个胜利状态。',
          changes: [{ path: 'docs/GDD.md', action: '保留唯一权威条件。' }],
          acceptance: ['GDD 与关卡文档枚举完全一致。'],
        },
      ],
    })
  })

  test('preserves multiline evidence observations', () => {
    const receipt = parseFoundationReviewLaneMarkdown(
      markdown({
        candidates: candidate('C1', '胜利条件冲突').replace(
          '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。',
          '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。\n    第二行仍属于同一条证据。',
        ),
      }),
      expected,
    )

    expect(receipt.candidates[0]?.evidence[0]?.observed).toBe(
      '必须同时满足 `A | B`，但关卡文档只要求 A。\n第二行仍属于同一条证据。',
    )
  })

  test('rejects tables and invalid receipt identities', () => {
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        '# Foundation Review Packet\n\n| column | value |\n| --- | --- |\n| x | y |',
        expected,
      ),
    ).toThrow('foundation review lane Markdown tables are forbidden')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          identity: `Revision: \`${'c'.repeat(64)}\`\n\nLane: \`core-design\`\n\nProjection: \`${projectionDigest}\``,
        }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown revision does not match')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          identity: `Revision: \`${revision}\`\n\nLane: \`presentation\`\n\nProjection: \`${projectionDigest}\``,
        }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown lane does not match')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          identity: `Revision: \`${revision}\`\n\nLane: \`core-design\`\n\nProjection: \`${'c'.repeat(64)}\``,
        }),
        expected,
      ),
    ).toThrow(
      'foundation review lane Markdown projection digest does not match',
    )
  })

  test('rejects invalid candidate structure and authority', () => {
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: Array.from({ length: 9 }, (_, index) =>
            candidate(`C${index + 1}`, `问题 ${index + 1}`),
          ).join('\n\n'),
        }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown contains more than 8 candidates')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: [candidate('C1', '第一个'), candidate('C1', '重复')].join(
            '\n\n',
          ),
        }),
        expected,
      ),
    ).toThrow(
      'foundation review lane Markdown candidate references must be unique',
    )
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '缺失', {
            headings: ['Problem', 'Evidence', 'Required outcome', 'Changes'],
          }),
        }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown candidate headings are invalid')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '空列表').replace(
            '- GDD 与关卡文档枚举完全一致。',
            '',
          ),
        }),
        expected,
      ),
    ).toThrow(
      'foundation review lane Markdown Acceptance list must not be empty',
    )
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '绝对路径', {
            evidencePath: '/tmp/GDD.md',
          }),
        }),
        expected,
      ),
    ).toThrow(
      'foundation review lane Markdown evidence path is outside lane authority',
    )
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '越权路径', {
            evidencePath: 'docs/ART_DIRECTION.md',
          }),
        }),
        expected,
      ),
    ).toThrow(
      'foundation review lane Markdown evidence path is outside lane authority',
    )
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '重复修改路径', {
            changes: [
              '- Path: `docs/GDD.md`',
              '  Action: 保留唯一权威条件。',
              '- Path: `docs/GDD.md`',
              '  Action: 删除重复条件。',
            ].join('\n'),
          }),
        }),
        expected,
      ),
    ).toThrow('foundation review conflict change paths must be unique')
  })

  test('publishes the complete lane receipt grammar', () => {
    expect(foundationReviewLaneMarkdownInstruction(expected)).toContain(
      '# Foundation Review Packet',
    )
    expect(foundationReviewLaneMarkdownInstruction(expected)).toContain(
      `Revision: \`${revision}\``,
    )
    expect(foundationReviewLaneMarkdownInstruction(expected)).toContain(
      'Markdown tables are forbidden',
    )
  })
})
