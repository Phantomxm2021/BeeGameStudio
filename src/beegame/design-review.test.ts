import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentDefinition } from '@bee-game-studio/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { Command } from '../types/command.js'
import { DESIGN_REVIEW_AGENT, DESIGN_REVIEW_MAX_TURNS, designReviewAgents, designReviewReference, designReviewPermissions, designReviewToolNames, designReviewTools, runNativeDesignReview } from './design-review.js'
import type { ToolUseContext } from '../Tool.js'
import type { Tool } from '../Tool.js'
import { resolveAgentTools } from '@bee-game-studio/builtin-tools/tools/AgentTool/agentToolUtils.js'
import type { runTools } from '../services/tools/toolOrchestration.js'
import type { CanUseToolFn } from '../hooks/useCanUseTool.js'
import { createUserMessage } from '../utils/messages.js'
import { resolveHookPermissionDecision } from '../services/tools/toolHooks.js'
import { AgentExecutionLimitError } from '../utils/errors.js'

const skillRoot = new URL('../../.beegame/skills/builtinskills/game-design-check/', import.meta.url).pathname
const commands = [{ name: 'game-design-check', type: 'prompt', skillRoot }] as Command[]
const existing: AgentDefinition[] = [{ agentType: 'other', source: 'flagSettings',
  whenToUse: 'Existing role', getSystemPrompt: () => 'Untouched' }]
const turn = { restartContext: true, reviewDocuments: ['GDD.md'],
  reviewContextPath: '/workspace/.beegame/tmp/context.md', reviewStep: 'inspect' as const,
  reviewWorkspace: '/workspace', reviewResultPath: '/workspace/.beegame/tmp/result.txt', reviewWritableDocuments: [],
  reviewReceiptContext: { step: 'inspect' as const, findings: [], sourceHeadings: { 'GDD.md': ['Design'] } } }
const receiptContent = (step: 'inspect' | 'revise' | 'verify') => 'complete\n' + JSON.stringify({ step, findings: [], resolved: [] })

