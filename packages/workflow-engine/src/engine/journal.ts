import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { JournalStore } from '../ports.js'
import type { AgentRunParams, JournalEntry } from '../types.js'
import type { AgentRunResult } from '../types.js'
import { WorkflowJournalError } from './errors.js'

/** Canonical parameter string after removing display-only fields. */
function canonicalParams(params: AgentRunParams): string {
  const { label: _label, phase: _phase, ...rest } = params
  const keys = Object.keys(rest).sort()
  const sorted: Record<string, unknown> = {}
  for (const k of keys) sorted[k] = rest[k as keyof typeof rest]
  return JSON.stringify(sorted)
}

/** Determinism key for an agent() call (sha256 of prompt + canonical params). */
export function agentCallKey(prompt: string, params: AgentRunParams): string {
  return createHash('sha256')
    .update(prompt + '\n' + canonicalParams(params))
    .digest('hex')
}

/** File-based JournalStore (jsonl, one directory per run). Pure fs, no core dependencies. */
export function createFileJournalStore(runsDir: string): JournalStore {
  const pathOf = (runId: string) => join(runsDir, runId, 'journal.jsonl')

  return {
    async read(runId): Promise<JournalEntry[]> {
      const path = pathOf(runId)
      let raw: string
      try {
        raw = await readFile(path, 'utf-8')
      } catch (error) {
        if (isErrno(error) && error.code === 'ENOENT') return []
        throw new WorkflowJournalError(
          `failed to read workflow journal: ${path}`,
          {
            cause: error,
          },
        )
      }
      const entries: JournalEntry[] = []
      for (const [index, line] of raw.split('\n').entries()) {
        if (line.trim().length === 0) continue
        try {
          entries.push(parseJournalEntry(JSON.parse(line), index + 1))
        } catch (error) {
          if (error instanceof WorkflowJournalError) throw error
          throw new WorkflowJournalError(
            `invalid workflow journal record at ${path}:${index + 1}`,
            { cause: error },
          )
        }
      }
      const seenSeq = new Set<number>()
      for (const entry of entries) {
        if (seenSeq.has(entry.seq)) {
          throw new WorkflowJournalError(
            `workflow journal contains duplicate sequence ${entry.seq}`,
          )
        }
        seenSeq.add(entry.seq)
      }
      // Parallel completion order differs from call order; resume must use the explicit sequence.
      return entries.sort((a, b) => a.seq - b.seq)
    },
    async append(runId, entry) {
      try {
        await mkdir(join(runsDir, runId), { recursive: true })
        await appendFile(pathOf(runId), JSON.stringify(entry) + '\n', 'utf-8')
      } catch (error) {
        if (error instanceof WorkflowJournalError) throw error
        throw new WorkflowJournalError(
          `failed to append workflow journal: ${pathOf(runId)}`,
          { cause: error },
        )
      }
    },
    async truncate(runId) {
      await rm(join(runsDir, runId), { recursive: true, force: true })
    },
  }
}

type DeadReason = Extract<AgentRunResult, { kind: 'dead' }>['reason']

const DEAD_REASONS = new Set<DeadReason>([
  'no-structured-output',
  'invalid-structured-output',
  'runagent-threw',
  'worktree-failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return Object.keys(value).every(key => keys.includes(key))
}

function parseJournalEntry(value: unknown, line: number): JournalEntry {
  if (!isRecord(value) || !hasOnlyKeys(value, ['key', 'seq', 'result'])) {
    throw new WorkflowJournalError(
      `journal line ${line} has an invalid entry shape`,
    )
  }
  if (typeof value.key !== 'string' || value.key.trim().length === 0) {
    throw new WorkflowJournalError(`journal line ${line} has an invalid key`)
  }
  if (
    typeof value.seq !== 'number' ||
    !Number.isInteger(value.seq) ||
    value.seq < 0
  ) {
    throw new WorkflowJournalError(
      `journal line ${line} has an invalid sequence`,
    )
  }
  return {
    key: value.key,
    seq: value.seq,
    result: parseAgentRunResult(value.result, line),
  }
}

function parseAgentRunResult(value: unknown, line: number): AgentRunResult {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new WorkflowJournalError(`journal line ${line} has an invalid result`)
  }
  if (value.kind === 'skipped') {
    if (!hasOnlyKeys(value, ['kind'])) {
      throw new WorkflowJournalError(
        `journal line ${line} has an invalid skipped result`,
      )
    }
    return { kind: 'skipped' }
  }
  if (value.kind === 'dead') {
    if (
      !hasOnlyKeys(value, ['kind', 'reason', 'detail']) ||
      !isDeadReason(value.reason) ||
      (value.detail !== undefined && typeof value.detail !== 'string')
    ) {
      throw new WorkflowJournalError(
        `journal line ${line} has an invalid dead result`,
      )
    }
    return {
      kind: 'dead',
      reason: value.reason,
      ...(value.detail !== undefined ? { detail: value.detail } : {}),
    } as AgentRunResult
  }
  if (value.kind !== 'ok') {
    throw new WorkflowJournalError(
      `journal line ${line} has an unknown result kind`,
    )
  }
  if (
    !hasOnlyKeys(value, [
      'kind',
      'output',
      'usage',
      'model',
      'toolCount',
      'tokenCount',
    ]) ||
    !('output' in value) ||
    (typeof value.output !== 'string' && !isObjectValue(value.output)) ||
    !isRecord(value.usage) ||
    !hasOnlyKeys(value.usage, ['outputTokens']) ||
    typeof value.usage.outputTokens !== 'number' ||
    !Number.isFinite(value.usage.outputTokens) ||
    value.usage.outputTokens < 0 ||
    (value.model !== undefined && typeof value.model !== 'string') ||
    (value.toolCount !== undefined && !isFiniteNonNegative(value.toolCount)) ||
    (value.tokenCount !== undefined && !isFiniteNonNegative(value.tokenCount))
  ) {
    throw new WorkflowJournalError(
      `journal line ${line} has an invalid ok result`,
    )
  }
  return {
    kind: 'ok',
    output: value.output,
    usage: { outputTokens: value.usage.outputTokens },
    ...(value.model !== undefined ? { model: value.model } : {}),
    ...(value.toolCount !== undefined ? { toolCount: value.toolCount } : {}),
    ...(value.tokenCount !== undefined ? { tokenCount: value.tokenCount } : {}),
  }
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isObjectValue(value: unknown): value is object {
  return typeof value === 'object' && value !== null
}

function isDeadReason(value: unknown): value is DeadReason {
  return typeof value === 'string' && DEAD_REASONS.has(value as DeadReason)
}

function isErrno(value: unknown): value is { code?: string } {
  return typeof value === 'object' && value !== null && 'code' in value
}
