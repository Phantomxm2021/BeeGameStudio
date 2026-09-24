import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod/v4'
import { runNativeFileAgent, nativeFileAgentEnvironment, type FileAgentInput, type FileAgentResult, type FileAgentProgress } from '@bee-game-studio/agent-workflow/native-file-agent'
import { captureSingleReviewInput, admitSingleReviewReport, singleReviewReportSchema, type SingleReviewInput } from './single-agent-contract'
import { getLatestRuntimeUsage, type ReviewUsageEvent, type ReviewNativeUsage } from './native-usage'
import { diagnoseReviewOutput, type ReviewOutputDiagnostic } from './single-agent-diagnostic'
import { buildReviewFileChecks } from './review-file-checks'
import { sealReviewedDocument } from './reviewed-document-metadata'
import { responseLanguageInstruction } from '../../../response-language'

export { NATIVE_FILE_REVIEW_POLICY } from './single-agent-contract'
export const fileReviewReportSchema = singleReviewReportSchema

export function fileReviewPrompt(language?: string): string {
  return [
    'Review all eight documents in docs/ against requirements.md and each other. Correct substantive omissions, contradictions, and requirements that would make the delivered game incomplete or inconsistent.',
    'Choose the investigation and editing approach yourself. Inspect, edit, and recheck the affected documents until the review is complete; do not change them merely to satisfy a quota.',
    'The deliverables are the eight documents in docs/. requirements.md and review-context/ are read-only evidence.',
    'Do not edit version or updated_at; the service updates those fields when it seals a document whose authored content changed.',
    'When complete, give a concise natural-language summary of the review and corrections.',
    ...(language ? [responseLanguageInstruction(language)] : []),
  ].join('\n')
}

/** Materialize the same logical source paths used by Author and Revision. */
export async function prepareReviewFiles(directory: string, value: SingleReviewInput) {
  const source = captureSingleReviewInput(value)
  const workspacePath = join(directory, 'workspace')
  await mkdir(workspacePath)
  await mkdir(join(workspacePath, 'docs'))
  for (const document of source.documents)
    await writeFile(join(workspacePath, document.path), document.content, { flag: 'wx', mode: 0o600 })
  await writeFile(join(workspacePath, 'requirements.md'), source.requirements.status === 'available'
    ? source.requirements.content : 'Requirements unavailable: ' + source.requirements.reason, { flag: 'wx', mode: 0o400 })
  await mkdir(join(workspacePath, 'review-context'), { recursive: true })
  await writeFile(join(workspacePath, 'review-context/file-checks.json'), JSON.stringify(buildReviewFileChecks(source), null, 2),
    { flag: 'wx', mode: 0o400 })
  return { source, workspacePath }
}

/** One autonomous native review-and-correct task. */
export async function runFileReview(input: {
  source: SingleReviewInput; directory: string
  configuration: { command: readonly string[]; env: Readonly<Record<string, string>> }
  language?: string
  signal: AbortSignal
  onUsage(usage: ReviewNativeUsage): Promise<void>
  onProgress(progress: FileAgentProgress): Promise<void>
  execute?: (input: FileAgentInput) => Promise<FileAgentResult>
}) {
  const { source, workspacePath } = await prepareReviewFiles(input.directory, input.source)
  const events: ReviewUsageEvent[] = []
  let messageId: string | undefined, usageObserved = false, previous = ''
  let modelMessages = 0
  const response = await (input.execute ?? runNativeFileAgent)({
    command: input.configuration.command, env: nativeFileAgentEnvironment(input.configuration.env),
    responseTrace: true,
    workspacePath, writablePaths: [...source.documents.map(document => document.path)], allowWorkingFiles: true,
    readOnlyPaths: ['requirements.md', 'review-context'],
    logPath: join(input.directory, 'native-events.jsonl'), signal: input.signal,
    prompt: fileReviewPrompt(input.language),
    onProgress: async progress => { modelMessages = progress.modelResponses; await input.onProgress(progress) },
    onMessage: async message => {
      const event = message.event as any, assistant = message.message as any
      if (event?.type === 'message_start') messageId = event.message?.id
      const id = message.type === 'assistant' ? assistant?.id ?? messageId : messageId
      const counters = message.usage ?? event?.usage ?? event?.message?.usage ?? assistant?.usage
      if (message.type === 'result' && (message.modelUsage || counters))
        events.push({ type: 'result', payload: { modelUsage: message.modelUsage ?? { native: counters } } })
      else if (counters && typeof counters === 'object')
        events.push({ type: 'usage', messageId: id, payload: { usage: counters } })
      if (counters || message.modelUsage) usageObserved = true
      const usage = getLatestRuntimeUsage(events), key = JSON.stringify(usage)
      if (usageObserved && key !== previous) { await input.onUsage(usage); previous = key }
    },
  })
  const usage = getLatestRuntimeUsage(events)
  let failure = response.failure
  if (!usageObserved) failure = 'usage_unavailable'
  if (input.signal.aborted) failure = 'stopped'
  let report
  let diagnostic: ReviewOutputDiagnostic | undefined
  if (!failure) {
    // Preserve only the final deliverable, not reasoning or the stream. Failed
    // admission must not destroy the output or require another paid call to inspect it.
    await writeFile(join(input.directory, 'native-result.json'), JSON.stringify({
      result: response.result?.result ?? null,
    }), { flag: 'wx', mode: 0o600 })
    try {
      // Files are the deliverable. A missing or oversized terminal message
      // must not reject valid edits or force another paid Agent turn.
      const terminalText = typeof response.result?.result === 'string' ? response.result.result.trim() : ''
      const parsed = fileReviewReportSchema.parse({ summary: terminalText.slice(0, 8000) || 'Document review completed.' })
      report = admitSingleReviewReport(source, parsed)
    } catch (error) {
      failure = 'invalid_output'; diagnostic = diagnoseReviewOutput(error)
      await writeFile(join(input.directory, 'output-diagnostic.json'), JSON.stringify(diagnostic), { flag: 'wx', mode: 0o600 })
    }
  }
  let documents: SingleReviewInput['documents'] | undefined
  if (!failure && report) {
    documents = []
    for (const path of source.documents.map(document => document.path)) {
      const file = join(workspacePath, path)
      const metadata = await lstat(file)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 2 * 1024 * 1024)
        throw new Error('Reviewed document is not a bounded regular file')
      const content = await readFile(file, 'utf8')
      if (!content.trim()) throw new Error('Reviewed document is empty')
      const sourceContent = source.documents.find(document => document.path === path)!.content
      documents.push({ path, content: sealReviewedDocument({ sourceContent, reviewedContent: content }) })
    }
  }
  return { ...response.completion, usage, usageObserved, report, documents, failure, diagnostic,
    summary: { modelMessages, structuredOutputCalls: 0, structuredOutputSuccesses: 0,
      structuredOutputFailures: 0, usageSource: response.result ? 'terminal' as const : usageObserved ? 'message_snapshots' as const : 'unavailable' as const } }
}
