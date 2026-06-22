# Context Collapse MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `CONTEXT_COLLAPSE` stub with a safe, deterministic message-level collapse MVP that actually reduces model-facing context and supports stats, restore, and 413 recovery.

**Architecture:** Implement collapse as an in-memory commit log plus projection over the full message history. The first pass uses deterministic extractive summaries, not background LLM summarization, so enabling `FEATURE_CONTEXT_COLLAPSE=1` is safe and testable without provider/network dependencies. Later LLM summarization can replace the summary builder without changing projection/persistence contracts.

**Tech Stack:** Bun, TypeScript strict mode, existing `Message` and transcript types, existing `query.ts` integration, `bun:test`.

---

## Source Notes

The docs page at `https://ccb.agent-aura.top/docs/features/context-collapse` says:
- `src/services/contextCollapse/index.ts`, `operations.ts`, and `persist.ts` are stubs.
- `query.ts`, `TokenWarning`, `/context`, session restore, and transcript persistence are already wired.
- `CONTEXT_COLLAPSE` should fold older messages into `<collapsed id="...">...</collapsed>` placeholders.
- `recoverFromOverflow()` is the critical 413 recovery path.

Local code confirms:
- `scripts/defines.ts` currently disables `CONTEXT_COLLAPSE` because the implementation is stubbed.
- `src/types/logs.ts` already defines `ContextCollapseCommitEntry` and `ContextCollapseSnapshotEntry`.
- `src/utils/sessionStorage.ts` already has `recordContextCollapseCommit()` and `recordContextCollapseSnapshot()`.

## File Structure

- Modify: `src/services/contextCollapse/index.ts`
  - Owns runtime state, thresholds, stats, commit/drain APIs, subscriptions.
- Modify: `src/services/contextCollapse/operations.ts`
  - Owns pure projection helpers and summary message creation.
- Modify: `src/services/contextCollapse/persist.ts`
  - Owns restoring committed/staged collapse entries from transcript metadata.
- Create: `src/services/contextCollapse/__tests__/contextCollapse.test.ts`
  - Unit tests for projection, stats, restore, and drain behavior.
- Modify: `scripts/defines.ts`
  - Re-enable `CONTEXT_COLLAPSE` only after tests prove it is not a no-op.

## Task 1: Pure Projection

**Files:**
- Modify: `src/services/contextCollapse/operations.ts`
- Test: `src/services/contextCollapse/__tests__/contextCollapse.test.ts`

- [ ] **Step 1: Write the failing projection test**

Add this test:

```ts
import { describe, expect, test } from 'bun:test'
import type { Message } from 'src/types/message.js'
import {
  createCollapsePlaceholder,
  projectView,
  type CommittedCollapse,
} from '../operations'

function message(uuid: string, text: string): Message {
  return {
    uuid,
    type: 'user',
    message: { role: 'user', content: text },
    timestamp: '2026-06-22T00:00:00.000Z',
  } as Message
}

describe('contextCollapse operations', () => {
  test('projectView replaces an archived span with one collapsed placeholder', () => {
    const messages = [
      message('m1', 'keep before'),
      message('m2', 'archive one'),
      message('m3', 'archive two'),
      message('m4', 'keep after'),
    ]
    const commit: CommittedCollapse = {
      collapseId: '0000000000000001',
      summaryUuid: 'summary-1',
      summary: 'Archived two setup messages.',
      summaryContent: '<collapsed id="0000000000000001">Archived two setup messages.</collapsed>',
      firstArchivedUuid: 'm2',
      lastArchivedUuid: 'm3',
    }

    const projected = projectView(messages, [commit])

    expect(projected.map(msg => msg.uuid)).toEqual(['m1', 'summary-1', 'm4'])
    expect(projected[1]?.type).toBe('system')
    expect(JSON.stringify(projected[1]?.message?.content)).toContain('<collapsed id="0000000000000001">')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: fail because `createCollapsePlaceholder`, `CommittedCollapse`, or `projectView(messages, commits)` is missing.

- [ ] **Step 3: Implement pure projection**

Replace `operations.ts` with focused pure helpers:

```ts
import type { Message } from 'src/types/message.js'

export type CommittedCollapse = {
  collapseId: string
  summaryUuid: string
  summaryContent: string
  summary: string
  firstArchivedUuid: string
  lastArchivedUuid: string
}

export function createCollapsePlaceholder(commit: CommittedCollapse): Message {
  return {
    uuid: commit.summaryUuid,
    type: 'system',
    subtype: 'context_collapse',
    timestamp: new Date().toISOString(),
    message: {
      role: 'system',
      content: commit.summaryContent,
    },
    isMeta: true,
  } as Message
}