test('review uses native Skill preload, original task path and inherited model without changing other agents', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-review-role-'))
  await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
  const input = { ...turn, reviewContextPath: join(workspace, 'context.md'), reviewWorkspace: workspace,
    reviewResultPath: join(await realpath(workspace), '.beegame/tmp/result.txt') }
  await writeFile(input.reviewContextPath, '# Original assignment')
  try {
    const agents = await designReviewAgents(existing, input, await realpath(workspace), commands)
    expect(existing).toHaveLength(1)
    expect(agents[0]).toBe(existing[0])
    const reviewer = agents.find(agent => agent.agentType === DESIGN_REVIEW_AGENT)!
    expect(reviewer.model).toBe('inherit')
    expect(reviewer.skills).toEqual(['game-design-check'])
    expect(reviewer.maxTurns).toBe(DESIGN_REVIEW_MAX_TURNS)
    expect(reviewer.disallowedTools).toEqual(['Agent'])
    expect(reviewer.tools).toEqual(designReviewToolNames('inspect'))
    const prompt = reviewer.getSystemPrompt({ toolUseContext: {} as any })
    expect(prompt).toContain(input.reviewContextPath)
    expect(prompt).toContain('GDD.md')
    expect(prompt).toContain('## GDD.md')
    expect(prompt).toContain('Can the player understand the goal')
    expect(prompt).not.toContain('## AUDIO_DESIGN.md')
    expect(prompt).toContain('not additional authority')
    expect(prompt).not.toContain('museum')
    expect((await designReviewAgents(agents, input, workspace, commands))
      .filter(agent => agent.agentType === DESIGN_REVIEW_AGENT)).toHaveLength(1)
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('review delivers exact selected Skill reference bytes and fails closed on missing methods', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-methods-'))
  try {
    await mkdir(join(root, 'references'))
    await writeFile(join(root, 'references/document-checks.md'), '# Methods\n\n## GDD.md\n\nUnique core method.\n\n## UI_UX_SPEC.md\n\nUnique combined-layout method.\n\n## AUDIO_DESIGN.md\n\nUnrelated method.\n')
    const input = await designReviewReference(root, ['GDD.md', 'UI_UX_SPEC.md', 'GDD.md'])
    expect(input).toContain('Unique core method.')
    expect(input).toContain('Unique combined-layout method.')
    expect(input.match(/## GDD.md/g)).toHaveLength(1)
    expect(input).not.toContain('Unrelated method.')
    await expect(designReviewReference(undefined, ['GDD.md'])).rejects.toThrow('reference directory')
    await expect(designReviewReference(root, ['BALANCE_DESIGN.md'])).rejects.toThrow('method section is unavailable')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('ordinary turns do not register a reviewer or require the checking Skill', async () => {
  expect(await designReviewAgents(existing, undefined, '/workspace', [])).toBe(existing)
  expect(await designReviewAgents(existing, { restartContext: false }, '/workspace', [])).toBe(existing)
})

test('missing Skill or original context stops review setup, without a fallback reviewer', async () => {
  await expect(designReviewAgents(existing, turn, '/workspace', [])).rejects.toThrow('Skill is unavailable')
  for (const path of [undefined, '', 'context.md'])
    await expect(designReviewAgents(existing, { ...turn, reviewContextPath: path }, '/workspace', commands))
      .rejects.toThrow('original task context')
  expect(existing).toHaveLength(1)
})

test('canonical path checks accept workspace aliases but reject a task symlink escaping the workspace', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-review-boundary-'))
  const outside = await mkdtemp(join(tmpdir(), 'bgs-review-outside-'))
  try {
    const source = join(outside, 'context.md'), link = join(workspace, 'context.md')
    await writeFile(source, 'Outside source')
    await symlink(source, link)
    await expect(designReviewAgents(existing, { ...turn, reviewContextPath: link, reviewWorkspace: workspace }, workspace, commands))
      .rejects.toThrow('original task context')
  } finally {
    await rm(workspace, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test.each(['inspect', 'revise', 'verify'] as const)('%s enforces actual file and shell permissions', async step => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-permissions-')))
  try {
    await mkdir(join(workspace, 'docs'))
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    const result = join(workspace, '.beegame/tmp/result.txt')
    const permission = designReviewPermissions({ ...turn, reviewStep: step, reviewWorkspace: workspace,
      reviewResultPath: result, reviewWritableDocuments: ['GDD.md'], reviewReceiptContext: { ...turn.reviewReceiptContext, step } }, allow, 'dispatch')
    const call = (name: string, input: any, id = 'child') => permission({ name } as any, input, {} as any, {} as any, id)
    expect((await call('Write', { file_path: result, content: receiptContent(step) })).behavior).toBe('allow')
    expect((await call('Edit', { file_path: join(workspace, 'docs/GDD.md') })).behavior).toBe(step === 'revise' ? 'allow' : 'deny')
    expect((await call('Write', { file_path: join(workspace, 'docs/ART_DIRECTION.md') })).behavior).toBe('deny')
    expect((await call('Bash', { command: 'bun .beegame/delivery/check-content.mjs --design-handoff 1' })).behavior).toBe('allow')
    expect((await call('Bash', { command: 'bun .beegame/delivery/check-content.mjs --review-layouts' })).behavior).toBe('allow')
    expect((await call('Bash', { command: 'bun .beegame/delivery/calculate-balance.mjs --help' })).behavior).toBe('allow')
    expect((await call('Bash', { command: 'bun .beegame/delivery/calculate-balance.mjs model.mjs output.md --verify verify.mjs' })).behavior).toBe('deny')
    expect((await call('Bash', { command: 'bun .beegame/delivery/check-content.mjs > docs/GDD.md' })).behavior).toBe('deny')
    expect((await call('Bash', { command: 'touch docs/GDD.md' })).behavior).toBe('deny')
    expect((await call('Agent', {}, 'child')).behavior).toBe('deny')
    expect((await call('Agent', {}, 'dispatch')).behavior).toBe('allow')
    const hooked = await resolveHookPermissionDecision({ behavior: 'allow' } as any,
      { name: 'Write' } as any, { file_path: join(workspace, 'docs/ART_DIRECTION.md') },
      { requireCanUseTool: true } as any, permission, {} as any, 'hooked-write')
    expect(hooked.decision.behavior).toBe('deny')
    await symlink('/etc/hosts', join(workspace, 'docs/GDD.md'))
    expect((await call('Edit', { file_path: join(workspace, 'docs/GDD.md') })).behavior).toBe('deny')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('canonical receipt permissions work through a workspace alias without granting another directory', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-alias-')))
  const workspace = join(root, 'actual'), alias = join(root, 'alias')
  try {
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    await mkdir(join(workspace, 'docs'))
    await symlink(workspace, alias)
    const receipt = join(workspace, '.beegame/tmp/result.txt')
    const permission = designReviewPermissions({ ...turn, reviewStep: 'revise', reviewWorkspace: alias,
      reviewResultPath: receipt, reviewWritableDocuments: ['GDD.md'], reviewReceiptContext: { ...turn.reviewReceiptContext, step: 'revise' } }, allow, 'dispatch')
    for (const file of [receipt, join(alias, '.beegame/tmp/result.txt'), join(alias, 'docs/GDD.md')])
      expect((await permission({ name: 'Write' } as any, { file_path: file, content: receiptContent('revise') }, {} as any, {} as any, 'child')).behavior).toBe('allow')
    expect((await permission({ name: 'Write' } as any, { file_path: join(root, 'other.txt') }, {} as any, {} as any, 'child')).behavior).toBe('deny')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test.each(['inspect', 'revise', 'verify'] as const)('%s can inspect a static sample but not execute its scripts or write another owner sample', async step => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-static-sample-')))
  try {
    await mkdir(join(workspace, 'docs/visual/ART_DIRECTION'), { recursive: true })
    await mkdir(join(workspace, 'docs/visual/UI_UX_SPEC'), { recursive: true })
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    const art = 'docs/visual/ART_DIRECTION/sample.html'
    await writeFile(join(workspace, art), '<main>Static sample</main>')
    const input = { ...turn, reviewStep: step, reviewWorkspace: workspace, reviewDocuments: ['ART_DIRECTION.md'],
      reviewResultPath: join(workspace, '.beegame/tmp/result.txt'), reviewWritableDocuments: ['ART_DIRECTION.md'],
      reviewWritableFiles: [art], reviewReceiptContext: { step, findings: [], sourceHeadings: { 'ART_DIRECTION.md': ['Design'] } } }
    const permission = designReviewPermissions(input, allow, 'dispatch')
    const call = (name: string, input: any) => permission({ name } as any, input, {} as any, {} as any, 'child')
    const api = 'http://127.0.0.1:12345/' + 'a'.repeat(64)
    const command = 'node .beegame/delivery/inspect-design.mjs --visual-sample ' + art + ' 960 540 --preview-api ' + api
    expect((await call('Bash', { command })).behavior).toBe('allow')
    for (const commandVariant of [command + ' --capture docs/GDD.md', command + '; touch game.js',
      command.replace(art, 'docs/visual/ART_DIRECTION/../../game.html'),
      command.replace('960', '99999'), command.replace('ART_DIRECTION', 'UI_UX_SPEC'),
      'node ' + art, command.replace('--visual-sample', '--preview')])
      expect((await call('Bash', { command: commandVariant })).behavior).toBe('deny')
    expect((await call('Edit', { file_path: join(workspace, art) })).behavior).toBe(step === 'revise' ? 'allow' : 'deny')
    expect((await call('Write', { file_path: join(workspace, 'docs/visual/UI_UX_SPEC/sample.html') })).behavior).toBe('deny')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

const allow = (async () => ({ behavior: 'allow' })) as CanUseToolFn
test.each(['inspect', 'revise', 'verify'] as const)('%s enforces exact calculation and sidecar grants, including workspace aliases', async step => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-calculation-scope-')))
  const workspace = join(root, 'actual'), alias = join(root, 'alias')
  try {
    await mkdir(join(workspace, 'docs/calc'), { recursive: true })
    await mkdir(join(workspace, '.beegame/design-handoffs'), { recursive: true })
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    await symlink(workspace, alias)
    await mkdir(join(workspace, 'content/ui'), { recursive: true })
    for (const path of ['docs/calc/model.mjs', 'docs/calc/appendix.md', 'content/ui/menu.json']) await writeFile(join(workspace, path), 'fixture')
    const input = { ...turn, reviewStep: step, reviewWorkspace: alias,
      reviewResultPath: join(workspace, '.beegame/tmp/result.txt'), reviewWritableDocuments: ['GDD.md'],
      reviewWritableFiles: ['docs/calc/model.mjs', 'docs/calc/appendix.md', '.beegame/design-handoffs/GDD.json', 'content/ui/menu.json', 'content/ui/new/popup.json'],
      reviewReceiptContext: { ...turn.reviewReceiptContext, step } }
    const permission = designReviewPermissions(input, allow, 'dispatch')
    const call = (name: string, value: any) => permission({ name } as any, value, {} as any, {} as any, 'child')
    const command = 'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/appendix.md'
    for (const path of input.reviewWritableFiles)
      expect((await call('Edit', { file_path: join(alias, path) })).behavior).toBe(step === 'revise' ? 'allow' : 'deny')
    expect((await call('Write', { file_path: join(alias, 'content/ui/new/popup.json'), content: '{}' })).behavior)
      .toBe(step === 'revise' ? 'allow' : 'deny')
    await symlink(join(root, 'missing-outside'), join(workspace, 'content/ui/new'))
    expect((await call('Write', { file_path: join(alias, 'content/ui/new/popup.json'), content: '{}' })).behavior).toBe('deny')
    expect((await call('Bash', { command })).behavior).toBe(step === 'revise' ? 'allow' : 'deny')
    for (const command of [
      'bun .beegame/delivery/calculate-balance.mjs docs/calc/other.mjs docs/calc/appendix.md',
      'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/new.md',
      'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/appendix.md --verify docs/calc/model.mjs',
      'bun .beegame/delivery/calculate-balance.mjs docs/calc/model.mjs docs/calc/appendix.md | echo done',
    ]) expect((await call('Bash', { command })).behavior).toBe('deny')
    expect((await call('Edit', { file_path: join(alias, 'docs/calc/other.mjs') })).behavior).toBe('deny')
    for (const path of ['content/ui/other.json', 'content/scenes/main.json', 'content/index.json'])
      expect((await call('Write', { file_path: join(alias, path) })).behavior).toBe('deny')
    expect((await call('Write', { file_path: join(alias, '.beegame/design-handoffs/ART_DIRECTION.json') })).behavior).toBe('deny')
    const originalDenial = designReviewPermissions(input, (async () => ({ behavior: 'deny', message: 'Native execution permission denied',
      decisionReason: { type: 'other', reason: 'Synthetic native permission rejection' } })) as CanUseToolFn, 'dispatch')
    expect((await originalDenial({ name: 'Bash' } as any, { command }, {} as any, {} as any, 'child')).behavior).toBe('deny')
    await rm(join(workspace, 'docs/calc/model.mjs'))
    await symlink(join(workspace, 'docs/calc/appendix.md'), join(workspace, 'docs/calc/model.mjs'))
    expect((await call('Bash', { command })).behavior).toBe('deny')
    expect((await call('Edit', { file_path: join(alias, 'docs/calc/model.mjs') })).behavior).toBe('deny')
  } finally { await rm(root, { recursive: true, force: true }) }
})
test.each(['inspect', 'revise', 'verify'] as const)('%s exposes only executable role tools, not general development tools', step => {
  const names = ['Read', 'Glob', 'Grep', 'Bash', 'WebFetch', 'WebSearch', 'Write', 'Edit',
    'Agent', 'TaskOutput', 'TaskStop', 'TodoWrite', 'Skill', 'NotebookEdit', 'mcp__unrelated_tool']
  const tools = names.map(name => ({ name })) as Tool[]
  const resolved = resolveAgentTools({ tools: designReviewToolNames(step), source: 'flagSettings' }, tools)
  expect(resolved.resolvedTools.map(tool => tool.name)).toEqual(designReviewToolNames(step))
  expect(resolved.hasWildcard).toBe(false)
  expect(resolved.invalidTools).toEqual([])
})

test('review-only Bash description uses the actual bounded interface and preserves the normal executor', async () => {
  const call: Tool['call'] = async () => ({ data: 'normal-executor' })
  const bash = { name: 'Bash', call, prompt: async () => 'GENERAL DEVELOPMENT SHELL MANUAL' } as unknown as Tool
  const read = { name: 'Read' } as Tool
  const tools = designReviewTools([bash, read])
  expect(tools[0]).not.toBe(bash)
  expect(tools[0]!.call).toBe(call)
  expect(tools[0]!.apiSchemaCacheScope).toBe(DESIGN_REVIEW_AGENT)
  expect(bash.apiSchemaCacheScope).toBeUndefined()
  expect(tools[1]).toBe(read)
  const prompt = await tools[0]!.prompt({} as any)
  expect(prompt).toContain('bun .beegame/delivery/check-content.mjs')
  expect(prompt).toContain('inspect-design.mjs --visual-sample')
  expect(prompt).toContain('scripts/external requests disabled')
  expect(prompt).not.toContain('GENERAL DEVELOPMENT SHELL MANUAL')
  expect(await bash.prompt({} as any)).toBe('GENERAL DEVELOPMENT SHELL MANUAL')
})

test('native dispatch preserves parent tool objects; role interface is applied after the native worker pool rebuild', async () => {
  const ctx = executionContext()
  ctx.options.tools = [...ctx.options.tools, { name: 'Bash', prompt: async () => 'GENERAL SHELL' } as unknown as Tool]
  const execute: typeof runTools = async function* (calls, _assistants, _allow, dispatched) {
    const bash = dispatched.options.tools.find(tool => tool.name === 'Bash')!
    expect(bash).toBe(ctx.options.tools.find(tool => tool.name === 'Bash')!)
    expect(await bash.prompt({} as any)).toBe('GENERAL SHELL')
    yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: calls[0]!.id, content: 'Actual' }],
      toolUseResult: { status: 'completed', content: [{ type: 'text', text: 'Actual result' }] } }), newContext: dispatched }
  }
  await run(execute, ctx)
  expect(await ctx.options.tools.find(tool => tool.name === 'Bash')!.prompt({} as any)).toBe('GENERAL SHELL')
})

function rejection(result: Awaited<ReturnType<CanUseToolFn>>) {
  expect(result.behavior).toBe('deny')
  if (result.behavior !== 'deny') throw new Error('Expected a rejected operation')
  return result.message
}

test.each(['inspect', 'revise', 'verify'] as const)('%s explains a mistyped receipt target and accepts corrected submission without changing scope', async step => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-path-recovery-')))
  try {
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    const expected = join(workspace, '.beegame/tmp/milestone-12345678-1234-4321-a123-123456789abc.txt')
    const received = expected.replace('123456789abc', '123456789a5bc')
    const delegated: string[] = []
    const permission = designReviewPermissions({ ...turn, reviewStep: step, reviewWorkspace: workspace,
      reviewResultPath: expected, reviewReceiptContext: { ...turn.reviewReceiptContext, step } },
      (async (_tool, input) => { delegated.push(input.file_path as string); return { behavior: 'allow' } }) as CanUseToolFn, 'dispatch')
    const call = (file_path: string, content = receiptContent(step)) => permission({ name: 'Write' } as any,
      { file_path, content }, {} as any, {} as any, 'child')
    const denied = rejection(await call(received))
    expect(denied).toContain(JSON.stringify(expected))
    expect(denied).toContain('path mismatch')
    expect(denied).toContain('receipt content validated')
    expect(denied).not.toContain(receiptContent(step))
    expect(delegated).toEqual([])
    expect(await Bun.file(received).exists()).toBe(false)
    expect((await call(expected)).behavior).toBe('allow')
    expect(delegated).toEqual([expected])
    // Target correction must not waive content validation or allow aliases
    // that resolve outside the authorized receipt.
    expect(rejection(await call(expected, 'complete\n{}'))).toContain('Review receipt not saved')
    await symlink('/etc/hosts', expected)
    expect((await call(expected)).behavior).toBe('deny')
    expect((await call(join(workspace, 'outside.txt'))).behavior).toBe('deny')
    expect(delegated).toEqual([expected])
  } finally { await rm(workspace, { recursive: true, force: true }) }
})

test('checker cwd wrapper is workspace-only; denied syntax explains a working command without relaxing shell scope', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-shell-')))
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-other-')))
  try {
    const permission = designReviewPermissions({ ...turn, reviewWorkspace: workspace }, allow, 'dispatch')
    const call = (command: string) => permission({ name: 'Bash' } as any, { command }, {} as any, {} as any, 'child')
    for (const command of ['bun .beegame/delivery/check-content.mjs --design-handoff 1',
      `cd "${workspace}" && bun .beegame/delivery/check-content.mjs --design-references --author-batch 1`,
      `cd '${workspace}' && bun .beegame/delivery/check-content.mjs --help`])
      expect((await call(command)).behavior).toBe('allow')
    for (const command of [`cd "${outside}" && bun .beegame/delivery/check-content.mjs --help`,
      `cd "${workspace}" && bun .beegame/delivery/check-content.mjs --design-handoff 1; echo "EXIT: $?"`,
      `cd "${workspace}" && bun .beegame/delivery/check-content.mjs --help 2>&1 | head -60`,
      'cd "$(pwd)" && bun .beegame/delivery/check-content.mjs --help', 'true',
      'bun .beegame/delivery/check-content.mjs > docs/GDD.md']) {
      const result = await call(command)
      expect(rejection(result)).toContain('bun .beegame/delivery/check-content.mjs --help')
      expect(rejection(result)).toContain('not a tool outage')
    }
  } finally { await rm(workspace, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }) }
})

test('actual failed receipt shape is rejected before write; corrected receipt passes in the same review', async () => {
  const workspace = await realpath(await mkdtemp(join(tmpdir(), 'bgs-review-receipt-')))
  try {
    await mkdir(join(workspace, '.beegame/tmp'), { recursive: true })
    const path = join(workspace, '.beegame/tmp/result.txt')
    const permission = designReviewPermissions({ ...turn, reviewWorkspace: workspace, reviewResultPath: path }, allow, 'dispatch')
    const call = (result: any, name = 'Write') => permission({ name } as any,
      { file_path: path, content: 'complete\n' + JSON.stringify(result) }, {} as any, {} as any, 'child')
    const finding = { id: 'F1', severity: 'blocker', action: 'correct', owner: 'GDD.md', documents: ['GDD.md'],
      sources: [{ document: 'context.md', section: 'Design (details)' }], impact: 'Missing necessary rule',
      closeWhen: 'State the missing rule consistently', neededBefore: 'TECHNICAL_DESIGN.md' }
    const result = { step: 'inspect', findings: [finding], resolved: [{ id: 'R1', evidence: 'Checked scope' }] }
    expect(rejection(await call(result))).toContain('findings.0.sources.0.document')
    finding.sources[0]!.document = 'GDD.md'
    expect(rejection(await call(result))).toContain('exact Markdown heading')
    expect(rejection(await call(result))).toContain('recorded finding ID')
    finding.sources[0]!.section = 'Design'
    result.resolved = []
    expect((await call(result)).behavior).toBe('allow')
    expect((await call(result, 'Edit')).behavior).toBe('deny')
    const hooked = await resolveHookPermissionDecision({ behavior: 'allow' } as any,
      { name: 'Write' } as any, { file_path: path, content: 'complete\n{}' },
      { requireCanUseTool: true } as any, permission, {} as any, 'hooked-receipt')
    expect(hooked.decision.behavior).toBe('deny')
  } finally { await rm(workspace, { recursive: true, force: true }) }
})
function executionContext() {
  let state = { tasks: { stale: { type: 'local_agent', status: 'completed', result: {
    content: [{ type: 'text', text: 'OLD_GENERAL_REVIEW_COMPLETE' }],
  } } } } as unknown as ReturnType<ToolUseContext['getAppState']>
  return { abortController: new AbortController(), getAppState: () => state,
    setAppState: (update: (value: typeof state) => typeof state) => { state = update(state) },
    options: { tools: [{ name: 'Agent' }], agentDefinitions: {
      activeAgents: [{ agentType: DESIGN_REVIEW_AGENT }], allAgents: [],
    } },
  } as unknown as ToolUseContext
}
async function run(execute: typeof runTools, ctx = executionContext(), pause = async (_ms: number) => {}) {
  const stream = runNativeDesignReview(turn, ctx, allow, execute, pause), messages = []
  while (true) {
    const next = await stream.next()
    if (next.done) return { messages, handoffs: next.value }
    messages.push(next.value)
  }
}

test('every review directly dispatches a fresh reviewer, never substitutes a stale general review', async () => {
  const ids: string[] = []
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    expect(calls).toHaveLength(1)
    const call = calls[0]!
    ids.push(call.id)
    expect(call.input).toEqual({ subagent_type: DESIGN_REVIEW_AGENT,
      description: 'Review GDD.md',
      prompt: 'Perform the current independent Review/Revision using the original assignment at ' + turn.reviewContextPath + '.',
    })
    yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: call.id, content: 'Actual review' }],
      toolUseResult: { status: 'completed', content: [{ type: 'text', text: 'ACTUAL_REVIEW_BLOCKED: required source decision unavailable' }] } }), newContext: ctx }
  }
  const ctx = executionContext()
  for (let i = 0; i < 2; i++) {
    const result = await run(execute, ctx)
    expect(result.handoffs).toEqual(['ACTUAL_REVIEW_BLOCKED: required source decision unavailable'])
    expect(JSON.stringify(result)).not.toContain('OLD_GENERAL_REVIEW_COMPLETE')
  }
  expect(new Set(ids).size).toBe(2)
})

