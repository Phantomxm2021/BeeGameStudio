import { afterEach, beforeEach, expect, test } from 'bun:test'
import { getIsNonInteractiveSession, setIsInteractive } from '../../../bootstrap/state'
import { createAssistantMessage, createCompactBoundaryMessage, createProgressMessage, createUserMessage } from '../../messages'
import { drainSdkEvents } from '../../sdkEventQueue'
import { emitSubagentVisibleMessage, emitSubagentStreamEvent } from '../sdkProgress'

let wasNonInteractive = false
beforeEach(() => {
  wasNonInteractive = getIsNonInteractiveSession()
  drainSdkEvents()
  setIsInteractive(false)
})
afterEach(() => {
  drainSdkEvents()
  setIsInteractive(!wasNonInteractive)
})

test('a background tool invocation is visible before its result, without private blocks or history mutation', () => {
  const started = createAssistantMessage({ content: [
    { type: 'thinking', thinking: 'PRIVATE_THOUGHT', signature: 'PRIVATE_SIGNATURE' },
    { type: 'text', text: 'Unrelated assistant text', citations: [] },
    { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'bun test' } },
  ] })
  const original = JSON.stringify(started)
  emitSubagentVisibleMessage(started, 'agent-owner')
  const initial = drainSdkEvents()
  expect(initial).toHaveLength(1)
  expect(initial[0]).toMatchObject({ type: 'assistant', parent_tool_use_id: 'agent-owner', uuid: started.uuid,
    message: { content: [{ type: 'text', text: 'Unrelated assistant text' },
      { type: 'tool_use', id: 'bash-1', name: 'Bash', input: { command: 'bun test' } }] } })
  expect(JSON.stringify(initial)).not.toContain('PRIVATE_THOUGHT')
  expect(JSON.stringify(initial)).not.toContain('PRIVATE_SIGNATURE')
  expect(JSON.stringify(initial)).toContain('Unrelated assistant text')
  expect(JSON.stringify(started)).toBe(original)

  const result = createUserMessage({ content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'test failed', is_error: true }] })
  emitSubagentVisibleMessage(result, 'agent-owner')
  expect(drainSdkEvents()).toMatchObject([{ type: 'user', parent_tool_use_id: 'agent-owner', uuid: result.uuid,
    message: { content: [{ type: 'tool_result', tool_use_id: 'bash-1', content: 'test failed', is_error: true }] } }])
})

test('public partial-message opt-in forwards child deltas exactly once with their immediate owner and no history mutation', () => {
  const message = { type: 'stream_event', uuid: 'stream-uuid', event: { type: 'message_start', message: { id: 'provider-id', usage: { input_tokens: 12 } } } }
  const before = JSON.stringify(message)
  emitSubagentStreamEvent(message, 'nested-agent', false)
  emitSubagentStreamEvent(message, undefined, true)
  expect(drainSdkEvents()).toEqual([])
  emitSubagentStreamEvent(message, 'nested-agent', true)
  expect(drainSdkEvents()).toMatchObject([{ type: 'stream_event', parent_tool_use_id: 'nested-agent', uuid: 'stream-uuid', event: message.event }])
  expect(JSON.stringify(message)).toBe(before)
})

test('parallel calls retain distinct invocation IDs in one complete native message', () => {
  emitSubagentVisibleMessage(createAssistantMessage({ content: [
    { type: 'tool_use', id: 'read-1', name: 'Read', input: { file_path: 'a.json' } },
    { type: 'tool_use', id: 'read-2', name: 'Read', input: { file_path: 'b.json' } },
  ] }), 'parent')
  expect(drainSdkEvents()).toMatchObject([{ message: { content: [{ id: 'read-1' }, { id: 'read-2' }] } }])
})

