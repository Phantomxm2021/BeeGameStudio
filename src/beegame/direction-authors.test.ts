import { expect, test } from 'bun:test'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unlink } from 'node:fs/promises'
import { NATIVE_DIRECTION_AUTHORS, nativeWritingAuthors } from '@bee-game-studio/agent-workflow/native-direction-authors'
import { runNativeDirectionAuthors, designAuthorPermissions, designAuthorTools } from './direction-authors.js'
import type { Tool } from '../Tool.js'
import { getCwd } from '../utils/cwd.js'
import { createUserMessage } from '../utils/messages.js'
import type { ToolUseContext } from '../Tool.js'
import type { runTools } from '../services/tools/toolOrchestration.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { enqueuePendingNotification, getCommandQueue, removeByFilter } from '../utils/messageQueueManager.js'
import { writeAgentResultReceipt } from '../utils/task/agentResultReceipt.js'
import { getTaskOutputDir } from '../utils/task/diskOutput.js'

const input = {
  contextPath: join(getCwd(), '.beegame/tmp/context.md'),
  responsibilities: Object.fromEntries(NATIVE_DIRECTION_AUTHORS.map(author =>
    [author.document, 'Original ownership for ' + author.document])) as Record<typeof NATIVE_DIRECTION_AUTHORS[number]['document'], string>,
}
const allow = (async () => ({ behavior: 'allow' })) as CanUseToolFn
function context() {
  let state = { tasks: {} } as ReturnType<ToolUseContext['getAppState']>
  return {
    abortController: new AbortController(),
    getAppState: () => state,
    setAppState: (update: (current: typeof state) => typeof state) => { state = update(state) },
    options: {
      tools: [{ name: 'Agent' }],
      commands: [...new Set(NATIVE_DIRECTION_AUTHORS.flatMap(author => [...author.skills]))]
        .map(name => ({ type: 'prompt', name })),
      agentDefinitions: { activeAgents: [], allAgents: [] },
    },
  } as unknown as ToolUseContext
}
async function collect(execute: typeof runTools, ctx = context(), value: unknown = input,
  pause: (ms: number) => Promise<unknown> = async () => {}) {
  const messages = []
  for await (const message of runNativeDirectionAuthors(value, ctx, allow, execute, pause)) messages.push(message)
  return messages
}
function receipt(id: string, result: unknown, error = false) {
  return createUserMessage({ content: [{ type: 'tool_result', tool_use_id: id, content: 'Actual receipt', is_error: error }],
    toolUseResult: result })
}

test.each([2, 3, 4] as const)('batch %d runs document-local authors in dependency order without a coordinator turn', async batch => {
  const owners = nativeWritingAuthors(batch)
  const ctx = context()
  ctx.options.commands = [...new Set(owners.flatMap(author => [...author.skills]))]
    .map(name => ({ type: 'prompt', name })) as any
  const value = { batch, contextPath: input.contextPath,
    responsibilities: Object.fromEntries(owners.map(author => [author.document, 'Owned ' + author.document])),
    contextPaths: Object.fromEntries(owners.map(author => [author.document, join(getCwd(), '.beegame/tmp', author.document + '.context.md')])) }
  const started: string[] = [], completed: string[] = []
  const execute: typeof runTools = async function* (calls, _assistants, _allow, workerContext) {
    expect(calls).toHaveLength(1)
    expect(completed).toEqual(started)
    const call = calls[0]!
    const author = owners[started.length]!
    started.push(author.document)
    expect(call.input).toMatchObject({ subagent_type: author.agentType })
    const definition = workerContext.options.agentDefinitions.activeAgents.find(agent => agent.agentType === author.agentType)!
    expect(definition.model).toBe('inherit')
    expect(definition.skills).toEqual([...author.skills])
    expect(definition.disallowedTools).toContain('Agent')
    expect(definition.getSystemPrompt({ toolUseContext: workerContext })).toContain(value.contextPaths[author.document])
    workerContext.setAppState(state => ({ ...state, tasks: { ...state.tasks,
      [author.agentType]: { id: author.agentType, type: 'local_agent', status: 'running' } as any } }))
    yield { message: receipt(call.id, { status: 'async_launched', agentId: author.agentType }), newContext: workerContext }
  }
  const stream = runNativeDirectionAuthors(value, ctx, allow, execute, async () => {
    const author = owners[completed.length]!
    completed.push(author.document)
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks,
      [author.agentType]: { ...state.tasks[author.agentType], status: 'completed',
        result: { content: [{ type: 'text', text: 'Saved ' + author.document }] } } as any } }))
  })
  while (true) {
    const next = await stream.next()
    if (next.done) { expect(next.value).toEqual(owners.map(author => 'Saved ' + author.document)); break }
  }
  expect(started).toEqual(owners.map(author => author.document))
  expect(completed).toEqual(started)
  expect(ctx.options.agentDefinitions.activeAgents).toEqual([])
})

