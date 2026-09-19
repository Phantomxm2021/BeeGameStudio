import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeSubagentChatEnricher, readVisibleSubagentTrace } from './native-subagent-chat'
import { createStageChatProjector, type StageChatEvent } from './stage-chat-events'

describe('native subagent chat observation', () => {
  test('correlates task events with the original prompt and visible child transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-chat-'))
    try {
      const path = join(dir, 'child.output')
      writeFileSync(path, [
        { type: 'assistant', message: { content: [
          { type: 'thinking', thinking: 'private thought must not appear' },
          { type: 'text', text: 'Checking manifest' },
          { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'manifest.json' } },
        ] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'read-1', content: 'valid manifest' }] } },
      ].map(row => JSON.stringify(row)).join('\n') + '\n{"partial":')
      const enrich = createNativeSubagentChatEnricher()
      const input = { description: 'Asset audit', prompt: 'Audit all assets' }
      enrich({ type: 'tool.started', payload: { toolName: 'Agent', toolUseID: 'agent-1', input } })
      const launch = enrich({ type: 'tool.completed', payload: { toolName: 'Agent', toolUseID: 'agent-1',
        output: `Async agent launched successfully.\nagentId: task-1 (internal ID)\noutput_file: ${path}` } })
      expect(launch.payload).toHaveProperty('nativeBackgroundTask.taskId', 'task-1')
      const progress = enrich({ type: 'system.status', payload: { type: 'system', subtype: 'task_progress', task_id: 'task-1' } })
      expect(progress.payload).toMatchObject({ toolUseID: 'agent-1', input })
      expect(progress.payload).toHaveProperty('subagentTrace')
      const trace = readVisibleSubagentTrace(path)!
      expect(trace).toContain('Checking manifest')
      expect(trace).toContain('[read-1] Read')
      expect(trace).toContain('valid manifest')
      expect(trace).not.toContain('private thought')
      expect(readVisibleSubagentTrace(join(dir, 'missing'))).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('all document stage projectors retain lifecycle and distinguish child streams', async () => {
    for (const stage of ['author', 'content', 'reviewer', 'revision'] as const) {
      const events: StageChatEvent[] = []
      const project = createStageChatProjector({ stage, sink: event => { events.push(event) } })
      await project({ queryId: 'query-1', type: 'system', subtype: 'task_started', task_id: 'task-1', tool_use_id: 'agent-1', prompt: 'Review' })
      await project({ queryId: 'query-1', type: 'system', subtype: 'task_progress', task_id: 'task-1', tool_use_id: 'agent-1', usage: { tool_uses: 2 } })
      await project({ queryId: 'query-1', type: 'system', subtype: 'task_notification', task_id: 'task-1', tool_use_id: 'agent-1', status: 'completed', summary: 'Done' })
      await project({ queryId: 'query-1', type: 'assistant', parent_tool_use_id: 'agent-1', message: { id: 'msg-child', content: [{ type: 'text', text: 'Child reply' }] } })
      expect(events.slice(0, 3).map(e => e.payload?.subtype)).toEqual(['task_started', 'task_progress', 'task_notification'])
      expect(events[0]?.payload?.input).toMatchObject({ prompt: 'Review' })
      expect(events[3]?.payload?.parentToolUseID).toBe('agent-1')
      expect(events[3]?.turnId).toBe(`workflow-stage:${stage}:query-1:subagent:agent-1`)
      await project({ queryId: 'query-2', type: 'assistant', parentToolUseId: 'agent-1', agentId: 'child-1',
        message: { id: 'trace-child', content: [{ type: 'text', text: 'Child transcript reply' }] } })
      expect(events[4]?.payload).toMatchObject({ parentToolUseID: 'agent-1', nativeAgentId: 'child-1' })
    }
  })
})
