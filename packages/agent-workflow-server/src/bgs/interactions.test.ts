import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bgsApproval, canGrantPath, elicitationAnswer } from './interactions'
import { createBgsRunner } from './runner'
import { BeeGameSessionManager } from '../beegame/session-manager'
import { reasoningConnectionKey, saveReasoningPreference } from './preferences-store'

const command = [process.execPath, fileURLToPath(new URL('./fixtures/interactions-app-server.ts', import.meta.url))]
test('scoped approvals respect protected children, external paths, symlinks, denial and cancellation', async () => {
  const root = await mkdtemp('/private/tmp/bgs-approval-'), game = join(root, 'game')
  await mkdir(game); await writeFile(join(root, 'secret'), 'private'); await symlink(root, join(game, 'alias'))
  let active = true, asked = 0
  const context = { root: game, filesystem: { [game]: 'write', [join(game, 'AGENTS.md')]: 'read' }, networkEnabled: true, items: new Map(), current: () => active,
    permission: async () => { asked++; return { behavior: 'allow' as const } } }
  try {
    expect(canGrantPath(context, join(game, 'game.ts'), true)).toBe(true)
    for (const path of [game, join(game, 'AGENTS.md'), join(root, 'secret'), join(game, 'alias/secret')])
      expect(canGrantPath(context, path, true)).toBe(false)
    const method = 'item/commandExecution/requestApproval', p = { itemId: 'shell', command: 'fetch docs', cwd: game, networkApprovalContext: { host: 'example.org' } }
    expect(await bgsApproval(method, p, context)).toEqual({ decision: 'accept' })
    expect(await bgsApproval(method, { ...p, networkApprovalContext: null }, context)).toEqual({ decision: 'decline' })
    expect(await bgsApproval(method, { ...p, networkApprovalContext: null, additionalPermissions: {} }, context)).toEqual({ decision: 'decline' })
    expect(asked).toBe(1)
    expect(await bgsApproval(method, p, { ...context, networkEnabled: false })).toEqual({ decision: 'decline' })
    expect(await bgsApproval(method, p, { ...context, permission: async () => ({ behavior: 'deny' }) })).toEqual({ decision: 'decline' })
    expect(await bgsApproval(method, p, { ...context, permission: async () => { active = false; return { behavior: 'allow' } } })).toEqual({ decision: 'cancel' })
    active = true
    expect(await bgsApproval('item/permissions/requestApproval', { itemId: 'permissions', permissions: { fileSystem: { read: [join(root, 'secret')] } } }, context)).toEqual({ permissions: {}, scope: 'turn' })
    context.items.set('file', { changes: [{ path: 'game.ts', kind: { type: 'update', move_path: '../secret' } }] })
    expect(await bgsApproval('item/fileChange/requestApproval', { itemId: 'file' }, context)).toEqual({ decision: 'decline' })
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('MCP responses keep false and zero, and validate against the original requested schema', () => {
  const input = { mode: 'form', requestedSchema: { type: 'object', properties: { count: { type: 'integer', minimum: 0 }, enabled: { type: 'boolean' } }, required: ['count', 'enabled'] } }
  expect(elicitationAnswer(input, { content: '{"count":0,"enabled":false}' }).content).toEqual({ count: 0, enabled: false })
  for (const content of ['{}', '{"count":"0","enabled":true}', '{"count":-1,"enabled":true}'])
    expect(() => elicitationAnswer(input, { content })).toThrow()
})

test('runner forwards reasoning, search sources, native approvals and typed MCP answers through BGS', async () => {
  const root = await mkdtemp('/private/tmp/bgs-interactions-')
  const env = { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_MODEL: 'fixture-model' }
  saveReasoningPreference(env, reasoningConnectionKey(env, 'fixture-model'), 'high')
  try {
    for (const prompt of ['reasoning', 'search', 'command', 'file', 'mcp', 'mcp-url', 'default']) {
      if (prompt === 'default') saveReasoningPreference(env, reasoningConnectionKey(env, 'fixture-model'), null)
      const game = join(root, prompt); await mkdir(game)
      const events: any[] = [], requests: any[] = []
      const runtime = await createBgsRunner({ command }).start({ sessionId: prompt, cwd: game, env,
        requestPermission: async request => { requests.push(request); return { behavior: 'allow', updatedInput: { content: { count: 0, enabled: false } } } } })
      try {
        await runtime.submit({ prompt, signal: AbortSignal.timeout(10000), onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
        const text = events.filter(event => event.eventType === 'assistant.message').map(event => event.text).join('')
        if (prompt === 'reasoning') expect(text).toBe('"high"')
        if (prompt === 'default') expect(text).toBe('"low"')
        if (prompt === 'search') {
          const result = events.find(event => event.eventType === 'tool.completed' && event.toolName === 'webSearch')
          expect(result.input.query).toBe('Phaser official release')
          expect(result.results).toHaveLength(1)
          expect(result.output).toContain('https://github.com/phaserjs/phaser/releases')
        }
        if (['command', 'file'].includes(prompt)) { expect(JSON.parse(text).decision, 'approval case: '+prompt).toBe('accept'); expect(requests).toHaveLength(1) }
        if (prompt === 'mcp') expect(JSON.parse(text)).toEqual({ action: 'accept', content: { count: 0, enabled: false } })
        if (prompt === 'mcp-url') expect(JSON.parse(text)).toEqual({ action: 'accept', content: null })
      } finally { await runtime.dispose?.() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 30000)

test('runner file approval uses the actual change inventory and retains host and user boundaries', async () => {
  const root = await mkdtemp('/private/tmp/bgs-file-approval-')
  try {
    const cases = [
      { prompt: 'file', allow: true, decision: 'accept', asked: 1 },
      { prompt: 'file', allow: false, decision: 'decline', asked: 1 },
      ...['file-protected', 'file-outside', 'file-alias', 'file-move-outside', 'file-grant-root', 'file-missing']
        .map(prompt => ({ prompt, allow: true, decision: 'decline', asked: 0 })),
    ]
    for (const [index, sample] of cases.entries()) {
      const game = join(root, 'case-'+index); await mkdir(game); await symlink(root, join(game, 'alias'))
      const events: any[] = [], requests: any[] = []
      const runtime = await createBgsRunner({ command }).start({ sessionId: 'case-'+index, cwd: game,
        env: { BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_AUTH_MODE: 'chatgpt', BEEGAME_MODEL: 'fixture-model' },
        requestPermission: async request => { requests.push(request); return { behavior: sample.allow ? 'allow' : 'deny' } } })
      try {
        await runtime.submit({ prompt: sample.prompt, signal: AbortSignal.timeout(5000),
          onMessage: value => { events.push(value) }, requestPermission: async () => ({ behavior: 'deny' }) })
        const answer = events.filter(e => e.eventType === 'assistant.message').map(e => e.text).join('')
        expect(JSON.parse(answer).decision, sample.prompt).toBe(sample.decision)
        expect(requests, sample.prompt).toHaveLength(sample.asked)
        if (sample.asked) expect(requests[0].input.changes).toEqual([{ path: 'game.ts', kind: { type: 'add' }, diff: 'game code' }])
      } finally { await runtime.dispose?.() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15000)

test('BGS pending MCP form validates before consuming the gate and resumes after a valid answer', async () => {
  const root = await mkdtemp('/private/tmp/bgs-mcp-gate-')
  const manager = new BeeGameSessionManager(createBgsRunner({ command }), root,
    () => ({ BEEGAME_CONFIG_DIR: join(root, 'config'), OPENAI_AUTH_MODE: 'chatgpt' }))
  try {
    const session = manager.start({ workspacePath: join(root, 'game'), userId: 'owner', projectId: 'project' })
    await manager.sendWithDisplay(session.id, 'mcp')
    let gate: any
    for (let i = 0; i < 100; i++) {
      gate = manager.pendingPermissionsForProject('owner', 'project', join(root, 'game'))[0]
      if (gate) break
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    expect(gate?.toolName).toBe('McpElicitation')
    expect(() => manager.resolvePermission(session.id, gate.toolUseID, { behavior: 'allow', answers: { content: '{}' } })).toThrow()
    manager.resolvePermission(session.id, gate.toolUseID, { behavior: 'allow', answers: { content: '{"count":0,"enabled":false}' } })
    await manager.waitForSessionIdle(session.id)
    expect(manager.transcriptFacts(session.id).some(event => event.type === 'assistant.message' && event.text.includes('"enabled":false'))).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
}, 15000)
