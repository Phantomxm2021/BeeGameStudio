import { z } from 'zod/v4'
import { appendFile } from 'node:fs/promises'
import { nativeFileAgentEnvironment, runNativeFileAgent, type FileAgentInput, type FileAgentResult } from '@bee-game-studio/agent-workflow/native-file-agent'
import type { AuthorUsage } from './contract'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { autonomousAuthorReadOnlyPaths } from './autonomous-files'
import { boundedFinishExecutionLimits, defaultAuthorExecutionLimits, startAuthorBudget, type AuthorExecutionLimits } from './execution-budget'

export const autonomousAuthorReportSchema = z.strictObject({
  status: z.enum(['completed', 'blocked']),
  summary: z.string().trim().min(1).max(16000),
})
export type AutonomousAuthorReport = z.infer<typeof autonomousAuthorReportSchema>

/** One natural-language assignment. The model owns authoring decisions; the
 * host only supplies the brief, file boundary and completion envelope. */
export function autonomousAuthorPrompt(language?: string): string {
  return [
    'Read the finalized requirements in requirements.md, then create and directly write a complete, implementation-ready and mutually consistent set of eight game design documents in docs/. Do not reopen or replace the confirmed brief.',
    `The deliverables are: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}.`,
    'Write GDD.md first as the product and gameplay authority, then write the seven specialist documents from it. Each document owns only its discipline: level/scene, balance, technical, art, UI/UX, audio, or asset production. Refer to an owner instead of duplicating its specification.',
    'Use your own judgment to inspect, write and correct the documents. Preserve useful detail, stable IDs, tables and diagrams where they make the design implementable. On resume, continue from valid existing drafts instead of restarting.',
    'Do not implement the game or access other projects. Write document bodies to the files rather than returning them in the response; the service owns frontmatter and protocol metadata.',
    'When all eight files are complete, perform one cross-document consistency check, fix concrete omissions or contradictions, and stop. Independent review happens in the next workflow stage; do not start another review loop.',
    'Finish through StructuredOutput with status completed or blocked and a concise summary of the result or the specific unresolved blocker.',
    ...(language ? [`Use ${language} for the documents and summary.`] : []),
  ].join('\n')
}

/** A resume with a complete private draft set is a small finishing pass, not
 * permission to regenerate the bundle or fan out more work. */
export function autonomousAuthorFinishPrompt(language?: string): string {
  return [
    'Resume and finish the existing eight game design documents in docs/. Preserve valid work and do not restart the assignment.',
    `The deliverables are: ${CANONICAL_FOUNDATION_DOCUMENTS.join(', ')}.`,
    'Read requirements.md and the drafts. Make only the necessary edits for completeness and concrete cross-document consistency; do not add speculative polish or repeat the check.',
    'Do not implement the game or access other projects. Finish through StructuredOutput with status completed or blocked and a concise summary. Independent review happens in the next workflow stage.',
    ...(language ? [`Use ${language} for the documents and summary.`] : []),
  ].join('\n')
}

const empty = (): AuthorUsage => ({ prompt_tokens: 0, completion_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, total_tokens: 0 })
const counters = ['prompt_tokens', 'completion_tokens', 'cache_read_tokens', 'cache_creation_tokens'] as const
const object = (value: unknown): Record<string, any> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : undefined
function usage(value: unknown): AuthorUsage | undefined {
  const record = object(value)
  if (!record) return undefined
  const keys = [
    ['inputTokens', 'input_tokens', 'prompt_tokens'], ['outputTokens', 'output_tokens', 'completion_tokens'],
    ['cacheReadInputTokens', 'cache_read_input_tokens', 'cache_read_tokens'],
    ['cacheCreationInputTokens', 'cache_creation_input_tokens', 'cache_creation_tokens'],
  ]
  if (!keys.flat().some(key => key in record)) return undefined
  const result = empty()
  for (let index = 0; index < counters.length; index++) {
    const raw = keys[index]!.map(key => record[key]).find(value => value !== undefined) ?? 0
    if (!Number.isSafeInteger(raw) || raw < 0) throw new Error('Invalid native author usage')
    result[counters[index]!] = raw
  }
  result.total_tokens = counters.reduce((sum, key) => sum + result[key], 0)
  if (!Number.isSafeInteger(result.total_tokens)) throw new Error('Native author usage overflow')
  return result
}
function add(target: AuthorUsage, value: AuthorUsage) {
  for (const key of counters) target[key] += value[key]
  target.total_tokens = counters.reduce((sum, key) => sum + target[key], 0)
}

/** Deduplicate per-message stream snapshots. Native terminal modelUsage includes
 * delegated usage and supersedes those snapshots; reset epochs are additive. */
