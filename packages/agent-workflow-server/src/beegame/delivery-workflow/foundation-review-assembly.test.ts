import { describe, expect, test } from 'bun:test'
import type {
  FoundationReviewCandidate,
  FoundationReviewLaneReceipt,
} from './foundation-review-markdown'
import { parseFoundationReviewSelectionMarkdown } from './foundation-review-markdown'
import { assembleFoundationReview } from './foundation-review-assembly'

const revision = 'a'.repeat(64)

function candidate(
  reference:
    | `core-design:C${number}`
    | `technical-assets:C${number}`
    | `presentation:C${number}`,
  title: string,
): FoundationReviewCandidate {
  return {
    reference,
    title,
    problem: `${title} blocks implementation.`,
    evidence: [
      {
        path:
          reference.startsWith('presentation:')
            ? 'docs/ART_DIRECTION.md'
            : reference.startsWith('technical-assets:')
              ? 'docs/TECHNICAL_DESIGN.md'
              : 'docs/GDD.md',
        location: '## Contract',
        observed: `${title} is inconsistent.`,
      },
    ],
    requiredOutcome: `${title} has one authority.`,
    changes: [
      {
        path:
          reference.startsWith('presentation:')
            ? 'docs/ART_DIRECTION.md'
            : reference.startsWith('technical-assets:')
              ? 'docs/TECHNICAL_DESIGN.md'
              : 'docs/GDD.md',
        action: `Resolve ${title}.`,
      },
    ],
    acceptance: [`${title} is verified.`],
  }
}

const laneReceipts: FoundationReviewLaneReceipt[] = [
  {
    revision,
    lane: 'core-design',
    projectionDigest: 'b'.repeat(64),
    candidates: [
      candidate('core-design:C1', 'Core blocker'),
      candidate('core-design:C2', 'Duplicate core blocker'),
    ],
  },
  {
    revision,
    lane: 'technical-assets',
    projectionDigest: 'c'.repeat(64),
    candidates: [candidate('technical-assets:C1', 'Technical blocker')],
  },
  {
    revision,
    lane: 'presentation',
    projectionDigest: 'd'.repeat(64),
    candidates: [candidate('presentation:C1', 'Presentation blocker')],
  },
]

const candidateReferences = [
  'core-design:C1',
  'core-design:C2',
  'technical-assets:C1',
  'presentation:C1',
]

function selectionMarkdown(keep = '- `core-design:C1`\n- `presentation:C1`') {
  return [
    '# Foundation Review Selection',
    '',
    `Revision: \`${revision}\``,
    '',
    '## Keep',
    keep,
    '',
    '## Duplicate',
    '- `core-design:C2` -> `core-design:C1`',
    '',
    '## Reject',
    '- `technical-assets:C1`',
    '',
  ].join('\n')
}

describe('foundation review assembly', () => {
  test('assembles retained candidates deterministically without merging duplicates', () => {
    const review = assembleFoundationReview({
      revision,
      laneReceipts,
      selection: parseFoundationReviewSelectionMarkdown(selectionMarkdown(), {
        revision,
        candidateReferences,
      }),
    })

    expect(review.verdict).toBe('NEEDS_REVISION')
    expect(review.conflicts.map(conflict => conflict.id)).toEqual(['B1', 'B2'])
    expect(review.conflicts.map(conflict => conflict.title)).toEqual([
      laneReceipts[0]!.candidates[0]!.title,
      laneReceipts[2]!.candidates[0]!.title,
    ])
    review.conflicts[0]!.evidence[0]!.observed = 'changed copy'
    expect(laneReceipts[0]!.candidates[0]!.evidence[0]!.observed).toBe(
      'Core blocker is inconsistent.',
    )
  })

  test('produces byte-identical JSON when lane and keep ordering are reversed', () => {
    const forward = assembleFoundationReview({
      revision,
      laneReceipts,
      selection: parseFoundationReviewSelectionMarkdown(selectionMarkdown(), {
        revision,
        candidateReferences,
      }),
    })
    const reversed = assembleFoundationReview({
      revision,
      laneReceipts: [...laneReceipts].reverse(),
      selection: parseFoundationReviewSelectionMarkdown(
        selectionMarkdown('- `presentation:C1`\n- `core-design:C1`'),
        { revision, candidateReferences: [...candidateReferences].reverse() },
      ),
    })

    expect(JSON.stringify(reversed)).toBe(JSON.stringify(forward))
  })

  test('returns READY from empty receipts and empty selection sections', () => {
    expect(
      assembleFoundationReview({
        revision,
        laneReceipts: [],
        selection: parseFoundationReviewSelectionMarkdown(
          [
            '# Foundation Review Selection',
            '',
            `Revision: \`${revision}\``,
            '',
            '## Keep',
            '-',
            '',
            '## Duplicate',
            '-',
            '',
            '## Reject',
            '-',
          ].join('\n'),
          { revision, candidateReferences: [] },
        ),
      }),
    ).toMatchObject({ verdict: 'READY', conflicts: [] })
  })
})
