import { createInterface } from 'node:readline'
const send = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n')
const waiting = new Map<string, (value: any) => void>()
const threadId = '019a0000-0000-7000-8000-000000000002'
let reasoning: unknown
let sequence = 0
async function ask(method: string, params: unknown) {
  const id = 'approval-' + ++sequence
  return new Promise<any>(resolve => { waiting.set(id, resolve); send({ id, method, params }) })
}
createInterface({ input: process.stdin }).on('line', async line => {
  const request = JSON.parse(line), p = request.params || {}
  if (!request.method) { waiting.get(request.id)?.(request.result); waiting.delete(request.id); return }
  const reply = (result: unknown) => send({ id: request.id, result })
  if (request.method === 'initialize') reply({})
  else if (request.method === 'initialized') return
  else if (request.method === 'config/read') reply({ config: { model_reasoning_effort: null } })
  else if (request.method === 'model/list') reply({ data: [{ model: 'fixture-model', isDefault: true, defaultReasoningEffort: 'low',
    supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'high' }] }] })
  else if (request.method === 'thread/start' || request.method === 'thread/resume') { reasoning = p.config?.model_reasoning_effort; reply({ thread: { id: threadId } }) }
  else if (request.method === 'skills/extraRoots/set') reply({})
  else if (request.method === 'skills/list') reply({ data: [{ skills: [], errors: [] }] })
  else if (request.method === 'turn/start') {
    const turnId = 'turn-' + ++sequence
    reply({ turn: { id: turnId } })
    const event = (method: string, params: any) => send({ method, params: { threadId, turnId, ...params } })
    const prompt = p.input[0].text
    let answer: any = reasoning ?? 'default'
    if (prompt === 'search') {
      event('item/started', { item: { id: 'search', type: 'webSearch', query: '', action: null } })
      event('item/completed', { item: { id: 'search', type: 'webSearch', query: 'Phaser official release', action: { type: 'search', query: 'Phaser official release' },
        results: [{ title: 'Phaser releases', url: 'https://github.com/phaserjs/phaser/releases', snippet: 'Official releases' }] } })
    } else if (prompt === 'command' || prompt === 'wait-command') {
      answer = await ask('item/commandExecution/requestApproval', { threadId, turnId, itemId: 'command', command: 'fetch game docs', cwd: process.cwd(),
        networkApprovalContext: { host: 'phaser.io', protocol: 'https' }, availableDecisions: ['accept', 'decline', 'cancel'] })
    } else if (prompt === 'file' || prompt.startsWith('file-')) {
      const path = prompt === 'file-protected' ? 'AGENTS.md' : prompt === 'file-outside' ? '../outside.ts'
        : prompt === 'file-alias' ? 'alias/game.ts' : 'game.ts'
      const kind = prompt === 'file-move-outside' ? { type: 'update', move_path: '../outside.ts' } : { type: 'add' }
      if (prompt !== 'file-missing') event('item/started', { item: { id: 'file', type: 'fileChange', changes: [{ path, kind, diff: 'game code' }] } })
      answer = await ask('item/fileChange/requestApproval', { threadId, turnId, itemId: 'file',
        ...(prompt === 'file-grant-root' ? { grantRoot: process.cwd() } : {}) })
    } else if (prompt === 'mcp' || prompt === 'mcp-url') {
      answer = await ask('mcpServer/elicitation/request', { threadId, turnId, serverName: 'fixture-mcp',
        ...(prompt === 'mcp-url' ? { mode: 'url', url: 'https://example.org/authorize', message: 'Authorize this MCP' }
          : { mode: 'form', message: 'Choose settings', requestedSchema: { type: 'object', properties: { count: { type: 'integer' }, enabled: { type: 'boolean' } }, required: ['count', 'enabled'] } }) })
    }
    event('item/completed', { item: { id: 'answer', type: 'agentMessage', text: JSON.stringify(answer) } })
    event('turn/completed', { turn: { id: turnId, status: 'completed' } })
  } else reply({})
})
