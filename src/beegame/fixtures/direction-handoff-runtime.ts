// Deterministic, offline worker substitute. The scheduler, SDK queue,
// normalization and outer runner remain real; no provider or documents.
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { setIsInteractive } from '../../bootstrap/state.js'
import { runNativeDirectionAuthors } from '../direction-authors.js'
import { nativeWritingAuthors, type NativeWritingBatch } from '@bee-game-studio/agent-workflow/native-direction-authors'
import type { AgentToolResult } from '@bee-game-studio/builtin-tools/tools/AgentTool/agentToolUtils.js'
import type { ToolUseContext } from '../../Tool.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { runTools } from '../../services/tools/toolOrchestration.js'
import { createUserMessage } from '../../utils/messages.js'
import { normalizeMessage } from '../../utils/queryHelpers.js'
import { registerTask } from '../../utils/task/framework.js'
import { drainSdkEvents, emitTaskTerminatedSdk } from '../../utils/sdkEventQueue.js'
import { getCommandQueue } from '../../utils/messageQueueManager.js'
import { enqueueAgentNotification } from '../../tasks/LocalAgentTask/LocalAgentTask.js'
import { writeAgentResultReceipt } from '../../utils/task/agentResultReceipt.js'
import { getTaskOutputDir } from '../../utils/task/diskOutput.js'

setIsInteractive(false)
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const flush = () => { for (const event of drainSdkEvents()) send(event) }
const finalResult = (agentId: string): AgentToolResult => ({
  agentId, content: [{ type: 'text', text: 'Final answer ' + agentId }],
  totalToolUseCount: 0, totalDurationMs: 0, totalTokens: 0,
  usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: null,
    cache_read_input_tokens: null, server_tool_use: null, service_tier: null, cache_creation: null },
})
let pending = ''
for await (const bytes of Bun.stdin.stream()) {
  pending += new TextDecoder().decode(bytes)
  let end: number
  while ((end = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, end); pending = pending.slice(end + 1)
    if (!line.trim()) continue
    const request = JSON.parse(line)
    if (request.type !== 'user') continue
    const mode = request.message.content[0]?.text ?? request.message.content
    const batch = /^batch-[234]$/.test(mode) ? Number(mode.slice(-1)) as NativeWritingBatch : undefined
    const authors = nativeWritingAuthors(batch)
    send({ type: 'user', uuid: request.uuid, isReplay: true, message: request.message })
    let state = { tasks: {}, speculation: { status: 'idle' } } as ReturnType<ToolUseContext['getAppState']>
    const context = {
      abortController: new AbortController(),
      getAppState: () => state,
      setAppState: (update: (previous: typeof state) => typeof state) => { state = update(state) },
      options: {
        tools: [{ name: 'Agent' }],
        commands: [...new Set(authors.flatMap(author => [...author.skills]))]
          .map(name => ({ type: 'prompt', name })),
        agentDefinitions: { activeAgents: [], allAgents: [] },
      },
    } as unknown as ToolUseContext
    const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
      for (const [i, call] of calls.entries()) {
        const id = 'fixture-' + randomUUID()
        registerTask({ id, type: 'local_agent', status: 'running', notified: false,
          toolUseId: call.id, description: 'Offline author ' + i, startTime: Date.now(),
        } as any, ctx.setAppState)
        if (mode === 'foreground' || mode === 'fast') {
          ctx.setAppState(previous => {
            const task = previous.tasks[id]
            if (task?.type !== 'local_agent') throw new Error('Missing fixture author')
            return { ...previous, tasks: { ...previous.tasks,
              [id]: { ...task, status: 'completed', result: finalResult(id) },
            } }
          })
          if (mode === 'foreground') {
            // Real foreground AgentTool supplies its own SDK bookend.
            emitTaskTerminatedSdk(id, 'completed', { toolUseId: call.id })
          } else {
            // Actual producer wins the race before the scheduler suppresses it.
            enqueueAgentNotification({ taskId: id, description: 'Offline author ' + i,
              status: 'completed', setAppState: ctx.setAppState, toolUseId: call.id,
              finalMessage: 'Final answer ' + id })
          }
        }
        yield { message: createUserMessage({ content: [{ type: 'tool_result',
          tool_use_id: call.id, content: 'Actual launch receipt',
        }], toolUseResult: mode === 'foreground' ? { status: 'completed', agentId: id }
          : { status: 'async_launched', agentId: id } }), newContext: ctx }
      }
    }
    let failed: string | undefined
    try {
      for await (const message of runNativeDirectionAuthors({ batch, contextPath: join(process.cwd(), 'context.md'),
        responsibilities: Object.fromEntries(authors.map(author => [author.document, 'Owned draft'])),
      }, context, (async () => ({ behavior: 'allow' })) as CanUseToolFn, execute, async () => {
        if (mode === 'cancelled') {
          context.abortController.abort()
          return
        }
        if (mode === 'evicted') {
          for (const task of Object.values(context.getAppState().tasks)) {
            await writeAgentResultReceipt(getTaskOutputDir(), { version: 1,
              task_id: task.id, task_type: 'local_agent', status: 'completed',
              description: 'Offline author', output: 'Final answer ' + task.id }, false)
          }
          context.setAppState(previous => ({ ...previous, tasks: {} }))
          return
        }
        context.setAppState(previous => ({ ...previous, tasks: Object.fromEntries(
          Object.entries(previous.tasks).map(([id, task], index) => [id, { ...task,
            status: mode === 'mixed-failure' ? (index === 0 ? 'failed' : 'running')
              : mode === 'failed' ? 'failed' : mode === 'killed' ? 'killed' : 'completed',
            result: finalResult(id),
          }]),
        ) as typeof previous.tasks }))
      })) {
        // print.ts drains the real SDK queue before each normalized message,
        // and before the parent result. Keep that production ordering.
        flush()
        for (const normalized of normalizeMessage(message)) send(normalized)
      }
    } catch (error) { failed = error instanceof Error ? error.message : String(error) }
    flush()
    send({ type: 'result', subtype: failed ? 'error_during_execution' : 'success',
      is_error: Boolean(failed), request_id: request.uuid, result: failed ?? 'Draft handoff complete',
      errors: failed ? [failed] : [], queuedNotifications: getCommandQueue().length,
    })
  }
}
