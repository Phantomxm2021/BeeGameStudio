import type { QuerySource } from '../../constants/querySource.js'
import type { ToolUseContext } from '../../Tool.js'
import type { Message } from '../../types/message.js'
import {
  projectView,
  type CommittedCollapse,
} from './operations.js'

export interface ContextCollapseHealth {
  totalSpawns: number
  totalErrors: number
  lastError: string | null
  emptySpawnWarningEmitted: boolean
  totalEmptySpawns: number
}

export interface ContextCollapseStats {
  collapsedSpans: number
  collapsedMessages: number
  stagedSpans: number
  health: ContextCollapseHealth
}

export interface CollapseResult {
  messages: Message[]
}

export interface DrainResult {
  committed: number
  messages: Message[]
}

const MIN_MESSAGES_TO_COLLAPSE = 32
const KEEP_HEAD_MESSAGES = 6
const KEEP_TAIL_MESSAGES = 12
const SUMMARY_EXAMPLE_LIMIT = 8
const SUMMARY_TEXT_LIMIT = 180

let contextCollapseEnabled = false
let nextCollapseNumber = 1
let commits: CommittedCollapse[] = []
let collapsedMessages = 0
const subscribers = new Set<() => void>()
let health: ContextCollapseHealth = {
  totalSpawns: 0,
  totalErrors: 0,
  lastError: null,
  emptySpawnWarningEmitted: false,
  totalEmptySpawns: 0,
}

export function getStats(): ContextCollapseStats {
  return {
    collapsedSpans: commits.length,
    collapsedMessages,
    stagedSpans: 0,
    health: { ...health },
  }
}

export function isContextCollapseEnabled(): boolean {
  return contextCollapseEnabled
}

export function subscribe(callback: () => void): () => void {
  subscribers.add(callback)
  return () => {
    subscribers.delete(callback)
  }
}

export async function applyCollapsesIfNeeded(
  messages: Message[],
  _toolUseContext: ToolUseContext,
  _querySource: QuerySource,
): Promise<CollapseResult> {
  if (!contextCollapseEnabled) return { messages }
  const projected = projectView(messages, commits)
  if (projected.length < MIN_MESSAGES_TO_COLLAPSE) {
    return { messages: projected }
  }
  const span = selectSpan(projected)
  if (span.length === 0) {
    health.totalEmptySpawns += 1
    notify()
    return { messages: projected }
  }
  const commit = commitSpan(span)
  return { messages: projectView(projected, [commit]) }
}

export function isWithheldPromptTooLong(
  _message: Message,
  _isPromptTooLongMessage: (msg: Message) => boolean,
  _querySource: QuerySource,
): boolean {
  return false
}

export function recoverFromOverflow(
  messages: Message[],
  _querySource: QuerySource,
): DrainResult {
  if (!contextCollapseEnabled) return { committed: 0, messages }
  const projected = projectView(messages, commits)
  const span = selectSpan(projected)
  if (span.length === 0) return { committed: 0, messages: projected }
  const commit = commitSpan(span)
  return {
    committed: 1,
    messages: projectView(projected, [commit]),
  }
}

export function resetContextCollapse(): void {
  contextCollapseEnabled = false
  nextCollapseNumber = 1
  commits = []
  collapsedMessages = 0
  health = {
    totalSpawns: 0,
    totalErrors: 0,
    lastError: null,
    emptySpawnWarningEmitted: false,
    totalEmptySpawns: 0,
  }
  notify()
}

export function initContextCollapse(): void {
  contextCollapseEnabled = true
  notify()
}

export function restoreContextCollapseState(
  restoredCommits: CommittedCollapse[],
): void {
  commits = [...restoredCommits]
  collapsedMessages = 0
  nextCollapseNumber = commits.reduce((max, commit) => {
    const parsed = Number.parseInt(commit.collapseId, 10)
    return Number.isFinite(parsed) ? Math.max(max, parsed + 1) : max
  }, 1)
  notify()
}

function notify(): void {
  for (const callback of subscribers) callback()
}

function selectSpan(messages: Message[]): Message[] {
  if (messages.length < MIN_MESSAGES_TO_COLLAPSE) return []
  const start = KEEP_HEAD_MESSAGES
  const end = Math.max(start, messages.length - KEEP_TAIL_MESSAGES)
  return messages.slice(start, end).filter(message => {
    if (message.type === 'system' && message.subtype === 'context_collapse') {
      return false
    }
    return true
  })
}

function commitSpan(span: Message[]): CommittedCollapse {
  health.totalSpawns += 1
  const id = String(nextCollapseNumber++).padStart(16, '0')
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
  collapsedMessages += span.length
  notify()
  return commit
}

function buildSummary(messages: Message[]): string {
  const lines = messages.slice(0, SUMMARY_EXAMPLE_LIMIT).map(message => {
    const raw = getMessageText(message)
    return `- ${message.type}: ${raw.slice(0, SUMMARY_TEXT_LIMIT)}`
  })
  return [
    `Collapsed ${messages.length} older messages.`,
    'Key preserved details:',
    ...lines,
  ].join('\n')
}

function getMessageText(message: Message): string {
  const content = message.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map(block => {
        if (typeof block === 'string') return block
        if (block && typeof block === 'object') {
          const record = block as unknown as Record<string, unknown>
          const text = record.text ?? record.content
          return typeof text === 'string' ? text : JSON.stringify(block)
        }
        return String(block)
      })
      .join('\n')
  }
  if (content === null || content === undefined) return ''
  return JSON.stringify(content)
}