export function createAutonomousAuthorUsageMeter() {
  let observed = false, ordinal = 0
  const currentIds = new Map<string, string>()
  let terminal: AuthorUsage | undefined
  const epochs = empty(), messages = new Map<string, AuthorUsage>()
  return {
    observe(message: Record<string, unknown>): AuthorUsage | undefined {
      // The stderr evidence channel may drain after the cumulative stdout result.
      // That result already includes these child snapshots; never add them twice.
      if (terminal && message.nativeTraceAgentId !== undefined) return this.snapshot()
      const event = object(message.event), body = object(message.message)
      const cumulative = object(message.modelUsage)
      if (message.type === 'result' && cumulative) {
        const next = empty()
        let valid = false
        for (const entry of Object.values(cumulative)) {
          const parsed = usage(entry)
          if (parsed) { add(next, parsed); valid = true }
        }
        if (valid) {
          if (terminal && counters.some(key => next[key] < terminal![key])) add(epochs, terminal)
          terminal = next; messages.clear(); currentIds.clear(); observed = true
          return this.snapshot()
        }
      }
      const eventMessage = object(event?.message)
      const scope = String(message.nativeTraceAgentId ?? message.parent_tool_use_id ?? 'root')
      if (event?.type === 'message_start') currentIds.set(scope, typeof eventMessage?.id === 'string' ? eventMessage.id : `message-${++ordinal}`)
      const parsed = usage(message.usage ?? event?.usage ?? eventMessage?.usage ?? body?.usage)
      if (!parsed) return observed ? this.snapshot() : undefined
      // A terminal usage object is the native cumulative fallback when a
      // provider does not supply modelUsage; never add it to the same stream.
      if (message.type === 'result') {
        if (terminal && counters.some(key => parsed[key] < terminal![key])) add(epochs, terminal)
        terminal = parsed; messages.clear(); currentIds.clear()
      } else {
        const id = typeof body?.id === 'string' ? body.id : typeof eventMessage?.id === 'string' ? eventMessage.id : currentIds.get(scope)
        if (!id) throw new Error('Native author stream usage has no message identity')
        const previous = messages.get(id) ?? empty()
        for (const key of counters) previous[key] = Math.max(previous[key], parsed[key])
        previous.total_tokens = counters.reduce((sum, key) => sum + previous[key], 0)
        messages.set(id, previous)
      }
      observed = true
      return this.snapshot()
    },
    snapshot(): AuthorUsage | undefined {
      if (!observed) return undefined
      const total = { ...epochs }
      if (terminal) add(total, terminal)
      for (const value of messages.values()) add(total, value)
      return total
    },
  }
}

export type AutonomousNativeInput = {
  configuration: { command: readonly string[]; env: Readonly<Record<string, string>> }
  workspacePath: string
  logPath: string
  language?: string
  executionLimits?: AuthorExecutionLimits
  /** Set only by an explicit resume with a complete safe candidate bundle. */
  finishOnly?: boolean
  /** Start time is observability only; no wall-clock deadline. */
  attemptStartedAt?: string
  signal: AbortSignal
  onUsage(usage: AuthorUsage): Promise<void>
  onProgress(progress: { modelResponses: number; message: string }): Promise<void>
}
export type AutonomousNativeOutcome = { report?: AutonomousAuthorReport; usage?: AuthorUsage; failure?: string }
export type AutonomousNativeExecutor = (input: AutonomousNativeInput) => Promise<AutonomousNativeOutcome>

export async function runAutonomousAuthor(input: AutonomousNativeInput,
  execute: (input: FileAgentInput) => Promise<FileAgentResult> = runNativeFileAgent): Promise<AutonomousNativeOutcome> {
  const meter = createAutonomousAuthorUsageMeter()
  const configuredLimits = input.executionLimits ?? defaultAuthorExecutionLimits
  const limits = input.finishOnly ? boundedFinishExecutionLimits(configuredLimits) : configuredLimits
  let lastModelResponses = 0
  const budget = await startAuthorBudget(input.workspacePath, limits, async warning => {
    const message = warning === 'active_time_warning'
      ? '运行时间较长，任务继续；时间阈值仅告警，不自动终止'
      : '文档较长时间未变化，任务继续；这不代表模型停止生成'
    await appendFile(input.logPath, JSON.stringify({ at: new Date().toISOString(), event: warning,
      data: { advisoryOnly: true, modelContinues: true } }) + '\n', { mode: 0o600 })
    await input.onProgress({ modelResponses: lastModelResponses, message })
  })
  let lastUsage = ''
  let result: FileAgentResult
  try {
    result = await execute({
    command: input.configuration.command,
    // The workflow owns independent review after Author completes. Do not let
    // generic CLI completion nudges insert another verification stage here.
    env: { ...nativeFileAgentEnvironment(input.configuration.env), BEEGAME_EXTERNAL_REVIEW: '1' },
    workspacePath: input.workspacePath, logPath: input.logPath,
    responseTrace: true,
    writablePaths: [...CANONICAL_FOUNDATION_DOCUMENTS], allowWorkingFiles: true,
    readOnlyPaths: autonomousAuthorReadOnlyPaths, signal: AbortSignal.any([input.signal, budget.signal]),
    prompt: input.finishOnly ? autonomousAuthorFinishPrompt(input.language) : autonomousAuthorPrompt(input.language),
    schema: z.toJSONSchema(autonomousAuthorReportSchema, { target: 'draft-7' }),
    onProgress: progress => {
      lastModelResponses = progress.modelResponses
      const documents = budget.progress()
      return input.onProgress({ ...progress, message: progress.message +
        ' · 本次已观察到 ' + documents.changedDocuments + '/8 份文档内容变化（非验收进度）' +
        ' · 距最近文档变化 ' + Math.floor(documents.noDocumentProgressMs / 1000) + ' 秒' })
    },
    onMessage: async message => {
      const value = meter.observe(message)
      if (!value) return
      const encoded = JSON.stringify(value)
      if (encoded !== lastUsage) { await input.onUsage(value); lastUsage = encoded }
    },
  }) } finally { await budget.close() }
  const total = meter.snapshot()
  const failure = input.signal.aborted ? 'stopped' : budget.failure() ?? result.failure ?? (!total ? 'usage_unavailable' : undefined)
  if (failure) return { failure, usage: total }
  const report = autonomousAuthorReportSchema.safeParse(result.result?.structured_output)
  return report.success ? { report: report.data, usage: total } : { failure: 'invalid_completion', usage: total }
}
