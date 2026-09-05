import { readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { completeTestSubmission, renderTestCompleteGameDocument } from '../__tests__/complete-game-document-fixture'
import {
  createFoundationMarkdownStreamSink,
  foundationMarkdownPendingPath,
} from './foundation-markdown-stream'
import {
  canonicalFoundationAuthorityProjectionBytes,
  foundationProjectionRelativePath,
  projectFoundationAuthority,
} from './foundation-authority-projection'

const targetPath = 'docs/GDD.md' as const

function streamEvent(event: Record<string, unknown>) {
  return { type: 'stream_event', event }
}

function successfulMessages(markdown: string): Record<string, unknown>[] {
  const split = Math.floor(markdown.length / 2)
  return [
    streamEvent({
      type: 'message_start',
      message: { id: 'message-1' },
    }),
    streamEvent({
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: markdown.slice(0, split) },
    }),
    streamEvent({
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: markdown.slice(split) },
    }),
    streamEvent({ type: 'content_block_stop', index: 0 }),
    {
      type: 'assistant',
      message: { id: 'message-1', content: [{ type: 'text', text: markdown }] },
    },
    { type: 'result', subtype: 'success', is_error: false },
  ]
}

async function writeEmptyGddProjection(workspacePath: string, dispatchId: string): Promise<void> {
  const projection = projectFoundationAuthority({
    targetPath,
    availableUpstreamPaths: [],
    documents: new Map(),
  })
  const projectionPath = join(workspacePath, foundationProjectionRelativePath(dispatchId))
  await mkdir(join(workspacePath, '.beegame/workflow/document-projections'), { recursive: true })
  await writeFile(projectionPath, canonicalFoundationAuthorityProjectionBytes(projection))
}