test('a failed upstream owner stops before the dependent author is dispatched', async () => {
  const owners = nativeWritingAuthors(2), ctx = context()
  ctx.options.commands = owners.flatMap(author => author.skills.map(name => ({ type: 'prompt', name }))) as any
  const value = { batch: 2, contextPath: input.contextPath,
    responsibilities: Object.fromEntries(owners.map(author => [author.document, 'Owned role'])) }
  let dispatched = 0
  const execute: typeof runTools = async function* (calls, _assistants, _allow, workerContext) {
    dispatched++
    yield { message: receipt(calls[0]!.id, { status: 'failed' }), newContext: workerContext }
  }
  await expect(collect(execute, ctx, value)).rejects.toThrow()
  expect(dispatched).toBe(1)
})

test('author source scope rejects observed log/checker probes and preserves native permission decisions', async () => {
  let forwarded = 0
  const original: CanUseToolFn = async () => { forwarded++; return { behavior: 'deny', message: 'Native decision',
    decisionReason: { type: 'other', reason: 'Synthetic native permission decision' } } }
  original.supportsBackgroundPermissionRequests = true
  const permission = designAuthorPermissions(original, new Set(['host-dispatch']))
  const invoke = (name: string, fields: Record<string, unknown>, id = 'child-tool') =>
    permission({ name } as any, fields, context(), {} as any, id)
  for (const [name, fields] of [
    ['Read', { file_path: '/project/.beegame/config/projects/native.jsonl' }],
    ['Grep', { path: '.beegame/delivery/check-content.mjs' }],
    ['Bash', { command: 'rg camera .beegame/config/projects/native.jsonl' }],
    ['Bash', { command: 'bun .beegame/delivery/check-content.mjs --design-handoff 3' }],
    ['Agent', { subagent_type: 'replacement-author' }],
  ] as const) expect((await invoke(name, fields)).behavior).toBe('deny')
  expect(forwarded).toBe(0)
  for (const [name, fields, id] of [
    ['Read', { file_path: 'docs/GDD.md' }, 'read-doc'],
    ['Read', { file_path: '.beegame/delivery/content-format.json' }, 'read-format'],
    ['Read', { file_path: 'docs/calc/model.mjs' }, 'read-model'],
    ['Bash', { command: 'bun .beegame/delivery/check-content.mjs --format coordinates' }, 'format'],
    ['Bash', { command: 'bun .beegame/delivery/check-content.mjs --layout-draft docs/calc/ui.json 960 540 --appendix > docs/calc/layout.md' }, 'layout'],
    ['Bash', { command: 'bun .beegame/delivery/check-content.mjs --camera-draft docs/calc/camera.json 960 540 > docs/calc/framing.json' }, 'camera'],
    ['Bash', { command: 'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/results.md' }, 'calculate'],
    ['Bash', { command: 'ls docs; bun .beegame/delivery/check-content.mjs --format coordinates' }, 'compound'],
    ['Bash', { command: 'for w in 960 1280; do bun .beegame/delivery/check-content.mjs --layout-draft docs/calc/ui.json "$w" 540; done' }, 'loop'],
    // The shell permission system, not a substring/prefix heuristic, owns
    // adjudication of shell reads. This permission double still denies it.
    ['Bash', { command: "bun -e 'require(\"fs\").readFileSync(\".beegame/delivery/check-content.mjs\")'" }, 'native-shell-read'],
    ['Agent', { subagent_type: 'scheduled-owner' }, 'host-dispatch'],
  ] as const) expect((await invoke(name, fields, id)).behavior).toBe('deny')
  expect(forwarded).toBe(11)
  expect(permission.supportsBackgroundPermissionRequests).toBe(true)
})

