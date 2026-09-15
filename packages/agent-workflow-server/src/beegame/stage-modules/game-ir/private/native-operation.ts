import { join } from 'node:path'
import { open } from 'node:fs/promises'
import { runNativeFileAgent, nativeFileAgentEnvironment, type FileAgentProgress } from '@bee-game-studio/agent-workflow/native-file-agent'
import { getLatestRuntimeUsage, type ReviewNativeUsage, type ReviewUsageEvent } from '../../../stage-runtime/native-usage'
import type { FoundationIrInput } from '../input'
import { files, readFile } from './files'

export type NativeIrOperation = Readonly<{
  kind: 'compile'
  prompt: string
  readOnlyFiles?: Readonly<Record<string, string>>
  outputFormat: 'json'
}>

async function createText(path: string, text: string): Promise<void> {
  const file = await open(path, 'wx', 0o600)
  try { await file.writeFile(text, 'utf8'); await file.sync() } finally { await file.close() }
}

/** Native file work only. Admission, retries, publication and billing stay outside this adapter. */
export async function runNativeIrOperation(input: {
  source: FoundationIrInput
  directory: string
  configuration: { command: readonly string[]; env: Readonly<Record<string, string>> }
  operation: NativeIrOperation
  signal: AbortSignal
  onUsage(usage: ReviewNativeUsage): Promise<void>
  onProgress(progress: FileAgentProgress): Promise<void>
}) {
  const workspacePath = join(input.directory, 'workspace')
  await files.ensureDirectories(join(workspacePath, 'docs'))
  for (const document of input.source.documents)
    await createText(join(workspacePath, document.path), document.content)
  await createText(join(workspacePath, 'authority.md'), input.operation.prompt)
  for (const [path, content] of Object.entries(input.operation.readOnlyFiles ?? {}))
    await createText(join(workspacePath, path), content)
  const outputPath = `output.${input.operation.outputFormat}`
  const events: ReviewUsageEvent[] = []
  let messageId: string | undefined, usageObserved = false, previous = ''
  const response = await runNativeFileAgent({
    command: input.configuration.command,
    env: nativeFileAgentEnvironment(input.configuration.env),
    workspacePath, writablePaths: [outputPath],
    readOnlyPaths: ['docs', 'authority.md', ...Object.keys(input.operation.readOnlyFiles ?? {})], allowWorkingFiles: true,
    prompt: `Read authority.md and the source documents, complete the requested task, and write the JSON result to ${outputPath}. The source documents are read-only.`,
    responseTrace: true, logPath: join(input.directory, 'native-events.jsonl'), signal: input.signal,
    onProgress: input.onProgress,
    onMessage: async message => {
      const event = message.event as Record<string, any> | undefined
      const assistant = message.message as Record<string, any> | undefined
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
  let text: string | undefined
  if (!failure) {
    try {
      text = await readFile(join(workspacePath, outputPath), 'utf8')
      if (!text.trim()) failure = 'empty_output'
    } catch { failure = 'output_unavailable' }
  }
  return { text, usage, usageObserved, failure, completion: response.completion }
}
