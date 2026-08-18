import { describe, expect, test } from 'bun:test'
import {
  foundationReviewLaneMarkdownInstruction,
  parseFoundationReviewLaneMarkdown,
  parseFoundationReviewSelectionMarkdown,
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
    evidence?: string
    evidencePath?: string
    changes?: string
    acceptance?: string
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
    Evidence:
      overrides.evidence ??
      [
        `- Path: \`${overrides.evidencePath ?? 'docs/GDD.md'}\``,
        '  Location: ## 胜利条件',
        '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。',
      ].join('\n'),
    'Required outcome': '所有消费者使用同一个胜利状态。',
    Changes:
      overrides.changes ??
      '- Path: `docs/GDD.md`\n  Action: 保留唯一权威条件。',
    Acceptance: overrides.acceptance ?? '- GDD 与关卡文档枚举完全一致。',
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

function selectionMarkdown(
  overrides: {
    revision?: string
    keep?: string
    duplicate?: string
    reject?: string
    extra?: string
  } = {},
) {
  return [
    '# Foundation Review Selection',
    '',
    `Revision: \`${overrides.revision ?? revision}\``,
    '',
    '## Keep',
    overrides.keep ?? '- `core-design:C1`',
    '',
    '## Duplicate',
    overrides.duplicate ?? '- `technical-assets:C1` -> `core-design:C1`',
    '',
    '## Reject',
    overrides.reject ?? '- `presentation:C1`',
    overrides.extra ?? '',
  ].join('\n')
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

  test('parses tight and loose Evidence and Changes lists identically', () => {
    const tight = parseFoundationReviewLaneMarkdown(
      markdown({
        candidates: candidate('C1', '胜利条件冲突').replace(
          '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。',
          '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。\n    第二行仍属于同一条证据。',
        ),
      }),
      expected,
    )
    const loose = parseFoundationReviewLaneMarkdown(
      markdown({
        candidates: candidate('C1', '胜利条件冲突', {
          evidence: [
            '- Path: `docs/GDD.md`',
            '',
            '  Location: ## 胜利条件',
            '',
            '  Observed: 必须同时满足 `A | B`，但关卡文档只要求 A。',
            '    第二行仍属于同一条证据。',
          ].join('\n'),
          changes: [
            '- Path: `docs/GDD.md`',
            '',
            '  Action: 保留唯一权威条件。',
          ].join('\n'),
        }),
      }),
      expected,
    )

    expect(loose.candidates).toEqual(tight.candidates)
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

  test('rejects pipe tables nested inside evidence list items', () => {
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '嵌套表格', {
            evidence: [
              '- Path: `docs/GDD.md`',
              '  Location: ## 胜利条件',
              '  Observed: 这里不应接受表格。',
              '  | 列 | 值 |',
              '  | --- | --- |',
              '  | A | B |',
            ].join('\n'),
          }),
        }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown tables are forbidden')
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
        markdown({ candidates: candidate('C1', '空证据', { evidence: '' }) }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown Evidence list must not be empty')
    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({ candidates: candidate('C1', '空修改', { changes: '' }) }),
        expected,
      ),
    ).toThrow('foundation review lane Markdown Changes list must not be empty')
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
    const repeatedPathChanges = parseFoundationReviewLaneMarkdown(
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
    )
    expect(repeatedPathChanges.candidates[0]?.changes).toEqual([
      { path: 'docs/GDD.md', action: '保留唯一权威条件。' },
      { path: 'docs/GDD.md', action: '删除重复条件。' },
    ])
  })

  test('rejects non-paragraph Evidence list item children and invalid labels', () => {
    for (const evidence of [
      '- Path: `docs/GDD.md`\n\n  - Location: nested list',
      '- Path: `docs/GDD.md`\n\n  > Location: block quote',
      '- Path: `docs/GDD.md`\n\n  ```text\n  Location: code block\n  ```',
      '- Path: `docs/GDD.md`\n\n  ### Location: nested heading',
      '- Path: `docs/GDD.md`\n  Observed: missing location',
      '- Location: ## 胜利条件\n  Path: `docs/GDD.md`\n  Observed: reordered',
    ]) {
      expect(() =>
        parseFoundationReviewLaneMarkdown(
          markdown({ candidates: candidate('C1', '无效证据', { evidence }) }),
          expected,
        ),
      ).toThrow('foundation review lane Markdown Evidence list item is invalid')
    }
  })

  test('permits projected Evidence but never projected Changes', () => {
    const projectedPath = 'docs/ART_DIRECTION.md'
    const receipt = parseFoundationReviewLaneMarkdown(
      markdown({
        candidates: candidate('C1', '投影证据', {
          evidencePath: projectedPath,
        }),
      }),
      { ...expected, allowedEvidencePaths: [projectedPath] },
    )
    expect(receipt.candidates[0]?.evidence[0]?.path).toBe(projectedPath)

    expect(() =>
      parseFoundationReviewLaneMarkdown(
        markdown({
          candidates: candidate('C1', '投影修改', {
            evidencePath: projectedPath,
            changes: `- Path: \`${projectedPath}\`\n  Action: 不得修改投影来源。`,
          }),
        }),
        { ...expected, allowedEvidencePaths: [projectedPath] },
      ),
    ).toThrow(
      'foundation review lane Markdown change path is outside lane authority',
    )
  })

  test('publishes the complete lane receipt grammar', () => {
    const instruction = foundationReviewLaneMarkdownInstruction(expected)
    expect(instruction).toContain('# Foundation Review Packet')
    expect(instruction).toContain(`Revision: \`${revision}\``)
    expect(instruction).toContain('Markdown tables are forbidden')
    expect(instruction).toContain(
      'Zero candidates is valid when no blocking defect is proven',
    )
    expect(instruction).toContain(
      'Eight candidates is a hard safety maximum, not a target',
    )
    expect(instruction).not.toContain('Report at most 8 candidates')
  })

  test('parses a compact, fully-accounted synthesis selection', () => {
    expect(
      parseFoundationReviewSelectionMarkdown(selectionMarkdown(), {
        revision,
        candidateReferences: [
          'core-design:C1',
          'technical-assets:C1',
          'presentation:C1',
        ],
      }),
    ).toEqual({
      revision,
      keep: ['core-design:C1'],
      duplicate: [{ source: 'technical-assets:C1', target: 'core-design:C1' }],
      reject: ['presentation:C1'],
    })
  })

  test('ignores a paragraph-only synthesis preface without changing selection semantics', () => {
    const bare = parseFoundationReviewSelectionMarkdown(selectionMarkdown(), {
      revision,
      candidateReferences: [
        'core-design:C1',
        'technical-assets:C1',
        'presentation:C1',
      ],
    })
    const prefaced = parseFoundationReviewSelectionMarkdown(
      `这是一个普通的前言段落。\n\n${selectionMarkdown()}`,
      {
        revision,
        candidateReferences: [
          'core-design:C1',
          'technical-assets:C1',
          'presentation:C1',
        ],
      },
    )

    expect(prefaced).toEqual(bare)
  })

  test('rejects invalid synthesis selection grammar and accounting', () => {
    const candidateReferences = [
      'core-design:C1',
      'technical-assets:C1',
      'presentation:C1',
    ]
    const parse = (value: string, references = candidateReferences) =>
      parseFoundationReviewSelectionMarkdown(value, {
        revision,
        candidateReferences: references,
      })

    expect(() =>
      parse(
        selectionMarkdown({
          keep: '- `unknown:C1`',
        }),
      ),
    ).toThrow('foundation review selection Markdown reference is unknown')
    expect(() =>
      parse(
        selectionMarkdown({
          keep: '- `core-design:C1`\n- `core-design:C1`',
        }),
      ),
    ).toThrow(
      'foundation review selection Markdown references must be accounted exactly once',
    )
    expect(() =>
      parse(selectionMarkdown({ reject: '-' }), [
        'core-design:C1',
        'technical-assets:C1',
        'presentation:C1',
        'core-design:C2',
      ]),
    ).toThrow(
      'foundation review selection Markdown references must be accounted exactly once',
    )
    expect(() =>
      parse(
        selectionMarkdown({
          keep: '- `core-design:C1`',
          duplicate: '- `technical-assets:C1` -> `presentation:C1`',
          reject: '- `presentation:C1`',
        }),
      ),
    ).toThrow(
      'foundation review selection Markdown duplicate target is not retained',
    )
    expect(() =>
      parse(
        selectionMarkdown({
          keep: '- `technical-assets:C1`',
          duplicate: '- `core-design:C1` -> `core-design:C1`',
          reject: '- `presentation:C1`',
        }),
      ),
    ).toThrow(
      'foundation review selection Markdown duplicate cannot target itself',
    )
    expect(() =>
      parse(
        selectionMarkdown({
          keep: '- `core-design:C1`',
          duplicate: '-',
          reject:
            '- `core-design:C1`\n- `technical-assets:C1`\n- `presentation:C1`',
        }),
      ),
    ).toThrow(
      'foundation review selection Markdown references must be accounted exactly once',
    )
    expect(() =>
      parse(selectionMarkdown({ extra: '\nUnexpected prose.' })),
    ).toThrow('foundation review selection Markdown structure is invalid')
    for (const prefix of [
      '## Prefix heading',
      '- Prefix list item',
      '> Prefix quote',
      '```text\nprefix code\n```',
      '<p>prefix HTML</p>',
    ]) {
      expect(() => parse(`${prefix}\n\n${selectionMarkdown()}`)).toThrow(
        'foundation review selection Markdown structure is invalid',
      )
    }
    expect(() => parse(`# Another H1\n\n${selectionMarkdown()}`)).toThrow(
      'foundation review selection Markdown requires exactly one H1 Foundation Review Selection',
    )
    expect(() =>
      parse(
        selectionMarkdown().replace('# Foundation Review Selection', '# Wrong'),
      ),
    ).toThrow(
      'foundation review selection Markdown requires exactly one H1 Foundation Review Selection',
    )
    expect(() =>
      parse(
        '# Foundation Review Selection\n\n| column | value |\n| --- | --- |',
      ),
    ).toThrow('foundation review selection Markdown tables are forbidden')
  })
})