test('authors cannot run the premature full-group check but retain the contract help and local calculations', async () => {
  const permission = designAuthorPermissions(allow, new Set())
  const call = (command: string) => permission({ name: 'Bash' } as any, { command }, context(), {} as any, 'draft')
  const denied = await call('bun .beegame/delivery/check-content.mjs --design-handoff 3')
  expect(denied.behavior).toBe('deny')
  expect(denied.message).toContain('assigns document versions after your saved handoff')
  for (const command of ['bun .beegame/delivery/check-content.mjs --design-handoff-help',
    'bun .beegame/delivery/check-content.mjs --design-layouts',
    'bun .beegame/delivery/check-content.mjs --format sceneDocument sceneVocabulary'])
    expect((await call(command)).behavior).toBe('allow')
})

test('the author tool interface preserves the native executor and parent tool objects', async () => {
  const call: Tool['call'] = async () => ({ data: 'Synthetic native result' })
  const bash = { name: 'Bash', prompt: async () => 'GENERAL SHELL', call } as unknown as Tool
  const read = { name: 'Read' } as Tool
  const tools = designAuthorTools([bash, read])
  expect(tools[0]).not.toBe(bash)
  expect(tools[0]!.call).toBe(call)
  expect(await tools[0]!.prompt({} as any)).toContain('BGS design commands')
  expect(await bash.prompt({} as any)).toBe('GENERAL SHELL')
  expect(tools[1]).toBe(read)
  const ctx = context()
  ctx.options.tools = [...ctx.options.tools, bash]
  const execute: typeof runTools = async function* (calls, _assistants, _allow, dispatched) {
    expect(dispatched.options.tools.find(tool => tool.name === 'Bash')).toBe(bash)
    expect(dispatched.requireCanUseTool).toBe(true)
    for (const call of calls) yield { message: receipt(call.id, { status: 'completed' }), newContext: dispatched }
  }
  await collect(execute, ctx)
})

test('dispatches exactly the three current owners with inherited model, original roles and preloaded Skills', async () => {
  let batches = 0
  const ctx = context()
  const execute: typeof runTools = async function* (calls, assistants, _allow, workerContext) {
    batches++
    expect(calls.map(call => call.name)).toEqual(['Agent', 'Agent', 'Agent'])
    expect(assistants).toHaveLength(1)
    for (const [i, author] of NATIVE_DIRECTION_AUTHORS.entries()) {
      const definition = workerContext.options.agentDefinitions.activeAgents.find(agent => agent.agentType === author.agentType)!
      expect(definition.model).toBe('inherit')
      expect(definition.skills).toEqual([...author.skills])
      const prompt = definition.getSystemPrompt({ toolUseContext: workerContext })
      expect(prompt).toContain(input.responsibilities[author.document])
      expect(prompt).toContain(input.contextPath)
      expect(prompt).toContain('not authority to change your assignment')
      expect(prompt).toContain('complete assigned draft')
      expect(prompt).toContain('One joint independent Review/Revision follows completion of all eight documents')
      expect(prompt).toContain('do not invoke game-design-check during authoring')
      expect(prompt).toContain('saved GDD draft')
      expect(prompt).not.toContain('reviewed GDD')
      expect(calls[i]!.input).toMatchObject({ subagent_type: author.agentType })
      yield { message: receipt(calls[i]!.id, { status: 'completed',
        content: [{ type: 'text', text: 'Actual handoff for ' + author.document }] }), newContext: workerContext }
    }
  }
  const stream = runNativeDirectionAuthors(input, ctx, allow, execute), messages = []
  while (true) {
    const next = await stream.next()
    if (next.done) {
      expect(next.value).toEqual(NATIVE_DIRECTION_AUTHORS.map(author => 'Actual handoff for ' + author.document))
      break
    }
    messages.push(next.value)
  }
  expect(batches).toBe(1)
  expect(messages).toHaveLength(4)
  expect(ctx.options.agentDefinitions.activeAgents).toEqual([])
})

