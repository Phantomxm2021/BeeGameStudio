import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { preserveCompactContext } from '../../services/compact/preservedContext.js'
import type { Message } from '../../types/message.js'

const MAX_CACHED_ENTRIES = 200 // mirrors MAX_CACHED_SESSION_FILES in sessionStorage.ts

const {
  getSessionMessages,
  getSessionMessagesCache,
  clearSessionMessagesCache,
  loadTranscriptFile,
} = await import('../sessionStorage.js')

function asUuid(s: string): any {
  return s as unknown as any
}

let tempDir: string
let originalConfigDir: string | undefined

beforeEach(() => {
  tempDir = join(
    tmpdir(),
    `claude-session-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(tempDir, { recursive: true })
  // `getProjectsDir()` returns `${BEEGAME_CONFIG_DIR}/projects`, and
  // loadSessionFile reads from `${getProjectsDir()}/${sessionId}.jsonl`.
  // Pre-create the projects subdir so writeFileSync doesn't fail.
  mkdirSync(join(tempDir, 'projects'), { recursive: true })
  // Pin session-file lookups to a temp dir via BEEGAME_CONFIG_DIR.
  // Restoring in afterEach keeps tests hermetic.
  originalConfigDir = process.env.BEEGAME_CONFIG_DIR
  process.env.BEEGAME_CONFIG_DIR = tempDir
})

afterEach(() => {
  clearSessionMessagesCache()
  if (originalConfigDir === undefined) {
    delete process.env.BEEGAME_CONFIG_DIR
  } else {
    process.env.BEEGAME_CONFIG_DIR = originalConfigDir
  }
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

function sessionFilePath(sessionId: string): string {
  // Mirror sessionStorage.ts's path computation:
  //   getSessionProjectDir() ?? getProjectDir(getOriginalCwd())
  // With BEEGAME_CONFIG_DIR=tempDir and getSessionProjectDir() returning
  // null in tests, files live at `${tempDir}/projects/${sessionId}.jsonl`.
  return join(tempDir, 'projects', `${sessionId}.jsonl`)
}

test('resume uses the compacted Write segment without resurrecting the original body', async () => {
  const original: Message[] = [
    {
      type: 'assistant',
      uuid: randomUUID(),
      message: {
        id: 'write-round',
        content: [
          {
            type: 'tool_use',
            id: 'write-1',
            name: 'Write',
            input: { file_path: '/test.txt', content: 'ORIGINAL WRITE BODY' },
          },
        ],
      },
    },
    {
      type: 'user',
      uuid: randomUUID(),
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'write-1',
            content: 'File created successfully at: /test.txt',
          },
        ],
      },
    },
    {
      type: 'assistant',
      uuid: randomUUID(),
      message: {
        id: 'next-round',
        content: [{ type: 'text', text: 'Continue verification' }],
      },
    },
    {
      type: 'user',
      uuid: randomUUID(),
      message: { role: 'user', content: 'Do not pay again' },
    },
  ]
  original[1]!.sourceToolAssistantUUID = original[0]!.uuid
  original[1]!.parentUuid = original[0]!.uuid
  const file = sessionFilePath('write-compact-resume')
  const p = preserveCompactContext(original, file)
  const boundaryUuid = randomUUID()
  const summaryUuid = randomUUID()
  const entries = [
    ...original,
    {
      type: 'system',
      subtype: 'compact_boundary',
      uuid: boundaryUuid,
      compactMetadata: {
        trigger: 'auto',
        preTokens: 1000,
        preservedSegment: {
          headUuid: p.messagesToKeep[0]!.uuid,
          anchorUuid: summaryUuid,
          tailUuid: p.messagesToKeep.at(-1)!.uuid,
        },
      },
    },
    ...p.historicalMessages,
    {
      type: 'user',
      uuid: summaryUuid,
      isCompactSummary: true,
      message: { role: 'user', content: 'Continue task' },
    },
    ...p.messagesToKeep,
  ]
  // Serialize the same sequential chain used by insertMessageChain. An old
  // explicit parent would override it, which this regression must detect.
  writeFileSync(
    file,
    entries
      .map((message, index) =>
        JSON.stringify({
          parentUuid:
            message.uuid === boundaryUuid
              ? null
              : (entries[index - 1]?.uuid ?? null),
          ...message,
        }),
      )
      .join('\n') + '\n',
  )
  const loaded = await loadTranscriptFile(file)
  for (const message of p.messagesToKeep) {
    expect(loaded.messages.get(message.uuid)?.message?.content).toEqual(
      message.message?.content,
    )
  }
  expect(JSON.stringify([...loaded.messages.values()])).not.toContain(
    'ORIGINAL WRITE BODY',
  )
  expect(loaded.messages.has(original[0]!.uuid)).toBe(false)
  expect(loaded.messages.get(p.messagesToKeep[0]!.uuid)?.parentUuid).toBe(
    summaryUuid,
  )
  expect(loaded.messages.get(p.messagesToKeep[1]!.uuid)?.parentUuid).toBe(
    p.messagesToKeep[0]!.uuid,
  )
})

describe('getSessionMessagesCache', () => {
  test('returns the same Map instance across calls', () => {
    // Cache identity must be stable — `getLastSessionLog` uses
    // `getSessionMessagesCache()` directly to prime entries, so a
    // different instance each call would break that priming.
    expect(getSessionMessagesCache()).toBe(getSessionMessagesCache())
  })

  test('clearSessionMessagesCache empties a populated cache', async () => {
    const cache = getSessionMessagesCache()
    writeFileSync(sessionFilePath('id-1'), '')
    writeFileSync(sessionFilePath('id-2'), '')
    await getSessionMessages(asUuid('id-1'))
    await getSessionMessages(asUuid('id-2'))
    expect(cache.size).toBeGreaterThan(0)

    clearSessionMessagesCache()
    expect(cache.size).toBe(0)
  })

  test('clearSessionMessagesCache is a no-op on empty cache', () => {
    const cache = getSessionMessagesCache()
    expect(cache.size).toBe(0)
    clearSessionMessagesCache()
    expect(cache.size).toBe(0)
  })

  test('getSessionMessages dedups concurrent calls for the same sessionId', async () => {
    const cache = getSessionMessagesCache()
    const id = asUuid('same-id')
    writeFileSync(sessionFilePath('same-id'), '')
    const [a, b, c] = await Promise.all([
      getSessionMessages(id),
      getSessionMessages(id),
      getSessionMessages(id),
    ])
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(cache.size).toBe(1)
  })
})

describe('getSessionMessages bounded cache (memory leak fix)', () => {
  test('cache size stays at MAX_CACHED_ENTRIES after many distinct sessionIds', async () => {
    // Bounded cache — calling getSessionMessages with N distinct
    // sessionIds must NOT grow the cache beyond MAX_CACHED_ENTRIES.
    // Pre-fix: lodash memoize grew unbounded. Post-fix: Map-based
    // cache evicts oldest entry when at capacity.
    const cache = getSessionMessagesCache()
    const total = MAX_CACHED_ENTRIES * 3 // 600 distinct sessionIds
    for (let i = 0; i < total; i++) {
      writeFileSync(sessionFilePath(`id-${i}`), '')
      await getSessionMessages(asUuid(`id-${i}`))
    }
    expect(cache.size).toBe(MAX_CACHED_ENTRIES)
  })

  test('FIFO eviction: oldest entry is removed first', async () => {
    // Fill cache to MAX with sequential ids. The first inserted
    // (`oldest`) should be evicted on the (MAX+1)th insertion.
    const cache = getSessionMessagesCache()
    const oldestId = asUuid('id-0')
    writeFileSync(sessionFilePath('id-0'), '')
    await getSessionMessages(oldestId)
    for (let i = 1; i < MAX_CACHED_ENTRIES; i++) {
      writeFileSync(sessionFilePath(`id-${i}`), '')
      await getSessionMessages(asUuid(`id-${i}`))
    }
    expect(cache.size).toBe(MAX_CACHED_ENTRIES)
    expect(cache.has(oldestId)).toBe(true)

    writeFileSync(sessionFilePath('id-overflow'), '')
    await getSessionMessages(asUuid('id-overflow'))
    expect(cache.size).toBe(MAX_CACHED_ENTRIES)
    expect(cache.has(oldestId)).toBe(false)
  })

  test('cleared cache can be refilled without leaking entries', async () => {
    const cache = getSessionMessagesCache()
    for (let i = 0; i < MAX_CACHED_ENTRIES; i++) {
      writeFileSync(sessionFilePath(`id-${i}`), '')
      await getSessionMessages(asUuid(`id-${i}`))
    }
    expect(cache.size).toBe(MAX_CACHED_ENTRIES)

    clearSessionMessagesCache()
    expect(cache.size).toBe(0)

    for (let i = 0; i < MAX_CACHED_ENTRIES + 5; i++) {
      writeFileSync(sessionFilePath(`refill-${i}`), '')
      await getSessionMessages(asUuid(`refill-${i}`))
    }
    expect(cache.size).toBe(MAX_CACHED_ENTRIES)
  })
})
