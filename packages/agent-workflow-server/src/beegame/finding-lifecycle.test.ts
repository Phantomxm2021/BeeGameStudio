import { describe, expect, test } from 'bun:test'
import { materializeFindings, reconcileFindings } from './finding-lifecycle'

describe('finding lifecycle normalization', () => {
  test('deduplicates repeated reports and binds identity to the evidence stream', () => {
    const result = materializeFindings({
      stream: 'document-review',
      revision: 'docs-v3',
      observedAt: '2026-07-28T00:00:00.000Z',
      findings: [
        { source: ' checklist ', detail: ' Missing acceptance evidence ' },
        { source: 'checklist', detail: 'Missing acceptance evidence' },
        { source: '', detail: 'ignored' },
      ],
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(expect.objectContaining({
      source: 'checklist',
      detail: 'Missing acceptance evidence',
      status: 'open',
      revision: 'docs-v3',
    }))
    expect(result[0]?.id).toMatch(/^[a-f0-9]{64}$/)
  })

  test('does not merge findings from different evidence streams', () => {
    const input = {
      revision: 'same-revision',
      observedAt: '2026-07-28T00:00:00.000Z',
      findings: [{ source: 'audit', detail: 'Missing runtime evidence' }],
    }
    const documentFinding = materializeFindings({ stream: 'document-review', ...input })[0]
    const acceptanceFinding = materializeFindings({ stream: 'runtime-acceptance', ...input })[0]

    expect(documentFinding?.id).not.toBe(acceptanceFinding?.id)
  })

  test('resolves absent findings and reopens findings that return', () => {
    const previous = materializeFindings({
      stream: 'implementation-audit',
      revision: 'v1',
      observedAt: '2026-07-27T00:00:00.000Z',
      findings: [{ source: 'audit', detail: 'Missing runtime evidence' }],
    })
    const resolved = reconcileFindings({
      previous,
      current: [],
      observedAt: '2026-07-28T00:00:00.000Z',
      revision: 'v2',
    })
    expect(resolved[0]).toEqual(expect.objectContaining({ status: 'resolved', revision: 'v2' }))

    const reopened = reconcileFindings({
      previous: resolved,
      current: materializeFindings({
        stream: 'implementation-audit',
        revision: 'v3',
        observedAt: '2026-07-29T00:00:00.000Z',
        findings: [{ source: 'audit', detail: 'Missing runtime evidence' }],
      }),
      observedAt: '2026-07-29T00:00:00.000Z',
      revision: 'v3',
    })
    expect(reopened[0]).toEqual(expect.objectContaining({ status: 'reopened', revision: 'v3' }))
    expect(reopened[0]?.firstObservedAt).toBe('2026-07-27T00:00:00.000Z')
  })
})