export function projectView(
  messages: Message[],
  commits: readonly CommittedCollapse[] = [],
): Message[] {
  if (commits.length === 0) return messages
  const byStart = new Map(commits.map(commit => [commit.firstArchivedUuid, commit]))
  const projected: Message[] = []
  let skippingUntil: string | null = null

  for (const message of messages) {
    if (skippingUntil) {
      if (message.uuid === skippingUntil) skippingUntil = null
      continue
    }
    const commit = byStart.get(message.uuid)
    if (commit) {
      projected.push(createCollapsePlaceholder(commit))
      if (commit.lastArchivedUuid !== message.uuid) skippingUntil = commit.lastArchivedUuid
      continue
    }
    projected.push(message)
  }

  return projected
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: pass.

## Task 2: Runtime State and Deterministic Collapse

**Files:**
- Modify: `src/services/contextCollapse/index.ts`
- Test: `src/services/contextCollapse/__tests__/contextCollapse.test.ts`

- [ ] **Step 1: Write failing tests for apply/stats**

Add tests:

```ts
import {
  applyCollapsesIfNeeded,
  getStats,
  initContextCollapse,
  isContextCollapseEnabled,
  resetContextCollapse,
} from '../index'

describe('contextCollapse runtime', () => {
  test('applyCollapsesIfNeeded commits an old span when the message list is long', async () => {
    resetContextCollapse()
    initContextCollapse()
    const messages = Array.from({ length: 36 }, (_, index) =>
      message(`m${index}`, `message ${index} with important file src/file${index}.ts`),
    )

    const result = await applyCollapsesIfNeeded(messages, {} as never, 'user')

    expect(isContextCollapseEnabled()).toBe(true)
    expect(result.messages.length).toBeLessThan(messages.length)
    expect(JSON.stringify(result.messages)).toContain('<collapsed id=')
    expect(getStats().collapsedSpans).toBe(1)
    expect(getStats().collapsedMessages).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: fail because `applyCollapsesIfNeeded()` returns original messages and stats stay zero.

- [ ] **Step 3: Implement runtime state**

Implement in `index.ts`:

```ts
import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import { tokenCountWithEstimation } from '../../utils/tokens.js'
import {
  projectView,
  type CommittedCollapse,
} from './operations.js'

const MIN_MESSAGES_TO_COLLAPSE = 32
const KEEP_HEAD_MESSAGES = 6
const KEEP_TAIL_MESSAGES = 12

let enabled = false
let nextCollapseNumber = 1
let commits: CommittedCollapse[] = []
let subscribers = new Set<() => void>()
let health: ContextCollapseHealth = {
  totalSpawns: 0,
  totalErrors: 0,
  lastError: null,
  emptySpawnWarningEmitted: false,
  totalEmptySpawns: 0,
}

function notify(): void {
  for (const callback of subscribers) callback()
}

function collapseId(): string {
  return String(nextCollapseNumber++).padStart(16, '0')
}

function buildSummary(messages: Message[]): string {
  const lines = messages.slice(0, 8).map(msg => {
    const raw = typeof msg.message?.content === 'string'
      ? msg.message.content
      : JSON.stringify(msg.message?.content ?? '')
    return `- ${msg.type}: ${raw.slice(0, 180)}`
  })
  return [
    `Collapsed ${messages.length} older messages.`,
    'Key preserved details:',
    ...lines,
  ].join('\n')
}

function selectSpan(messages: Message[]): Message[] {
  if (messages.length < MIN_MESSAGES_TO_COLLAPSE) return []
  return messages.slice(KEEP_HEAD_MESSAGES, Math.max(KEEP_HEAD_MESSAGES, messages.length - KEEP_TAIL_MESSAGES))
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<CollapseResult> {
  if (!enabled) return { messages }
  const projected = projectView(messages, commits)
  if (projected.length < MIN_MESSAGES_TO_COLLAPSE) return { messages: projected }
  const span = selectSpan(projected)
  if (span.length === 0) return { messages: projected }
  health.totalSpawns += 1
  const id = collapseId()
  const summary = buildSummary(span)
  const commit: CommittedCollapse = {
    collapseId: id,
    summaryUuid: `context-collapse-${id}`,
    summary,
    summaryContent: `<collapsed id="${id}">${summary}</collapsed>`,
    firstArchivedUuid: span[0]!.uuid,
    lastArchivedUuid: span[span.length - 1]!.uuid,
  }
  commits.push(commit)
  notify()
  return { messages: projectView(projected, [commit]) }
}
```

Keep the existing exported interfaces. Implement `getStats()`, `subscribe()`, `resetContextCollapse()`, and `initContextCollapse()` against this state.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: pass.

## Task 3: 413 Drain Recovery

**Files:**
- Modify: `src/services/contextCollapse/index.ts`
- Test: `src/services/contextCollapse/__tests__/contextCollapse.test.ts`

- [ ] **Step 1: Write failing drain test**

Add:

```ts
test('recoverFromOverflow commits a collapse immediately for oversized history', () => {
  resetContextCollapse()
  initContextCollapse()
  const messages = Array.from({ length: 40 }, (_, index) =>
    message(`r${index}`, `overflow message ${index}`),
  )

  const drained = recoverFromOverflow(messages, 'user')

  expect(drained.committed).toBe(1)
  expect(drained.messages.length).toBeLessThan(messages.length)
  expect(JSON.stringify(drained.messages)).toContain('<collapsed id=')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: fail because `recoverFromOverflow()` returns `committed: 0`.

- [ ] **Step 3: Implement drain using the same deterministic commit path**

Refactor commit creation into a shared `commitSpan(messages)` helper. Implement:

```ts
export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): DrainResult {
  if (!enabled) return { committed: 0, messages }
  const projected = projectView(messages, commits)
  const span = selectSpan(projected)
  if (span.length === 0) return { committed: 0, messages: projected }
  const commit = commitSpan(span)
  return {
    committed: 1,
    messages: projectView(projected, [commit]),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: pass.

## Task 4: Restore From Transcript Metadata

**Files:**
- Modify: `src/services/contextCollapse/persist.ts`
- Test: `src/services/contextCollapse/__tests__/contextCollapse.test.ts`

- [ ] **Step 1: Write failing restore test**

Add:

```ts
import { restoreFromEntries } from '../persist'

test('restoreFromEntries restores committed collapse stats and projection', async () => {
  resetContextCollapse()
  initContextCollapse()
  restoreFromEntries([
    {
      type: 'marble-origami-commit',
      sessionId: 'session-1',
      collapseId: '0000000000000042',
      summaryUuid: 'summary-42',
      summaryContent: '<collapsed id="0000000000000042">Restored summary</collapsed>',
      summary: 'Restored summary',
      firstArchivedUuid: 'm1',
      lastArchivedUuid: 'm2',
    },
  ], undefined)

  const result = await applyCollapsesIfNeeded([
    message('m0', 'before'),
    message('m1', 'old one'),
    message('m2', 'old two'),
    message('m3', 'after'),
  ], {} as never, 'user')

  expect(result.messages.map(msg => msg.uuid)).toEqual(['m0', 'summary-42', 'm3'])
  expect(getStats().collapsedSpans).toBe(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: fail because `restoreFromEntries()` is no-op.

- [ ] **Step 3: Export restore helper from index and implement persist**

In `index.ts`, export:

```ts
export function restoreContextCollapseState(restoredCommits: CommittedCollapse[]): void {
  commits = [...restoredCommits]
  nextCollapseNumber = commits.reduce((max, commit) => {
    const parsed = Number.parseInt(commit.collapseId, 10)
    return Number.isFinite(parsed) ? Math.max(max, parsed + 1) : max
  }, 1)
  notify()
}
```

In `persist.ts`, implement:

```ts
import type { ContextCollapseCommitEntry, ContextCollapseSnapshotEntry } from 'src/types/logs.js'
import { restoreContextCollapseState } from './index.js'

export function restoreFromEntries(
  commits: ContextCollapseCommitEntry[],
  _snapshot?: ContextCollapseSnapshotEntry,
): void {
  restoreContextCollapseState(commits.map(entry => ({
    collapseId: entry.collapseId,
    summaryUuid: entry.summaryUuid,
    summaryContent: entry.summaryContent,
    summary: entry.summary,
    firstArchivedUuid: entry.firstArchivedUuid,
    lastArchivedUuid: entry.lastArchivedUuid,
  })))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
```

Expected: pass.

## Task 5: Enable Feature Flag in Dev Builds

**Files:**
- Modify: `scripts/defines.ts`

- [ ] **Step 1: Edit `scripts/defines.ts`**

Change:

```ts
// 'CONTEXT_COLLAPSE', // 已禁用：实现是空壳 stub，启用后会抑制 auto compact 导致上下文管理完全失效
```

to:

```ts
'CONTEXT_COLLAPSE', // 上下文折叠 MVP：确定性消息级折叠，避免长会话无限增长
```

Leave `HISTORY_SNIP` disabled unless `SnipTool` is implemented in a later plan.

- [ ] **Step 2: Run targeted tests**

Run:

```bash
/Users/nswell/.bun/bin/bun test src/services/contextCollapse/__tests__/contextCollapse.test.ts
/Users/nswell/.bun/bin/bun test packages/builtin-tools/src/tools/CtxInspectTool/__tests__/CtxInspectTool.test.ts
/Users/nswell/.bun/bin/bun run typecheck
```

Expected: all pass.

## Gaps Deferred

- LLM-generated summaries are deferred. The MVP summary is deterministic to avoid hidden provider calls and keep tests stable.
- Transcript write integration is already present in `sessionStorage.ts`, but this MVP does not add new calls to `recordContextCollapseCommit()` until projection behavior is verified. If persistence across brand-new transcript writes is required, add a follow-up task to call `recordContextCollapseCommit()` inside `commitSpan()`.
- `HISTORY_SNIP`, `SnipTool`, and `/force-snip` are deferred. The docs list them as missing, but they are independent from safe automatic context collapse.

