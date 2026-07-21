import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  parseNativeBackgroundTaskLaunch,
  readNativeBackgroundTaskUsage,
} from './native-background-task-output'

describe('native background task output', () => {
  let root = ''

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  test('parses native async Agent launch metadata', () => {
    expect(parseNativeBackgroundTaskLaunch([
      'Async agent launched successfully.',
      'agentId: task-1',
      'output_file: /runtime/task-1.output',
    ].join('\n'))).toEqual({
      taskId: 'task-1',
      outputFile: '/runtime/task-1.output',
    })
  })

  test('keeps only the opaque agent id when Claude Code appends an annotation', () => {
    expect(parseNativeBackgroundTaskLaunch([
      'Async agent launched successfully.',
      'agentId: task-annotated (internal ID - do not mention it to the user)',
      'output_file: /runtime/task-annotated.output',
    ].join('\n'))).toEqual({
      taskId: 'task-annotated',
      outputFile: '/runtime/task-annotated.output',
    })
  })

  test('deduplicates repeated message snapshots in a completed subagent transcript', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-native-task-usage-'))
    const outputFile = join(root, 'task.output')
    const repeatedMessage = assistantRecord('message-1', 'tool_use', 10, 3, 20, 2)
    await writeFile(outputFile, [
      JSON.stringify(repeatedMessage),
      JSON.stringify(repeatedMessage),
      JSON.stringify(assistantRecord('message-2', 'end_turn', 5, 7, 30, 0)),
      '',
    ].join('\n'))

    expect(readNativeBackgroundTaskUsage(outputFile)).toEqual({
      inputTokens: 15,
      outputTokens: 10,
      cacheReadInputTokens: 50,
      cacheCreationInputTokens: 2,
      totalTokens: 77,
    })
  })

  test('does not count a still-running subagent transcript', async () => {
    root = await mkdtemp(join(tmpdir(), 'beegame-native-task-running-'))
    const outputFile = join(root, 'task.output')
    await writeFile(
      outputFile,
      `${JSON.stringify(assistantRecord('message-1', 'tool_use', 10, 3, 20, 2))}\n`,
    )

    expect(readNativeBackgroundTaskUsage(outputFile)).toBeUndefined()
  })
})

function assistantRecord(
  id: string,
  stopReason: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadInputTokens: number,
  cacheCreationInputTokens: number,
): object {
  return {
    type: 'assistant',
    message: {
      id,
      stop_reason: stopReason,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cache_read_input_tokens: cacheReadInputTokens,
        cache_creation_input_tokens: cacheCreationInputTokens,
      },
    },
  }
}