test('a nested foreground progress wrapper retains the nested invocation, not the outer worker', () => {
  const message = createAssistantMessage({ content: 'Nested update' })
  emitSubagentVisibleMessage(createProgressMessage({ toolUseID: 'nested-progress', parentToolUseID: 'nested-agent',
    data: { type: 'agent_progress', message, prompt: 'Nested task', agentId: 'nested-native' } }), 'outer-agent')
  expect(drainSdkEvents()).toMatchObject([{ type: 'assistant', parent_tool_use_id: 'nested-agent',
    message: { content: [{ type: 'text', text: 'Nested update' }] } }])
})

test('text-only child messages are live, but private, user-prompt, unowned and interactive blocks stay out', () => {
  emitSubagentVisibleMessage(createAssistantMessage({ content: 'Working' }), 'parent')
  expect(drainSdkEvents()).toMatchObject([{ type: 'assistant', parent_tool_use_id: 'parent',
    message: { content: [{ type: 'text', text: 'Working' }] } }])
  emitSubagentVisibleMessage(createUserMessage({ content: 'Do not echo the child assignment' }), 'parent')
  emitSubagentVisibleMessage(createAssistantMessage({ content: [{ type: 'thinking', thinking: 'PRIVATE', signature: 'PRIVATE' }] }), 'parent')
  const tool = createAssistantMessage({ content: [{ type: 'tool_use', id: 'read-1', name: 'Read', input: {} }] })
  emitSubagentVisibleMessage(tool, undefined)
  expect(drainSdkEvents()).toEqual([])
  setIsInteractive(true)
  emitSubagentVisibleMessage(tool, 'parent')
  expect(drainSdkEvents()).toEqual([])
})

test('forwards the native compaction boundary with its child owner, without altering the transcript', () => {
  const message = createCompactBoundaryMessage('auto', 120000)
  const before = JSON.stringify(message)
  emitSubagentVisibleMessage(message, 'child')
  expect(drainSdkEvents()).toMatchObject([{ type: 'system', subtype: 'compact_boundary',
    parent_tool_use_id: 'child', compact_metadata: { trigger: 'auto', pre_tokens: 120000 } }])
  expect(JSON.stringify(message)).toBe(before)
})

test('background shell progress retains canonical tool ownership and the native gate/cadence', () => {
  const remote = process.env.CLAUDE_CODE_REMOTE, container = process.env.CLAUDE_CODE_CONTAINER_ID
  try {
    delete process.env.CLAUDE_CODE_REMOTE; delete process.env.CLAUDE_CODE_CONTAINER_ID
    const message = createProgressMessage({ toolUseID: 'transient-progress', parentToolUseID: 'real-bash',
      data: { type: 'bash_progress', elapsedTimeSeconds: 120, taskId: 'shell-task' } })
    emitSubagentVisibleMessage(message, 'child')
    expect(drainSdkEvents()).toEqual([])
    process.env.CLAUDE_CODE_REMOTE = '1'
    emitSubagentVisibleMessage(message, 'child')
    expect(drainSdkEvents()).toMatchObject([{ type: 'tool_progress', tool_use_id: 'real-bash',
      parent_tool_use_id: 'child', tool_name: 'Bash', elapsed_time_seconds: 120 }])
    emitSubagentVisibleMessage(message, 'child')
    expect(drainSdkEvents()).toEqual([])
    emitSubagentVisibleMessage(createProgressMessage({ toolUseID: 'ps-progress', parentToolUseID: 'real-ps',
      data: { type: 'powershell_progress', elapsedTimeSeconds: 20 } }), 'another-child')
    expect(drainSdkEvents()).toMatchObject([{ tool_use_id: 'real-ps', parent_tool_use_id: 'another-child', tool_name: 'PowerShell' }])
  } finally {
    if (remote === undefined) delete process.env.CLAUDE_CODE_REMOTE; else process.env.CLAUDE_CODE_REMOTE = remote
    if (container === undefined) delete process.env.CLAUDE_CODE_CONTAINER_ID; else process.env.CLAUDE_CODE_CONTAINER_ID = container
  }
})
