import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createNativeSubagentChatEnricher, readVisibleSubagentActivity } from './native-subagent-chat'

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
      expect(progress.payload).toHaveProperty('subagentActivity')
      const terminal = enrich({ type: 'tool.completed', payload: { toolName: 'TaskOutput', toolUseID: 'wait-1',
        input: { task_id: 'task-1' }, nativeTaskResult: { taskId: 'task-1', status: 'failed', result: 'Test failed' } } })
      expect(terminal.payload).toMatchObject({ nativeBackgroundTaskResult: {
        toolUseID: 'agent-1', status: 'failed', result: 'Test failed',
      }, backgroundAgentInput: input })
      expect(terminal.payload).toHaveProperty('subagentActivity')
      const activity = readVisibleSubagentActivity(path)!
      expect(activity.entries).toMatchObject([
        { kind: 'message', text: 'Checking manifest' },
        { id: 'read-1', kind: 'tool', toolName: 'Read', filePath: 'manifest.json', status: 'completed', output: 'valid manifest' },
      ])
      expect(JSON.stringify(activity)).not.toContain('private thought')
      expect(readVisibleSubagentActivity(join(dir, 'missing'))).toBeUndefined()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('keeps tool identity and filename when truncating a long source result, and distinguishes shell failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-structured-'))
    try {
      const path = join(dir, 'child.output')
      writeFileSync(path, [
        { type: 'assistant', message: { content: [
          { type: 'tool_use', id: 'read', name: 'Read', input: { file_path: 'src/Game.tsx' } },
          { type: 'tool_use', id: 'bash', name: 'Bash', input: { command: 'bun test' } },
        ] } },
        { type: 'user', message: { content: [
          { type: 'tool_result', tool_use_id: 'read', content: 'const item = <div />;\n'.repeat(1500) },
          { type: 'tool_result', tool_use_id: 'bash', is_error: true, content: 'test failed' },
        ] } },
      ].map(row => JSON.stringify(row)).join('\n'))
      const activity = readVisibleSubagentActivity(path)!
      expect(activity.truncated).toBe(true)
      expect(activity.entries[0]).toMatchObject({ id: 'read', filePath: 'src/Game.tsx', truncated: true, status: 'completed' })
      expect(activity.entries[1]).toMatchObject({ id: 'bash', command: 'bun test', status: 'failed', output: 'test failed' })
      expect(JSON.stringify(activity).length).toBeLessThan(24000)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  test('labels native background shell work as a task and closes it from structured TaskOutput', () => {
    const enrich = createNativeSubagentChatEnricher()
    const started = enrich({ type: 'system.status', payload: { type: 'system', subtype: 'task_started',
      task_id: 'shell-1', task_type: 'local_bash', tool_use_id: 'bash-call', description: 'Run tests' } })
    expect(started.payload).toMatchObject({ toolName: 'Task', toolUseID: 'bash-call',
      input: { description: 'Run tests' } })
    const ended = enrich({ type: 'tool.completed', payload: { toolName: 'TaskOutput', toolUseID: 'wait-call',
      nativeTaskResult: { taskId: 'shell-1', status: 'failed', result: 'Tests failed' } } })
    expect(ended.payload).toMatchObject({ nativeBackgroundTaskResult: {
      toolUseID: 'bash-call', toolName: 'Task', status: 'failed', result: 'Tests failed',
    } })
  })

  test('does not guess a source language for a result whose invocation is outside the retained tail', () => {
    const dir = mkdtempSync(join(tmpdir(), 'subagent-orphan-'))
    try {
      const path = join(dir, 'child.output')
      writeFileSync(path, JSON.stringify({ type: 'user', message: { content: [
        { type: 'tool_result', tool_use_id: 'unknown', content: '<div>Hello</div>' },
      ] } }))
      expect(readVisibleSubagentActivity(path)?.entries[0]).toEqual({
        id: 'unknown', kind: 'tool', toolName: '', status: 'completed', output: '<div>Hello</div>',
      })
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
})