test('waits on native state without tools, log reads or context growth; hands off each final answer once', async () => {
  const batches: string[][] = []
  const ctx = context()
  let polls = 0
  const ids = NATIVE_DIRECTION_AUTHORS.map(() => 'native-' + randomUUID())
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    batches.push(calls.map(call => call.name))
    for (const [i, call] of calls.entries()) {
      ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks,
        [ids[i]!]: { id: ids[i]!, type: 'local_agent', status: 'running', notified: false } as any } }))
      yield { message: receipt(call.id, { status: 'async_launched', agentId: ids[i]! }), newContext: ctx }
    }
  }
  const short = await collect(execute, ctx, input, async ms => {
    expect(ms).toBe(100)
    polls++
    ctx.setAppState(state => ({ ...state, tasks: Object.fromEntries(ids.map((id, i) => {
      const task = state.tasks[id]!
      expect(task.notified).toBe(true)
      return [id, { ...task, status: 'completed', result: { content: [{ type: 'text', text: 'Final owner ' + i }] } }]
    })) as any }))
  })
  expect(polls).toBe(1)
  const shortContent = short.map(message => (message as any).message?.content)
  polls = 0
  const long = await collect(execute, ctx, input, async () => {
    polls++
    ctx.setAppState(state => ({ ...state, tasks: Object.fromEntries(ids.map((id, i) => [id, {
      ...state.tasks[id], status: polls === 100 ? 'completed' : 'running',
      // Real running agents hold transcript history. It must never be handed
      // to the model; this would have reproduced the old TaskOutput fallback.
      messages: [{ type: 'user', message: { content: 'RAW_TRANSCRIPT_' + 'x'.repeat(polls * 10_000) } }],
      ...(polls === 100 ? { result: { content: [{ type: 'text', text: 'Final owner ' + i }] } } : { result: undefined }),
    }])) as any }))
  })
  expect(polls).toBe(100)
  expect(batches).toEqual([['Agent', 'Agent', 'Agent'], ['Agent', 'Agent', 'Agent']])
  expect(short).toHaveLength(7)
  expect(long).toHaveLength(7)
  // Tool IDs differ, but the number and size of semantic payloads do not.
  expect(JSON.stringify(long.map(message => (message as any).message?.content)).length).toBe(JSON.stringify(shortContent).length)
  expect(JSON.stringify(long)).not.toContain('RAW_TRANSCRIPT_')
  for (let i = 0; i < 3; i++) expect(JSON.stringify(long).split('Final owner ' + i)).toHaveLength(2)
})

test('each writing owner receives only its own scoped input path', async () => {
  const value = { ...input, contextPaths: Object.fromEntries(NATIVE_DIRECTION_AUTHORS.map(author =>
    [author.document, join(getCwd(), '.beegame/tmp', author.document + '.context.md')])) }
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    for (const [i, author] of NATIVE_DIRECTION_AUTHORS.entries()) {
      const definition = ctx.options.agentDefinitions.activeAgents.find(agent => agent.agentType === author.agentType)!
      const system = definition.getSystemPrompt({ toolUseContext: ctx })
      const assignment = JSON.stringify(calls[i]!.input)
      for (const [name, path] of Object.entries(value.contextPaths)) {
        if (name === author.document) {
          expect(system).toContain(path)
          expect(assignment).toContain(path)
        } else {
          expect(system).not.toContain(path)
          expect(assignment).not.toContain(path)
        }
      }
      expect(system).not.toContain(input.contextPath)
      yield { message: receipt(calls[i]!.id, { status: 'completed' }), newContext: ctx }
    }
  }
  await collect(execute, context(), value)
  let invoked = false
  const never: typeof runTools = async function* () { invoked = true }
  await expect(collect(never, context(), { ...value,
    contextPaths: { ...value.contextPaths, 'AUDIO_DESIGN.md': '/outside/audio.md' } })).rejects.toThrow()
  expect(invoked).toBe(false)
})

test.each(['denied', 'missing-receipt', 'worker-failed', 'cancelled'] as const)('stops integration after %s', async failure => {
  const ctx = context()
  const execute: typeof runTools = async function* (calls, _assistants, _allow, workerContext) {
    for (const [i, call] of calls.entries()) {
      if (failure === 'missing-receipt' && i === 0) continue
      if (failure === 'cancelled') ctx.abortController.abort()
      yield { message: receipt(call.id, failure === 'worker-failed' ? { status: 'failed' } : { status: 'completed' },
        failure === 'denied'), newContext: workerContext }
    }
  }
  await expect(collect(execute, ctx)).rejects.toThrow()
})

