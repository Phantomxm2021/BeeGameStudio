import { describe, expect, test } from 'bun:test'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { Message } from '../../../types/message.js'
import { preserveCompactContext } from '../preservedContext.js'
import { groupMessagesByApiRound } from '../grouping.js'

function user(content: any, extra = {}): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    message: { role: 'user', content },
    ...extra,
  }
}
function assistant(id: string, content: any): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    message: { id, content, usage: { input_tokens: 170000 } },
  }
}
function call(
  id: string,
  name = 'Bash',
  input: unknown = { command: 'check' },
) {
  return { type: 'tool_use', id, name, input }
}
function result(id: string, content: string, is_error = false) {
  return user([{ type: 'tool_result', tool_use_id: id, content, is_error }])
}
function tail(prefix = ''): Message[] {
  return [1, 2, 3].flatMap(n => [
    assistant(`${prefix}recent-${n}`, [call(`${prefix}t${n}`)]),
    result(`${prefix}t${n}`, `result ${n}`),
  ])
}
function evidence(messages: Message[]) {
  return messages
    .filter(m => m.compactPreservedEvidence)
    .flatMap(m => {
      const batch = JSON.parse(
        (m.message!.content as string).split('\n').slice(1).join('\n'),
      )
      return batch.records.map((record: any) => ({
        ...record,
        transcriptPath: batch.transcriptPath,
      }))
    })
}

