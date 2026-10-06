import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import type { ToolUseContext } from '../Tool.js'
import type { Message } from '../types/message.js'
import { createAssistantMessage, createUserMessage, extractTextContent } from '../utils/messages.js'
import { runTools } from '../services/tools/toolOrchestration.js'
import { markAgentsNotified } from '../tasks/LocalAgentTask/LocalAgentTask.js'
import { removeByFilter } from '../utils/messageQueueManager.js'
import { readAgentResultReceipt } from '../utils/task/agentResultReceipt.js'
import { getTaskOutputDir } from '../utils/task/diskOutput.js'
import { sleep } from '../utils/sleep.js'
import { emitTaskTerminatedSdk, parseTaskNotificationSdkEvent } from '../utils/sdkEventQueue.js'

/** Shared native execution for scheduled writing and review. No parent model
 * decides dispatch, polls worker logs, or substitutes a completion claim. */
export async function* runNativeAssignments(
  calls: ToolUseBlock[], label: string, context: ToolUseContext, canUseTool: CanUseToolFn,
  execute: typeof runTools = runTools, pause: (ms: number) => Promise<unknown> = sleep,
): AsyncGenerator<Message, string[]> {
  const results = new Map<string, unknown>()
  const answers = new Map<string, string>()
  async function* runBatch(batch: ToolUseBlock[], label: string): AsyncGenerator<Message> {
    const dispatch = createAssistantMessage({ content: [
      { type: 'text', text: label, citations: null }, ...batch,
    ] })
    yield dispatch
    let failed = false
    let failureDetail = ''
    const receipts = new Set<string>()
    for await (const update of execute(batch, [dispatch], canUseTool, context)) {
      if (!update.message) continue
      const message = update.message
      if (message.type === 'user' && Array.isArray(message.message?.content)) {
        for (const block of message.message.content) {
          if (block.type !== 'tool_result') continue
          receipts.add(block.tool_use_id)
          results.set(block.tool_use_id, message.toolUseResult)
          const result = message.toolUseResult as { status?: string; content?: Parameters<typeof extractTextContent>[0] } | undefined
          if (result?.status === 'completed' && result.content)
            answers.set(block.tool_use_id, extractTextContent(result.content, '\n'))
          if (block.is_error) {
            failed = true
            failureDetail ||= typeof block.content === 'string' ? block.content : extractTextContent(block.content ?? [], '\n')
          }
        }
      }
      yield message
    }
    if (context.abortController.signal.aborted) throw new Error('BGS scheduled agent dispatch cancelled')
    if (failed || batch.some(call => !receipts.has(call.id)))
      throw new Error('A scheduled BGS agent failed; no parent-model fallback or automatic regeneration' + (failureDetail ? ': ' + failureDetail : ''))
  }
  yield* runBatch(calls, label)
  // Keep dispatch identity even after the task has been evicted to its receipt.
  const pending = new Map<string, string>()
  for (const call of calls) {
    const result = results.get(call.id) as { status?: string; agentId?: string } | undefined
    if (result?.status === 'async_launched' && result.agentId) {
      pending.set(result.agentId, call.id)
      // This caller owns the handoff. Suppress the ordinary between-turn
      // notification; the same final answer must not be delivered twice.
      markAgentsNotified(result.agentId, context.setAppState)
    }
    else if (result?.status !== 'completed') throw new Error('BGS scheduled agent did not return a completion or background task receipt')
  }
  // Waiting is runtime control, not a model tool call. TaskOutput falls back
  // to the full worker transcript while running, so using it here repeatedly
  // copies execution logs into the parent conversation. Read status only;
  // terminal answers come from native state or the existing durable receipt.
  while (pending.size) {
    if (context.abortController.signal.aborted) throw new Error('BGS scheduled agent dispatch cancelled')
    const workerFailures: string[] = []
    for (const [taskId, toolUseId] of pending) {
      const task = context.getAppState().tasks[taskId]
      if (task && task.type !== 'local_agent') throw new Error('BGS scheduled agent task is not a native local agent: ' + taskId)
      if (task?.status === 'running' || task?.status === 'pending') continue
      const receipt = !task || (task.status === 'completed' && !task.result)
        ? await readAgentResultReceipt(getTaskOutputDir(), taskId) : undefined
      if (context.abortController.signal.aborted) throw new Error('BGS scheduled agent dispatch cancelled')
      const status = task?.status ?? receipt?.status
      if (!status) throw new Error('BGS scheduled agent task receipt is unavailable: ' + taskId)
      if (status !== 'completed' && status !== 'failed' && status !== 'killed')
        throw new Error('Unexpected BGS scheduled agent terminal status: ' + taskId)
      // Narrative deduplication must not suppress the SDK lifecycle bookend.
      // Foreground completions already emit their own bookend and never enter
      // this map. print.ts flushes these events before the final parent result.
      removeByFilter(command => {
        if (command.mode !== 'task-notification' || command.agentId !== context.agentId) return false
        const notification = parseTaskNotificationSdkEvent(command.value)
        return notification?.task_id === taskId &&
          (!notification.tool_use_id || notification.tool_use_id === toolUseId)
      })
      emitTaskTerminatedSdk(taskId, status === 'killed' ? 'stopped' : status, { toolUseId })
      pending.delete(taskId)
      if (status !== 'completed') {
        workerFailures.push(task?.error ?? receipt?.error ?? `${taskId}: ${status}`)
        continue
      }
      if (!task?.result && !receipt) throw new Error('BGS completed agent result is unavailable: ' + taskId)
      const answer = task?.result ? extractTextContent(task.result.content, '\n') : receipt!.output
      answers.set(toolUseId, answer)
      yield createUserMessage({ isMeta: true,
        content: 'BGS scheduled agent task ' + taskId + ' completed. Actual final handoff:\n' +
          (answer || '(Agent completed but returned no text.)') })
    }
    // Close every already-terminal sibling observed in this pass, but never
    // wait for or regenerate remaining workers after a failure.
    if (workerFailures.length) throw new Error('A scheduled BGS agent did not complete: ' + workerFailures.join('; '))
    if (pending.size) await pause(100)
  }
  return calls.map(call => answers.get(call.id) ?? '')
}