test.each(['missing-skill', 'missing-agent-tool', 'outside-context', 'invalid-metadata'] as const)('rejects %s before starting any worker', async failure => {
  const ctx = context()
  if (failure === 'missing-skill') ctx.options.commands = []
  if (failure === 'missing-agent-tool') ctx.options.tools = []
  let invoked = false
  const execute: typeof runTools = async function* () { invoked = true }
  await expect(collect(execute, ctx, failure === 'outside-context' ? { ...input, contextPath: '/outside/context.md' }
    : failure === 'invalid-metadata' ? null : input)).rejects.toThrow()
  expect(invoked).toBe(false)
})

test('a failed background task cannot become a completed handoff', async () => {
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks,
      'native-child': { id: 'native-child', type: 'local_agent', status: 'failed' } as any } }))
    for (const call of calls) yield { message: receipt(call.id,
      { status: 'async_launched', agentId: 'native-child' }), newContext: ctx }
  }
  await expect(collect(execute)).rejects.toThrow('did not complete')
})

test('cancellation during state-only waiting stops handoff without starting another tool batch', async () => {
  const ctx = context()
  let batches = 0
  const execute: typeof runTools = async function* (calls, _assistants, _allow, workerContext) {
    batches++
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks,
      'native-child': { id: 'native-child', type: 'local_agent', status: 'running' } as any } }))
    for (const call of calls) yield { message: receipt(call.id,
      { status: 'async_launched', agentId: 'native-child' }), newContext: workerContext }
  }
  await expect(collect(execute, ctx, input, async () => { ctx.abortController.abort() })).rejects.toThrow('cancelled')
  expect(batches).toBe(1)
})

test('recovers only a final answer from an evicted task receipt and removes only its duplicate notification', async () => {
  const id = 'native-' + randomUUID()
  const other = 'native-' + randomUUID()
  const foreign = 'native-' + randomUUID()
  await writeAgentResultReceipt(getTaskOutputDir(), { version: 1, task_id: id,
    task_type: 'local_agent', status: 'completed', description: 'Test author', output: 'Recovered final answer' }, false)
  const notification = (taskId: string, toolUseId?: string) => '<task-notification><task-id>' + taskId +
    '</task-id>' + (toolUseId ? '<tool-use-id>' + toolUseId + '</tool-use-id>' : '') +
    '<status>completed</status></task-notification>'
  const stale = notification(id, 'stale-' + randomUUID())
  const quoted = '<task-notification><result>' + notification(id) + '</result></task-notification>'
  let current = ''
  enqueuePendingNotification({ mode: 'task-notification', value: notification(id) })
  enqueuePendingNotification({ mode: 'task-notification', value: notification(other) })
  enqueuePendingNotification({ mode: 'task-notification', value: notification(id), agentId: foreign as any })
  enqueuePendingNotification({ mode: 'task-notification', value: stale })
  enqueuePendingNotification({ mode: 'task-notification', value: quoted })
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    current = notification(id, calls[0]!.id)
    enqueuePendingNotification({ mode: 'task-notification', value: current })
    for (const [i, call] of calls.entries()) yield { message: receipt(call.id,
      i === 0 ? { status: 'async_launched', agentId: id } : { status: 'completed' }), newContext: ctx }
  }
  try {
    const messages = await collect(execute)
    expect(JSON.stringify(messages).split('Recovered final answer')).toHaveLength(2)
    expect(getCommandQueue().some(command => command.value === notification(id) && command.agentId === undefined)).toBe(false)
    expect(getCommandQueue().some(command => command.value === notification(other))).toBe(true)
    expect(getCommandQueue().some(command => command.value === notification(id) && command.agentId === foreign)).toBe(true)
    expect(getCommandQueue().some(command => command.value === current)).toBe(false)
    expect(getCommandQueue().some(command => command.value === stale)).toBe(true)
    expect(getCommandQueue().some(command => command.value === quoted)).toBe(true)
  } finally {
    removeByFilter(command => typeof command.value === 'string' &&
      [notification(id), notification(other), current, stale, quoted].includes(command.value))
    await unlink(join(getTaskOutputDir(), id + '.result.json'))
  }
})

test('missing asynchronous state and receipt stops integration rather than redispatching', async () => {
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    for (const call of calls) yield { message: receipt(call.id,
      { status: 'async_launched', agentId: 'missing-' + randomUUID() }), newContext: ctx }
  }
  await expect(collect(execute)).rejects.toThrow('receipt is unavailable')
})