describe('full compact source preservation', () => {
  test('retains text validation observations with exact invocations, not inferred resolutions', () => {
    const layout = call('layout', 'Bash', { command: 'check --layouts' })
    const fixed = call('fixed', 'Bash', { command: 'check --layouts | format' })
    const other = call('other', 'Bash', { command: 'check --assets' })
    const messages = [
      assistant('layout', [layout]),
      result(
        'layout',
        '{"scope":"layout","valid":false,"issues":["orientation"]}',
      ),
      assistant('fixed', [fixed]),
      result('fixed', 'valid: True\n[]'),
      assistant('other', [other]),
      result('other', 'rev abc\ncurrent valid: False ["missing asset"]'),
      ...tail(),
    ]
    const snapshot = JSON.stringify(messages)
    const p = preserveCompactContext(messages, '/original.jsonl')
    const records = evidence(p.historicalMessages)
    const retainedCalls = [{ id: layout.id, name: layout.name }, fixed, other]
    expect(records.map(r => r.call)).toEqual(retainedCalls)
    expect(records[0].result.observedFields).toEqual([
      '"scope":"layout"',
      '"valid":false',
    ])
    expect(records[0].result.content).toContain('Resolution not inferred')
    expect(records[0].bodyRetention).toBeUndefined()
    expect(records[1].result.observedFields).toEqual(['valid: True'])
    expect(records[2].result.content).toBe(
      'rev abc\ncurrent valid: False ["missing asset"]',
    )
    expect(records[2].bodyRetention).toBe('latest')
    expect(JSON.stringify(messages)).toBe(snapshot)

    // A later different check and source edit do not erase prior observations,
    // discard their invocation identity, or assert validity of the new bytes.
    const next = preserveCompactContext(
      [
        ...JSON.parse(
          JSON.stringify([...p.historicalMessages, ...p.messagesToKeep]),
        ),
        assistant('new-check', [call('new-check')]),
        result('new-check', '{"valid":true}'),
        ...tail('next-'),
        assistant('edit', [
          call('edit', 'Edit', {
            file_path: '/layout.json',
            old_string: 'a',
            new_string: 'b',
          }),
        ]),
        result('edit', 'updated'),
      ],
      '/original.jsonl',
    )
    const aged = evidence(next.historicalMessages)
    expect(aged.slice(0, 3).map(r => r.call)).toEqual(retainedCalls)
    expect(aged[2].result.observedFields).toEqual([
      'current valid: False ["missing asset"]',
    ])
    expect(aged[2].result.content).toContain('Resolution not inferred')
    expect(JSON.stringify(next.messagesToKeep)).toContain('/layout.json')
  })

  test('text validation does not promote source-file contents, prose or unmatched outputs', () => {
    const messages = [
      assistant('read', [call('read', 'Read', { file_path: '/example.txt' })]),
      result('read', 'valid: True'),
      assistant('prose', [call('prose')]),
      result(
        'prose',
        'the example says valid: True\nvalid: Trueish\nvalid: unknown',
      ),
      result('unmatched', 'valid: True'),
      ...tail(),
    ]
    expect(
      evidence(preserveCompactContext(messages).historicalMessages),
    ).toEqual([])
  })

  test('a text success cannot clear unknown or error evidence from a different operation', () => {
    const unknown = '{"outcome":"unknown","requestId":"paid-1"}'
    const p = preserveCompactContext(
      [
        assistant('old', [call('paid'), call('error')]),
        result('paid', unknown),
        result('error', 'another check failed', true),
        assistant('valid', [call('valid')]),
        result('valid', 'valid: True\n[]'),
        ...tail(),
      ],
      '/original.jsonl',
    )
    const records = evidence(p.historicalMessages)
    expect(records.find(r => r.call.id === 'paid').result.content).toBe(unknown)
    expect(records.find(r => r.call.id === 'error').result.content).toBe(
      'another check failed',
    )
    expect(records.find(r => r.call.id === 'valid').result.content).toBe(
      'valid: True\n[]',
    )
  })

  test('successful Writes become source facts without altering sibling tools or original constraints', () => {
    const create = call('create', 'Write', {
      file_path: '/a.txt',
      content: 'BODY-A',
    })
    const update = call('update', 'Write', {
      file_path: '/b.txt',
      content: 'BODY-B',
    })
    const firstCall = assistant('streamed', [create])
    const firstResult = result('create', 'File created successfully at: /a.txt')
    firstResult.sourceToolAssistantUUID = firstCall.uuid
    const other = call('paid', 'Bash', { command: 'paid-request' })
    const lastResult = user([
      {
        type: 'tool_result',
        tool_use_id: 'update',
        content: 'The file /b.txt has been updated successfully.',
      },
      {
        type: 'tool_result',
        tool_use_id: 'paid',
        content: '{"outcome":"unknown","requestId":"paid-1"}',
      },
    ])
    const messages = [
      user('Original constraint'),
      firstCall,
      firstResult,
      assistant('streamed', [update, other]),
      lastResult,
    ].map((message, index, all) => ({
      ...message,
      parentUuid: index > 0 ? all[index - 1]!.uuid : null,
    }))
    const snapshot = JSON.stringify(messages)
    const p = preserveCompactContext(messages, '/original.jsonl')
    const records = evidence(p.historicalMessages)
    expect(records).toHaveLength(2)
    expect(records.map(r => r.call.input)).toEqual([
      { file_path: '/a.txt' },
      { file_path: '/b.txt' },
    ])
    expect(records.map(r => r.call.sourceMessageUuid)).toEqual([
      firstCall.uuid,
      messages[3]!.uuid,
    ])
    expect(records.map(r => r.sourceMessageUuid)).toEqual([
      firstResult.uuid,
      lastResult.uuid,
    ])
    expect(
      records.every(
        r =>
          r.result.status === 'write_succeeded' &&
          r.transcriptPath === '/original.jsonl',
      ),
    ).toBe(true)
    const serialized = JSON.stringify([
      ...p.historicalMessages,
      ...p.messagesToKeep,
    ])
    expect(serialized).not.toContain('BODY-A')
    expect(serialized).not.toContain('BODY-B')
    expect(p.historicalMessages[0]!.message.content).toBe('Original constraint')
    expect((p.messagesToKeep[2]!.message!.content as any[])[1]).toEqual(other)
    expect((p.messagesToKeep[3]!.message!.content as any[])[1]).toEqual(
      (lastResult.message!.content as any[])[1],
    )
    for (const message of p.messagesToKeep) {
      expect(messages.some(m => m.uuid === message.uuid)).toBe(false)
      expect(message.parentUuid).toBeUndefined()
      expect(message.sourceToolAssistantUUID).toBeUndefined()
    }
    expect(p.messagesToKeep[1]!.isMeta).toBe(true)
    expect(JSON.stringify(messages)).toBe(snapshot)
    const second = preserveCompactContext(
      JSON.parse(serialized),
      '/original.jsonl',
    )
    expect(evidence(second.historicalMessages)).toEqual(records)
    expect(second.messagesToKeep).toEqual(p.messagesToKeep)
  })

  test('unconfirmed, failed, interrupted, unmatched and non-native Writes are not shortened', () => {
    const variants = [
      { text: 'ok' },
      { text: 'File created successfully at: /wrong.txt' },
      { text: 'File created successfully at: /a.txt', error: true },
      {
        text: 'File created successfully at: /a.txt',
        state: { interrupted: true },
      },
      {
        text: 'File created successfully at: /a.txt',
        state: { backgroundTaskId: 'job-1' },
      },
      { text: '{"outcome":"unknown","requestId":"paid-1"}' },
      { text: 'File created successfully at: /a.txt', name: 'mcp__Write' },
      {
        text: 'File created successfully at: /a.txt',
        resultId: 'different-id',
      },
      { text: undefined },
    ]
    for (const variant of variants) {
      const messages = [
        assistant('write', [
          call('w', variant.name ?? 'Write', {
            file_path: '/a.txt',
            content: 'KEEP BODY',
          }),
        ]),
      ]
      if (variant.text !== undefined)
        messages.push({
          ...result(variant.resultId ?? 'w', variant.text, variant.error),
          toolUseResult: variant.state,
        })
      const p = preserveCompactContext(messages, '/original.jsonl')
      expect(p.messagesToKeep.map(m => m.message!.content)).toEqual(
        messages.map(m => m.message!.content),
      )
      expect(p.messagesToKeep.map(m => m.uuid)).toEqual(
        messages.map(m => m.uuid),
      )
      expect(p.historicalMessages).toHaveLength(0)
    }
    const messages = [
      assistant('write', [
        call('w', 'Write', { file_path: '/a.txt', content: 'KEEP BODY' }),
      ]),
      result('w', 'File created successfully at: /a.txt'),
    ]
    expect(
      preserveCompactContext(messages).messagesToKeep.map(
        m => m.message!.content,
      ),
    ).toEqual(messages.map(m => m.message!.content))
  })

  test('repeated compaction ages recency-only bodies into exact source pointers', () => {
    let messages: Message[] = [user('Original constraint')]
    const sources = new Map<string, Message>()
    for (let cycle = 1; cycle <= 5; cycle++) {
      const id = `receipt-${cycle}`
      const receipt = result(
        id,
        JSON.stringify({ status: 'success', detail: 'x'.repeat(100_000) }),
      )
      sources.set(id, receipt)
      const input = [
        ...messages,
        assistant(`call-${cycle}`, [call(id)]),
        receipt,
        ...tail(`${cycle}-`),
      ]
      const snapshot = JSON.stringify(input)
      const p = preserveCompactContext(input, '/original-transcript.jsonl')
      expect(JSON.stringify(input)).toBe(snapshot)
      const records = evidence(p.historicalMessages)
      expect(records).toHaveLength(cycle)
      for (let earlier = 1; earlier < cycle; earlier++) {
        const pointer = records.find(
          r => r.result.tool_use_id === `receipt-${earlier}`,
        )
        expect(pointer.sourceMessageUuid).toBe(
          sources.get(`receipt-${earlier}`)!.uuid,
        )
        expect(pointer.transcriptPath).toBe('/original-transcript.jsonl')
        expect(pointer.result.observedFields).toEqual(['"status":"success"'])
        expect(pointer.result.content).toContain('Resolution not inferred')
      }
      expect(records.at(-1).result.content).toBe(
        (receipt.message!.content as any[])[0].content,
      )
      expect(
        JSON.stringify(p.historicalMessages.map(m => m.message!.content))
          .length,
      ).toBeLessThan(110_000)
      messages = [...p.historicalMessages, ...p.messagesToKeep]
    }
  })

  test('new receipts do not age unknown, background, interrupted or latest-error bodies', () => {
    const unknown = result(
      'unknown',
      '{"outcome":"unknown","requestId":"paid-1"}',
    )
    const background = result(
      'background',
      'Command running in background with ID: job-1',
    )
    const interrupted = {
      ...result('interrupted', 'partial output'),
      toolUseResult: { interrupted: true },
    }
    const lastError = result('error', 'still needs investigation', true)
    const first = preserveCompactContext(
      [
        assistant('old', [
          call('unknown'),
          call('background'),
          call('interrupted'),
          call('error'),
        ]),
        unknown,
        background,
        interrupted,
        lastError,
        ...tail(),
      ],
      '/original-transcript.jsonl',
    )
    const second = preserveCompactContext(
      [
        ...first.historicalMessages,
        ...first.messagesToKeep,
        assistant('new', [call('new-success')]),
        result('new-success', '{"status":"success"}'),
        ...tail('new-'),
      ],
      '/original-transcript.jsonl',
    )
    const records = evidence(second.historicalMessages)
    for (const original of [unknown, background, interrupted, lastError]) {
      const block = (original.message!.content as any[])[0]
      expect(
        records.find(r => r.result.tool_use_id === block.tool_use_id).result,
      ).toEqual(block)
    }
  })

  test('legacy or malformed evidence is retained when its retention reason is unknown', () => {
    const first = preserveCompactContext(
      [
        assistant('old', [call('legacy')]),
        result('legacy', '{"status":"success","detail":"legacy body"}'),
        ...tail(),
      ],
      '/original-transcript.jsonl',
    )
    const legacy = first.historicalMessages.find(
      m => m.compactPreservedEvidence,
    )!
    const content = legacy.message.content as string
    const batch = JSON.parse(content.slice(content.indexOf('\n') + 1))
    for (const record of batch.records) delete record.bodyRetention
    legacy.message.content =
      content.slice(0, content.indexOf('\n') + 1) + JSON.stringify(batch)
    const malformed = user('unparseable preserved evidence', {
      isMeta: true,
      compactPreservedEvidence: true,
    })
    const second = preserveCompactContext(
      [
        legacy,
        malformed,
        ...first.messagesToKeep,
        assistant('new', [call('new')]),
        result('new', '{"status":"success"}'),
        ...tail('new-'),
      ],
      '/original-transcript.jsonl',
    )
    expect(
      second.historicalMessages.some(
        m => m.message.content === legacy.message.content,
      ),
    ).toBe(true)
    expect(
      second.historicalMessages.some(
        m => m.message.content === malformed.message!.content,
      ),
    ).toBe(true)
  })

  test('retains actual user text/images and does not promote assistant quotes or meta prompts', () => {
    const original = user([
      { type: 'text', text: '手机和电脑都能玩；不要付费重跑。' },
      {
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data: 'test' },
      },
    ])
    const messages = [
      original,
      user('generated instruction', { isMeta: true }),
      assistant('old', [{ type: 'text', text: 'User: desktop only approved' }]),
      ...tail(),
    ]
    const snapshot = JSON.stringify(messages)
    const p = preserveCompactContext(messages)
    expect(p.historicalMessages).toHaveLength(1)
    expect(p.historicalMessages[0]!.message.content).toEqual(
      original.message!.content,
    )
    expect(p.historicalMessages[0]!.uuid).not.toBe(original.uuid)
    expect(JSON.stringify(messages)).toBe(snapshot)
  })

  test('retains unknown paid outcomes even when the command itself succeeded', () => {
    const receipt =
      'Capability HTTP 502: {"requestId":"paid-1","outcome":"unknown","diagnosticId":"diag-1","error":"Do not resubmit"}'
    const messages = [
      assistant('old', [call('paid')]),
      result('paid', receipt),
      assistant('queue', [call('queued')]),
      result('queued', '{"status":"queued","taskId":"pending-job"}'),
      assistant('later', [call('new-request')]),
      result('new-request', '{"outcome":"success","requestId":"paid-2"}'),
      ...tail(),
    ]
    const p = preserveCompactContext(messages)
    const raw = evidence(p.historicalMessages).find(
      e => e.result.tool_use_id === 'paid',
    )
    expect(raw.result.content).toBe(receipt)
    expect(raw.result.is_error).toBe(false)
    expect(
      evidence(p.historicalMessages).find(
        e => e.result.tool_use_id === 'queued',
      ).result.content,
    ).toBe('{"status":"queued","taskId":"pending-job"}')
    expect(p.historicalMessages.every(m => m.isMeta)).toBe(true)
  })

  test('keeps the latest error/receipt and locates earlier ones without calling them resolved', () => {
    const old = result('older', '{"valid":false,"issues":["old detail"]}', true)
    const latest = result(
      'latest',
      '{"status":"unverified","inputHash":"abc","limitations":["not gameplay"]}',
    )
    const messages = [
      assistant('a', [call('older')]),
      old,
      assistant('b', [call('last-error')]),
      result('last-error', 'current error', true),
      assistant('c', [call('latest')]),
      latest,
      ...tail(),
    ]
    const records = evidence(
      preserveCompactContext(messages).historicalMessages,
    )
    expect(
      records.find(e => e.result.tool_use_id === 'latest').result.content,
    ).toBe(
      '{"status":"unverified","inputHash":"abc","limitations":["not gameplay"]}',
    )
    expect(
      records.find(e => e.result.tool_use_id === 'last-error').result.content,
    ).toBe('current error')
    const pointer = records.find(e => e.result.tool_use_id === 'older')
    expect(pointer.sourceMessageUuid).toBe(old.uuid)
    expect(pointer.result.is_error).toBe(true)
    expect(pointer.result.observedFields).toEqual(['"valid":false'])
    expect(pointer.result.content).toContain('Resolution not inferred')
  })

  test('keeps pending tool calls, background handles and the latest todo state', () => {
    const todos = {
      todos: [{ content: 'browser verification', status: 'pending' }],
    }
    const messages = [
      assistant('old', [
        call('dangling'),
        call('background'),
        call('todos', 'TodoWrite', todos),
      ]),
      result(
        'background',
        'Command running in background with ID: job-1. Output: job-1.output',
      ),
      result('todos', 'updated'),
      ...tail(),
    ]
    const records = evidence(
      preserveCompactContext(messages).historicalMessages,
    )
    expect(records.find(e => e.call.id === 'dangling').result.status).toBe(
      'no result in transcript',
    )
    expect(
      records.find(e => e.call.id === 'background').result.content,
    ).toContain('job-1.output')
    expect(records.find(e => e.call.id === 'todos').call.input).toEqual(todos)
  })

  test('keeps streaming siblings and images; discards stale usage, not source content', () => {
    const messages = [
      assistant('old', [call('read', 'Read')]),
      result('read', 'old source body'),
      ...tail(),
      assistant('recent-3', [call('second')]),
      user([
        {
          type: 'tool_result',
          tool_use_id: 'second',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: 'image/png', data: 'test' },
            },
          ],
        },
      ]),
    ]
    const p = preserveCompactContext(messages)
    expect(p.messagesToKeep.map(m => m.uuid)).toEqual(
      messages.slice(2).map(m => m.uuid),
    )
    expect(p.historicalMessages).toHaveLength(0)
    for (const kept of p.messagesToKeep) {
      expect(kept.message!.content).toEqual(
        messages.find(m => m.uuid === kept.uuid)!.message!.content,
      )
      if (kept.type === 'assistant') expect(kept.message!.usage).toBeUndefined()
    }
    expect(messages[2]!.message!.usage).toBeDefined()
  })

  test('repeated compaction and JSON roundtrip do not duplicate user facts or evidence', () => {
    const messages = [
      user('Original constraint'),
      assistant('old', [call('unknown')]),
      result('unknown', '{"outcome":"unknown","requestId":"same-id"}'),
      ...tail(),
    ]
    const first = preserveCompactContext(messages)
    const resumed = JSON.parse(
      JSON.stringify([
        ...first.historicalMessages,
        user('An inaccurate generated summary', { isCompactSummary: true }),
        ...first.messagesToKeep,
      ]),
    )
    const second = preserveCompactContext(resumed)
    expect(second.historicalMessages.map(m => m.message)).toEqual(
      first.historicalMessages.map(m => m.message),
    )
    expect(second.messagesToKeep.map(m => m.uuid)).toEqual(
      first.messagesToKeep.map(m => m.uuid),
    )
  })
})

