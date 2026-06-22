import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import {
  createCollapsePlaceholder,
  projectView,
  type CommittedCollapse,
} from '../operations'
import { restoreFromEntries } from '../persist'
import {
  applyCollapsesIfNeeded,
  getStats,
  initContextCollapse,
  isContextCollapseEnabled,
  recoverFromOverflow,
  resetContextCollapse,
} from '../index'

function uuid(index: number): `${string}-${string}-${string}-${string}-${string}` {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
}

function message(index: number, text: string): Message {
  return {
    uuid: uuid(index),
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-06-22T00:00:00.000Z',
  } as Message
}

describe('contextCollapse operations', () => {
  test('projectView replaces an archived span with one collapsed placeholder', () => {
    const messages = [
      message(1, 'keep before'),
      message(2, 'archive one'),
      message(3, 'archive two'),
      message(4, 'keep after'),
    ]
    const commit: CommittedCollapse = {
      collapseId: '0000000000000001',
      summaryUuid: uuid(101),
      summary: 'Archived two setup messages.',
      summaryContent:
        '<collapsed id="0000000000000001">Archived two setup messages.</collapsed>',
      firstArchivedUuid: uuid(2),
      lastArchivedUuid: uuid(3),
    }

    const projected = projectView(messages, [commit])

    expect(projected.map(msg => msg.uuid)).toEqual([uuid(1), uuid(101), uuid(4)])
    expect(projected[1]?.type).toBe('system')
    expect(String(projected[1]?.message?.content)).toContain(
      '<collapsed id="0000000000000001">',
    )
    expect(createCollapsePlaceholder(commit).uuid).toBe(uuid(101))
  })

  test('recoverFromOverflow commits a collapse immediately for oversized history', () => {
    resetContextCollapse()
    initContextCollapse()
    const messages = Array.from({ length: 40 }, (_, index) =>
      message(index, `overflow message ${index}`),
    )

    const drained = recoverFromOverflow(messages, 'user')

    expect(drained.committed).toBe(1)
    expect(drained.messages.length).toBeLessThan(messages.length)
    expect(JSON.stringify(drained.messages)).toContain('<collapsed id=')
  })

  test('restoreFromEntries restores committed collapse stats and projection', async () => {
    resetContextCollapse()
    initContextCollapse()
    restoreFromEntries(
      [
        {
          type: 'marble-origami-commit',
          sessionId: uuid(900),
          collapseId: '0000000000000042',
          summaryUuid: uuid(142),
          summaryContent:
            '<collapsed id="0000000000000042">Restored summary</collapsed>',
          summary: 'Restored summary',
          firstArchivedUuid: uuid(1),
          lastArchivedUuid: uuid(2),
        },
      ],
      undefined,
    )

    const result = await applyCollapsesIfNeeded(
      [
        message(0, 'before'),
        message(1, 'old one'),
        message(2, 'old two'),
        message(3, 'after'),
      ],
      {} as never,
      'user',
    )

    expect(result.messages.map(msg => msg.uuid)).toEqual([
      uuid(0),
      uuid(142),
      uuid(3),
    ])
    expect(getStats().collapsedSpans).toBe(1)
  })
})

describe('contextCollapse runtime', () => {
  test('applyCollapsesIfNeeded commits an old span when the message list is long', async () => {
    resetContextCollapse()
    initContextCollapse()
    const messages = Array.from({ length: 36 }, (_, index) =>
      message(index, `message ${index} with important file src/file${index}.ts`),
    )

    const result = await applyCollapsesIfNeeded(messages, {} as never, 'user')

    expect(isContextCollapseEnabled()).toBe(true)
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(JSON.stringify(result.messages)).toContain('<collapsed id=')
    expect(getStats().collapsedSpans).toBe(1)
    expect(getStats().collapsedMessages).toBeGreaterThan(0)
  })
})