describe('foundation Markdown stream sink', () => {
  test('publishes ordered text blocks produced by a native max-token continuation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-continuation-'))
    try {
      const markdown = renderTestCompleteGameDocument(
        targetPath,
        completeTestSubmission(targetPath),
      )
      const split = Math.floor(markdown.length / 2)
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-continuation',
        dispatchId: 'dispatch-continuation',
        targetPath,
        maxBytes: 512_000,
        updatedAt: '2026-08-15T01:00:00.000+08:00',
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-continuation')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-1' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown.slice(0, split) },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({
          type: 'message_delta',
          delta: { stop_reason: 'max_tokens' },
        }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-2' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown.slice(split) },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
        }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false },
      ]) sink.observe(message)

      await sink.commit()

      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toContain(
        markdown,
      )
      expect(await readFile(
        foundationMarkdownPendingPath(
          workspacePath,
          'run-continuation',
          'dispatch-continuation',
        ),
        'utf8',
      )).toBe(markdown)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('does not replace a streamed continuation chain with the terminal tail', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-terminal-tail-'))
    try {
      const prefix = '# GDD\n\n## Executive Summary\n\nThe first message owns the beginning.\n'
      const suffix = '\n## Balance Goals\n\nThe continuation owns the ending.\n'
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-terminal-tail',
        dispatchId: 'dispatch-terminal-tail',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-terminal-tail')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-prefix' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: prefix },
        }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-suffix' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: suffix },
        }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false, result: suffix },
      ]) sink.observe(message)

      await sink.commit()

      expect(await readFile(
        foundationMarkdownPendingPath(
          workspacePath,
          'run-terminal-tail',
          'dispatch-terminal-tail',
        ),
        'utf8',
      )).toBe(prefix + suffix)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('does not concatenate a new non-continuation message as another document segment', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-retry-message-'))
    try {
      const first = '# stale attempt\n'
      const replacement = '# replacement attempt\n'
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-retry-message',
        dispatchId: 'dispatch-retry-message',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-retry-message')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-first' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: first },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-replacement' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: replacement },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false },
      ]) sink.observe(message)

      await sink.commit()

      expect(await readFile(
        foundationMarkdownPendingPath(
          workspacePath,
          'run-retry-message',
          'dispatch-retry-message',
        ),
        'utf8',
      )).toBe(replacement)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a max-token chain that has no completed continuation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-open-continuation-'))
    try {
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-open-continuation',
        dispatchId: 'dispatch-open-continuation',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-open-continuation')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-open' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: '# Incomplete document' },
        }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false, result: 'tail only' },
      ]) sink.observe(message)

      await expect(sink.commit()).rejects.toThrow(/continuation/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a terminal result unrelated to a completed continuation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-mismatched-terminal-'))
    try {
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-mismatched-terminal',
        dispatchId: 'dispatch-mismatched-terminal',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-mismatched-terminal')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-prefix' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'prefix\n' },
        }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-suffix' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'suffix\n' },
        }),
        streamEvent({ type: 'content_block_stop', index: 1 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false, result: 'unrelated' },
      ]) sink.observe(message)

      await expect(sink.commit()).rejects.toThrow(/match continuation/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects a continuation when the previous text block never closed', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-open-text-block-'))
    try {
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-open-text-block',
        dispatchId: 'dispatch-open-text-block',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-open-text-block')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-open' } }),
        streamEvent({
          type: 'content_block_start',
          index: 1,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 1,
          delta: { type: 'text_delta', text: 'partial' },
        }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-next' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'thinking', thinking: '' },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false, result: 'tail only' },
      ]) sink.observe(message)

      await expect(sink.commit()).rejects.toThrow(/text block closed/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('replaces an incomplete trailing line replayed by a native continuation', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-line-replay-'))
    try {
      const markdown = renderTestCompleteGameDocument(
        targetPath,
        completeTestSubmission(targetPath),
      )
      const lineStart = markdown.indexOf('Production-ready Core and Session Loops')
      const split = lineStart + 'Production-ready Core'.length
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-line-replay',
        dispatchId: 'dispatch-line-replay',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-line-replay')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-1' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown.slice(0, split) },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }),
        streamEvent({ type: 'message_stop' }),
        streamEvent({ type: 'message_start', message: { id: 'message-2' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown.slice(lineStart) },
        }),
        streamEvent({ type: 'content_block_stop', index: 0 }),
        streamEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }),
        streamEvent({ type: 'message_stop' }),
        { type: 'result', subtype: 'success', is_error: false },
      ]) sink.observe(message)

      await sink.commit()

      expect(await readFile(
        foundationMarkdownPendingPath(
          workspacePath,
          'run-line-replay',
          'dispatch-line-replay',
        ),
        'utf8',
      )).toBe(markdown)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('publishes ordered visible text once and keeps the body out of the receipt', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-stream-'))
    try {
      const markdown = renderTestCompleteGameDocument(
        targetPath,
        completeTestSubmission(targetPath),
      )
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-1',
        dispatchId: 'dispatch-1',
        targetPath,
        maxBytes: 512_000,
        updatedAt: '2026-08-15T01:00:00.000+08:00',
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-1')

      for (const message of successfulMessages(markdown)) sink.observe(message)
      const receipt = await sink.commit()

      const committed = await readFile(join(workspacePath, targetPath), 'utf8')
      expect(committed).toContain(markdown)
      expect(committed.match(/<!-- beegame-executive-summary -->/g)).toHaveLength(1)
      expect(receipt).toMatchObject({
        schemaVersion: 5,
        dispatchId: 'dispatch-1',
        targetPath,
        byteLength: Buffer.byteLength(committed),
        status: 'committed',
      })
      expect(JSON.stringify(receipt)).not.toContain(markdown.slice(0, 100))
      expect(await readFile(
        foundationMarkdownPendingPath(workspacePath, 'run-1', 'dispatch-1'),
        'utf8',
      )).toBe(markdown)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('uses the successful terminal Markdown when provider stream framing is incomplete', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-terminal-authority-'))
    try {
      const markdown = renderTestCompleteGameDocument(
        targetPath,
        completeTestSubmission(targetPath),
      )
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-terminal-authority',
        dispatchId: 'dispatch-terminal-authority',
        targetPath,
        maxBytes: 512_000,
      })
      await writeEmptyGddProjection(workspacePath, 'dispatch-terminal-authority')

      for (const message of [
        streamEvent({ type: 'message_start', message: { id: 'message-1' } }),
        streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '# Abandoned provider draft' },
        }),
        // Some compatible providers omit content_block_stop/message_stop and
        // return a rewritten complete document only in the terminal envelope.
        {
          type: 'result',
          subtype: 'success',
          is_error: false,
          result: markdown,
        },
      ]) sink.observe(message)

      await sink.commit()

      expect(await readFile(
        foundationMarkdownPendingPath(
          workspacePath,
          'run-terminal-authority',
          'dispatch-terminal-authority',
        ),
        'utf8',
      )).toBe(markdown)
      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toContain(
        markdown,
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects tool use without replacing an existing canonical document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-tool-'))
    try {
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, targetPath), 'existing canonical bytes')
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-2',
        dispatchId: 'dispatch-2',
        targetPath,
        maxBytes: 512_000,
      })
      sink.observe(streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool-1', name: 'Write' },
      }))
      sink.observe({ type: 'result', subtype: 'success', is_error: false })

      await expect(sink.commit()).rejects.toThrow(/tool/i)
      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toBe(
        'existing canonical bytes',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects an incomplete or oversized response before publication', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-incomplete-'))
    try {
      const incomplete = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-3',
        dispatchId: 'dispatch-3',
        targetPath,
        maxBytes: 512_000,
      })
      incomplete.observe(streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }))
      incomplete.observe(streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '# Partial' },
      }))
      await expect(incomplete.commit()).rejects.toThrow(/terminal|complete/i)

      const oversized = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-3',
        dispatchId: 'dispatch-4',
        targetPath,
        maxBytes: 8,
      })
      oversized.observe(streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }))
      oversized.observe(streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '123456789' },
      }))
      oversized.observe({ type: 'result', subtype: 'success', is_error: false })
      await expect(oversized.commit()).rejects.toThrow(/maximum|bytes/i)
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('rejects replayed events and a changed target baseline', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-replay-'))
    try {
      const markdown = renderTestCompleteGameDocument(
        targetPath,
        completeTestSubmission(targetPath),
      )
      const replayed = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-4',
        dispatchId: 'dispatch-5',
        targetPath,
        maxBytes: 512_000,
      })
      replayed.observe({
        ...streamEvent({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        }),
        uuid: 'event-1',
      })
      replayed.observe({
        ...streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown },
        }),
        uuid: 'event-2',
      })
      replayed.observe({
        ...streamEvent({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: markdown },
        }),
        uuid: 'event-2',
      })
      await expect(replayed.commit()).rejects.toThrow(/replayed/i)

      const changed = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-4',
        dispatchId: 'dispatch-6',
        targetPath,
        maxBytes: 512_000,
      })
      await mkdir(join(workspacePath, 'docs'), { recursive: true })
      await writeFile(join(workspacePath, targetPath), 'changed during stream')
      for (const message of successfulMessages(markdown)) changed.observe(message)
      await expect(changed.commit()).rejects.toThrow(/changed during generation/i)
      expect(await readFile(join(workspacePath, targetPath), 'utf8')).toBe(
        'changed during stream',
      )
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  test('aborts without publishing a partial document', async () => {
    const workspacePath = await mkdtemp(join(tmpdir(), 'foundation-abort-'))
    try {
      const sink = await createFoundationMarkdownStreamSink({
        workspacePath,
        runId: 'run-5',
        dispatchId: 'dispatch-7',
        targetPath,
        maxBytes: 512_000,
      })
      sink.observe(streamEvent({
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      }))
      sink.observe(streamEvent({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '# Partial' },
      }))
      await sink.abort('worker stopped')
      await expect(sink.commit()).rejects.toThrow(/worker stopped/i)
      await expect(readFile(join(workspacePath, targetPath), 'utf8')).rejects.toThrow()
    } finally {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })
})