// Opt-in, read-only audit against the ORIGINAL JSONL, not a hand-authored
// replacement summary or a model replay. No project files are written.
const transcriptPath = process.env.BGS_COMPACT_AUDIT_TRANSCRIPT
test.skipIf(!transcriptPath)(
  'original transcript: constraints, unknown receipts, pending work and working tail remain recoverable',
  () => {
    const bytes = readFileSync(transcriptPath!)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const rows = bytes
      .toString()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))
    const boundary = rows.findIndex(
      r => r.type === 'system' && r.subtype === 'compact_boundary',
    )
    expect(boundary).toBeGreaterThan(0)
    const before: Message[] = rows
      .slice(0, boundary)
      .filter(r =>
        ['user', 'assistant', 'attachment', 'system', 'progress'].includes(
          r.type,
        ),
      )
    const p = preserveCompactContext(before, transcriptPath)
    const retained = [...p.historicalMessages, ...p.messagesToKeep]
    const originals = before.filter(
      m =>
        m.type === 'user' &&
        !m.isMeta &&
        !m.isCompactSummary &&
        !m.origin &&
        !(
          Array.isArray(m.message!.content) &&
          m.message!.content.some(b => b.type === 'tool_result')
        ),
    )
    expect(originals.length).toBeGreaterThan(0)
    for (const original of originals) {
      expect(
        retained.some(
          m =>
            JSON.stringify(m.message?.content) ===
            JSON.stringify(original.message!.content),
        ),
      ).toBe(true)
    }
    const records = evidence(p.historicalMessages)
    // Check the demonstrated plain-text path against real tool-result bytes,
    // not a replacement summary. Scope is carried by the exact paired call.
    let textValidationCount = 0
    for (const message of before) {
      if (message.type !== 'user' || !Array.isArray(message.message?.content))
        continue
      for (const block of message.message.content) {
        if (
          block.type !== 'tool_result' ||
          typeof block.content !== 'string' ||
          !/^(?:current )?valid: (?:True|False)\b/m.test(block.content)
        )
          continue
        const sourceCall = before
          .flatMap(m =>
            m.type === 'assistant' && Array.isArray(m.message?.content)
              ? m.message.content
              : [],
          )
          .find(b => b.type === 'tool_use' && b.id === block.tool_use_id) as any
        if (sourceCall?.name !== 'Bash') continue
        textValidationCount++
        const record = records.find(
          r => r.result.tool_use_id === block.tool_use_id,
        )
        expect(record).toBeDefined()
        expect(record.call).toEqual(sourceCall)
        expect(
          record.result.content === block.content ||
            record.result.observedFields.some((field: string) =>
              field.includes('valid:'),
            ),
        ).toBe(true)
      }
    }
    expect(textValidationCount).toBeGreaterThan(0)
    let unknownCount = 0
    for (const message of before) {
      if (message.type !== 'user' || !Array.isArray(message.message?.content))
        continue
      for (const block of message.message.content) {
        if (
          block.type !== 'tool_result' ||
          typeof block.content !== 'string' ||
          !/"outcome"\s*:\s*"unknown"/.test(block.content)
        )
          continue
        unknownCount++
        expect(
          records.find(e => e.result.tool_use_id === block.tool_use_id)?.result,
        ).toEqual(block)
      }
    }
    expect(unknownCount).toBeGreaterThan(0)
    expect(
      records.some(
        e =>
          e.call?.name === 'TodoWrite' &&
          e.call.input.todos.some((t: any) => t.status === 'pending'),
      ),
    ).toBe(true)
    const uses = new Set<string>()
    const resolved = new Set<string>()
    const sourceTail = groupMessagesByApiRound(
      before.filter(m => m.type !== 'progress'),
    )
      .filter(group => group.some(m => m.type === 'assistant'))
      .slice(-3)
      .flat()
    const writeFacts = records.filter(
      r => r.result.status === 'write_succeeded',
    )
    expect(writeFacts.length).toBeGreaterThan(0)
    let omittedWriteBodyCharacters = 0
    expect(p.messagesToKeep).toHaveLength(sourceTail.length)
    for (const [index, message] of p.messagesToKeep.entries()) {
      const original = sourceTail[index]!
      const content = original.message?.content
      if (Array.isArray(content)) {
        for (const [blockIndex, block] of content.entries()) {
          const fact = writeFacts.find(
            r =>
              r.call.id ===
              (block.type === 'tool_use'
                ? block.id
                : block.type === 'tool_result'
                  ? block.tool_use_id
                  : undefined),
          )
          const retainedBlock = (message.message!.content as any[])[blockIndex]
          if (!fact) expect(retainedBlock).toEqual(block)
          else {
            expect(retainedBlock.type).toBe('text')
            if (block.type === 'tool_use') {
              expect(fact.call.sourceMessageUuid).toBe(original.uuid)
              expect(fact.call.input.file_path).toBe(
                (block.input as any).file_path,
              )
              omittedWriteBodyCharacters += (block.input as any).content.length
            } else {
              expect(fact.sourceMessageUuid).toBe(original.uuid)
              expect(fact.result.content).toBe((block as any).content)
            }
          }
        }
      } else expect(message.message?.content).toEqual(content)
      if (!Array.isArray(message.message?.content)) continue
      for (const block of message.message.content) {
        if (block.type === 'tool_use') uses.add(block.id)
        if (block.type === 'tool_result') resolved.add(block.tool_use_id)
      }
    }
    expect([...uses].sort()).toEqual([...resolved].sort())
    for (const record of records) {
      expect(record.transcriptPath).toBe(transcriptPath)
      const original = before.find(m => m.uuid === record.sourceMessageUuid)
      expect(original).toBeDefined()
      if (record.result.observedFields) {
        const raw = (original!.message!.content as any[]).find(
          b => b.tool_use_id === record.result.tool_use_id,
        )
        expect(raw).toBeDefined()
        for (const field of record.result.observedFields)
          expect(raw.content).toContain(field)
      }
    }
    expect(
      createHash('sha256').update(readFileSync(transcriptPath!)).digest('hex'),
    ).toBe(digest)
    console.log(
      JSON.stringify({
        audit: 'offline original transcript',
        sha256: digest,
        originalUserMessages: originals.length,
        unknownReceipts: unknownCount,
        textValidationReceipts: textValidationCount,
        retainedRounds: new Set(
          p.messagesToKeep
            .filter(m => m.type === 'assistant')
            .map(m => m.message!.id),
        ).size,
        historicalCharacters: JSON.stringify(
          p.historicalMessages.map(m => m.message!.content),
        ).length,
        workingCharacters: JSON.stringify(
          p.messagesToKeep.map(m => m.message!.content),
        ).length,
        successfulWritesCompacted: writeFacts.length,
        omittedWriteBodyCharacters,
        note: 'No generated summary or future model behaviour tested; no token-savings claim.',
      }),
    )
  },
)