test('review waits on its own native worker, forwards actual result and does not poll tools', async () => {
  const ctx = executionContext()
  let executions = 0, polls = 0
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    executions++
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks,
      review: { id: 'review', type: 'local_agent', status: 'running', notified: false } as any } }))
    yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: calls[0]!.id, content: 'Launched' }],
      toolUseResult: { status: 'async_launched', agentId: 'review' } }), newContext: ctx }
  }
  const result = await run(execute, ctx, async () => {
    polls++
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks, review: {
      ...state.tasks.review, status: 'completed', result: { content: [{ type: 'text', text: 'ACTUAL_REVIEW_RESULT' }] },
    } as any } }))
  })
  expect(polls).toBe(1)
  expect(executions).toBe(1)
  expect(result.handoffs).toEqual(['ACTUAL_REVIEW_RESULT'])
})

test.each(['denied', 'failed', 'missing-receipt', 'cancelled', 'no-tool', 'no-reviewer'])(
  'review stops on %s without coordinator fallback', async reason => {
    const ctx = executionContext()
    if (reason === 'no-tool') ctx.options.tools = []
    if (reason === 'no-reviewer') ctx.options.agentDefinitions.activeAgents = []
    let executions = 0
    const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
      executions++
      if (reason === 'missing-receipt') return
      if (reason === 'cancelled') ctx.abortController.abort()
      yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: calls[0]!.id,
        content: 'Failure', is_error: reason === 'denied' }], toolUseResult: { status: reason === 'failed' ? 'failed' : 'completed' } }), newContext: ctx }
    }
    await expect(run(execute, ctx)).rejects.toThrow()
    expect(executions).toBe(reason === 'no-tool' || reason === 'no-reviewer' ? 0 : 1)
  },
)

test('foreground capped reviewer preserves the failure reason and never returns a completed handoff', async () => {
  const error = new AgentExecutionLimitError(DESIGN_REVIEW_MAX_TURNS)
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: calls[0]!.id,
      content: error.message, is_error: true }] }), newContext: ctx }
  }
  await expect(run(execute)).rejects.toThrow(error.message)
})

test('background capped reviewer stops with its native failure reason and no automatic redispatch', async () => {
  const error = new AgentExecutionLimitError(DESIGN_REVIEW_MAX_TURNS)
  let executions = 0
  const ctx = executionContext()
  const execute: typeof runTools = async function* (calls, _assistants, _allow, ctx) {
    executions++
    ctx.setAppState(state => ({ ...state, tasks: { ...state.tasks, review: {
      id: 'review', type: 'local_agent', status: 'failed', error: error.message, notified: false,
    } as any } }))
    yield { message: createUserMessage({ content: [{ type: 'tool_result', tool_use_id: calls[0]!.id, content: 'Launched' }],
      toolUseResult: { status: 'async_launched', agentId: 'review' } }), newContext: ctx }
  }
  await expect(run(execute, ctx)).rejects.toThrow(error.message)
  expect(executions).toBe(1)
})
