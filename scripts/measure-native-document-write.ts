import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { validateCompleteGameDocumentMarkdown } from '../packages/agent-workflow-server/src/beegame/complete-game-document'

export type NativeWriteLimit = 8192 | 10240 | 12288

export type WriteLimitEvidence = {
  limit: NativeWriteLimit
  success: boolean
  canonicalValid: boolean
  timeToFirstToolMs: number
  maximumSilentGapMs: number
  durationMs: number
  inputTokens: number
  cacheReadTokens: number
  outputTokens: number
  rawProcessedTokens: number
  writeCalls: number
  fileBytes: number
}

export function selectNativeWriteLimit(
  evidence: readonly WriteLimitEvidence[],
): NativeWriteLimit {
  const groups = new Map<NativeWriteLimit, WriteLimitEvidence[]>([
    [8192, []],
    [10240, []],
    [12288, []],
  ])
  for (const item of evidence) groups.get(item.limit)?.push(item)
  const baseline = passingTriple(groups.get(8192) ?? [])
  if (!baseline) return 8192
  const baselineMedian = median(
    baseline.map(item => item.rawProcessedTokens),
  )
  const twelve = passingTriple(groups.get(12288) ?? [])
  if (
    twelve &&
    median(twelve.map(item => item.rawProcessedTokens)) <= baselineMedian * 0.85
  )
    return 12288
  const ten = passingTriple(groups.get(10240) ?? [])
  if (
    ten &&
    median(ten.map(item => item.rawProcessedTokens)) <= baselineMedian * 0.9
  )
    return 10240
  return 8192
}

function passingTriple(
  evidence: readonly WriteLimitEvidence[],
): readonly WriteLimitEvidence[] | undefined {
  if (evidence.length !== 3) return undefined
  return evidence.every(
    item =>
      item.success &&
      item.canonicalValid &&
      item.maximumSilentGapMs <= 120_000,
  )
    ? evidence
    : undefined
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.POSITIVE_INFINITY
}

export async function runNativeWriteMeasurement(input: {
  limit: NativeWriteLimit
  executablePath: string
  promptPath: string
  workspacePath: string
}): Promise<WriteLimitEvidence> {
  const executablePath = resolve(input.executablePath)
  const prompt = await readFile(resolve(input.promptPath), 'utf8')
  const workspacePath = resolve(input.workspacePath)
  await mkdir(resolve(workspacePath, 'docs'), { recursive: true })
  const startedAt = Date.now()
  let lastChunkAt = startedAt
  let maximumSilentGapMs = 0
  let timeToFirstToolMs = 0
  let writeCalls = 0
  let result: Record<string, unknown> | undefined
  const child = Bun.spawn(
    [
      process.execPath,
      executablePath,
      '--print',
      '--verbose',
      '--input-format=stream-json',
      '--output-format=stream-json',
      '--include-partial-messages',
      '--permission-prompt-tool=stdio',
      '--tools=Read,Write,Edit',
      '--allowedTools=Read,Write,Edit',
    ],
    {
      cwd: workspacePath,
      env: process.env,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  child.stdin.write(
    `${JSON.stringify({
      type: 'user',
      uuid: crypto.randomUUID(),
      session_id: '',
      parent_tool_use_id: null,
      message: { role: 'user', content: [{ type: 'text', text: prompt }] },
    })}\n`,
  )
  child.stdin.flush()
  let pending = ''
  const decoder = new TextDecoder()
  const silentTimer = setInterval(() => {
    if (Date.now() - lastChunkAt > 120_000) child.kill('SIGTERM')
  }, 1_000)
  try {
    for await (const chunk of child.stdout) {
      const now = Date.now()
      maximumSilentGapMs = Math.max(maximumSilentGapMs, now - lastChunkAt)
      lastChunkAt = now
      pending += decoder.decode(chunk, { stream: true })
      for (;;) {
        const newline = pending.indexOf('\n')
        if (newline < 0) break
        const line = pending.slice(0, newline).trim()
        pending = pending.slice(newline + 1)
        if (!line) continue
        const message = JSON.parse(line) as Record<string, unknown>
        if (message.type === 'control_request') {
          const request = message.request as Record<string, unknown> | undefined
          child.stdin.write(
            `${JSON.stringify({
              type: 'control_response',
              response: {
                subtype: 'success',
                request_id: message.request_id,
                response: {
                  behavior: 'allow',
                  updatedInput: request?.input,
                  toolUseID: request?.tool_use_id,
                  decisionClassification: 'user_temporary',
                },
              },
            })}\n`,
          )
          child.stdin.flush()
        }
        const toolName = nativeToolName(message)
        if (toolName) {
          if (!timeToFirstToolMs) timeToFirstToolMs = now - startedAt
          if (toolName === 'Write') writeCalls++
        }
        if (message.type === 'result') {
          result = message
          child.stdin.end()
          break
        }
      }
      if (result) break
    }
  } finally {
    clearInterval(silentTimer)
    if (child.exitCode === null) child.kill('SIGTERM')
  }
  const targetPath = resolve(workspacePath, 'docs/GDD.md')
  let fileBytes = 0
  let canonicalValid = false
  try {
    fileBytes = (await stat(targetPath)).size
    validateCompleteGameDocumentMarkdown(
      'docs/GDD.md',
      await readFile(targetPath, 'utf8'),
    )
    canonicalValid = true
  } catch {
    canonicalValid = false
  }
  const usage = record(result?.usage)
  const inputTokens = numeric(usage?.input_tokens)
  const cacheReadTokens = numeric(usage?.cache_read_input_tokens)
  const cacheCreationTokens = numeric(usage?.cache_creation_input_tokens)
  const outputTokens = numeric(usage?.output_tokens)
  return {
    limit: input.limit,
    success: result?.subtype === 'success' && result?.is_error !== true,
    canonicalValid,
    timeToFirstToolMs,
    maximumSilentGapMs,
    durationMs: Date.now() - startedAt,
    inputTokens,
    cacheReadTokens: cacheReadTokens + cacheCreationTokens,
    outputTokens,
    rawProcessedTokens:
      inputTokens + cacheReadTokens + cacheCreationTokens + outputTokens,
    writeCalls,
    fileBytes,
  }
}

function nativeToolName(message: Record<string, unknown>): string | undefined {
  if (message.type !== 'assistant') return undefined
  const body = record(message.message)
  const content = Array.isArray(body?.content) ? body.content : []
  const tool = content.find(
    item => record(item)?.type === 'tool_use' && typeof record(item)?.name === 'string',
  )
  return record(tool)?.name as string | undefined
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 0
}

if (import.meta.main) {
  const [limitValue, executablePath, promptPath, workspacePath, outputPath] =
    process.argv.slice(2)
  const limit = Number(limitValue)
  if (limit !== 8192 && limit !== 10240 && limit !== 12288)
    throw new Error('limit must be 8192, 10240, or 12288')
  if (!executablePath || !promptPath || !workspacePath)
    throw new Error(
      'usage: measure-native-document-write <limit> <executable> <prompt> <workspace> [output]',
    )
  const evidence = await runNativeWriteMeasurement({
    limit,
    executablePath,
    promptPath,
    workspacePath,
  })
  const rendered = `${JSON.stringify(evidence)}\n`
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true })
    await writeFile(resolve(outputPath), rendered, 'utf8')
  }
  process.stdout.write(rendered)
}
