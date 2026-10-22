import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAgentWorkflowApp } from '../app'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import type { BeeGameUserContext } from '../auth/user-context'
import { createRun } from '../beegame/workflow-v3/state'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'bgs-clone-'))
  const workspace = join(root, 'projects', 'users', 'owner', 'original')
  await mkdir(workspace, { recursive: true })
  const store = createLocalWorkflowStore(join(root, 'workflow'))
  const cleanups: Array<() => void | Promise<void>> = []
  const submissions: string[] = [], starts: unknown[] = []
  const user: BeeGameUserContext = {id: 'owner', role: 'owner'}
  const app = createAgentWorkflowApp({ currentUser: user,
    defaultWorkspacePath: join(root, 'projects'), dashboardDataRoot: join(root, 'dashboard'),
    workflowV3Store: store, modelConfigStore: false, skillsConfig: false,
    registerCleanup: f => cleanups.push(f), sessionRunner: { async start(input) {
      starts.push(input)
      const nativeId = '11111111-2222-4333-8444-555555555555'
      input.onNativeSessionId?.(nativeId)
      return { stop() {}, async submit(turn) {
        submissions.push(JSON.stringify(turn.prompt))
        await turn.onMessage({ type: 'result', subtype: 'success', session_id: nativeId, result: 'Local simulation' })
      } }
    } },
  })
  const post = (url: string, body: unknown = {}) => app.request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  await post('/api/model-configs', { name: 'Offline', provider: 'openai-compatible', apiKey: 'fake', models: { balanced: 'fake' }, isDefault: true })
  expect((await post('/api/projects', { id: 'source', name: 'Original', root_path: workspace, created_at: 1 })).status).toBe(200)
  const brief = { kind: 'confirmed_build_brief', idea: 'Existing game', selected_option: {title: 'Selected'},
    settings: {engine: 'Godot', platform: 'Desktop', orientation: 'Landscape'},
    document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en', resource_library_usage: 'optional',
    user_messages: [{text: 'OLD TASK DO NOT REPLAY'}] }
  const source = createRun({ projectId: 'source', ownerId: 'owner', workspacePath: workspace,
    chatSessionId: 'old-chat', requestKey: 'source', text: JSON.stringify(brief), constraints: brief.settings, ids: ['goal'] })
  source.status = 'blocked'
  // Deliberately no corresponding Chat files: cloning a restored project must not resume its old history.
  source.agentTurns = [{ attemptId: 'old-attempt', requestKey: 'old-task', sessionId: 'old-chat', workerId: 'old-worker',
    fence: 1, status: 'ended', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
    quiescedAt: new Date().toISOString(), nativeRuntime: 'bgs', nativeSessionId: 'old-native', usage: {total_tokens: 9000000} }]
  await store.commit('source', 'owner', 0, source, 'agent.goal-confirmed')
  for (const [path, text] of Object.entries({'docs/GDD.md': '# Existing GDD', 'assets/sprite.png': 'fixture bytes',
    'content/ui/menu.json': '{}', 'game.gd': '# Godot source', 'project.godot': 'config_version=5',
    '.beegame-attachments/ref.png': 'reference', '.env': 'SECRET', '.env.example': 'KEY=',
    '.beegame/delivery/acceptance.json': 'old-acceptance', 'transcripts/old.jsonl': 'old-chat',
    'node_modules/package/index.js': 'dependency', '.git/config': 'old repo', '.runtime/state.json': 'old state'})) {
    await mkdir(join(workspace, path, '..'), {recursive: true})
    await writeFile(join(workspace, path), text)
  }
  return { app, post, root, workspace, store, source, starts, submissions, user,
    async close() { for (const f of cleanups.reverse()) await f(); await rm(root, {recursive: true, force: true}) } }
}

test('clone copies authored files and settings, starts no model, then accepts a new task in an independent conversation', async () => {
  const f = await fixture()
  try {
    const response = await f.post('/api/projects/source/clone', {language: 'zh'})
    expect(response.status, await response.clone().text()).toBe(201)
    const project = await response.json() as {id: string; name: string; root_path: string}
    expect(project.name).toBe('Original 副本')
    expect(project.id).not.toBe('source')
    expect(project.root_path).not.toBe(f.workspace)
    for (const path of ['docs/GDD.md', 'assets/sprite.png', 'content/ui/menu.json', 'game.gd', 'project.godot', '.beegame-attachments/ref.png', '.env.example'])
      expect(await readFile(join(project.root_path, path), 'utf8')).toBe(await readFile(join(f.workspace, path), 'utf8'))
    const copiedEntries = await readdir(project.root_path)
    for (const path of ['.env', 'node_modules', '.git', '.runtime']) expect(copiedEntries).not.toContain(path)
    expect(await Bun.file(join(project.root_path, '.beegame/delivery/acceptance.json')).exists()).toBe(false)
    expect(await Bun.file(join(project.root_path, 'transcripts/old.jsonl')).exists()).toBe(false)
    const run = (await f.store.read(project.id, 'owner'))!
    expect(run.agentTurns).toEqual([])
    expect(run.chatSessionId).not.toBe('old-chat')
    expect(run.deliveryEligible).toBe(false)
    expect(run.designBaseline).toBeUndefined()
    expect(run.creation).toBeUndefined()
    expect(run.requirements.constraints).toEqual(f.source.requirements.constraints)
    expect(run.requirements.text).not.toContain('OLD TASK')
    expect(JSON.parse(run.requirements.text).project_source).toEqual({type: 'clone', source_project_id: 'source',
      source_project_name: 'Original', conversation_history: 'not_copied', execution_state: 'not_inherited', quality: 'unverified'})
    expect(f.starts).toHaveLength(0)
    expect(f.submissions).toHaveLength(0)
    expect(await f.store.read('source', 'owner')).toEqual(f.source)
    const open = await f.post(`/api/projects/${project.id}/session/ensure`)
    expect(open.status, await open.clone().text()).toBe(200)
    expect(f.starts).toHaveLength(0)
    const message = {requestKey: 'new-task', runId: run.id, chatSessionId: run.chatSessionId,
      expectedVersion: run.version, requirementsRevision: run.requirements.revision, text: 'Inspect existing documents only.'}
    const resume = await f.post(`/api/projects/${project.id}/workflow-v3/agent/messages`, {...message, intent: 'continue', continuationOf: 'old-attempt'})
    expect(resume.status).toBe(400)
    const send = await f.post(`/api/projects/${project.id}/workflow-v3/agent/messages`, message)
    expect(send.status, await send.clone().text()).toBe(202)
    for (let i = 0; i < 100 && !(await f.store.read(project.id, 'owner'))?.agentTurns?.[0]?.finishedAt; i++) await Bun.sleep(10)
    expect(f.submissions).toHaveLength(1)
    expect(f.submissions[0]).toContain('Inspect existing documents only.')
    expect(f.submissions[0]).not.toContain('OLD TASK')
    const transcriptFiles = await readdir(join(project.root_path, 'transcripts'))
    const transcript = await readFile(join(project.root_path, 'transcripts', transcriptFiles.find(name => name.endsWith('.jsonl'))!), 'utf8')
    const userEvent = transcript.split('\n').filter(Boolean).map(line => JSON.parse(line)).find(event => event.type === 'user.message')
    expect(JSON.parse(userEvent.payload.confirmedBriefContext).project_source).toMatchObject({type: 'clone', conversation_history: 'not_copied'})
    expect((f.starts[0] as {resumeSessionId?: string}).resumeSessionId).toBeUndefined()
    expect(await readFile(join(project.root_path, 'docs/GDD.md'), 'utf8')).toBe('# Existing GDD')
  } finally { await f.close() }
})

test('clone refuses an unresolved writer and unknown project without creating a copy', async () => {
  const f = await fixture()
  try {
    const next = structuredClone(f.source)
    next.version++; next.writer = {attemptId: 'old-attempt', workerId: 'old-worker', fence: 1}
    await f.store.commit('source', 'owner', 1, next, 'test.writer')
    expect((await f.post('/api/projects/source/clone')).status).toBe(409)
    expect((await f.post('/api/projects/unknown/clone')).status).toBe(404)
    expect((await (await f.app.request('/api/projects')).json()).length).toBe(1)
    expect(f.starts).toHaveLength(0)
  } finally { await f.close() }
})

test('clone rejects links instead of copying external files and removes the incomplete directory', async () => {
  const f = await fixture()
  try {
    await symlink(join(f.root, 'dashboard'), join(f.workspace, 'external'))
    const result = await f.post('/api/projects/source/clone')
    expect(result.status, await result.clone().text()).toBe(409)
    expect((await (await f.app.request('/api/projects')).json()).length).toBe(1)
    expect(await readdir(join(f.workspace, '..'))).toEqual(['original'])
    expect(f.starts).toHaveLength(0)
  } finally { await f.close() }
})


test('clone checks create permission and owner-scoped source lookup', async () => {
  const f = await fixture()
  try {
    f.user.role = 'viewer'
    expect((await f.post('/api/projects/source/clone')).status).toBe(403)
    f.user.role = 'owner'; f.user.id = 'another-owner'
    expect((await f.post('/api/projects/source/clone')).status).toBe(404)
    expect(f.starts).toHaveLength(0)
  } finally { await f.close() }
})

test('a failed workflow save cleans up the new project and directory, preserving the source', async () => {
  const f = await fixture()
  try {
    const commit = f.store.commit.bind(f.store)
    f.store.commit = async (...args) => {
      if (args[0] !== 'source') throw new Error('Synthetic storage failure')
      return commit(...args)
    }
    const result = await f.post('/api/projects/source/clone')
    expect(result.status).toBeGreaterThanOrEqual(400)
    expect((await (await f.app.request('/api/projects')).json()).length).toBe(1)
    expect(await readdir(join(f.workspace, '..'))).toEqual(['original'])
    expect(await f.store.read('source', 'owner')).toEqual(f.source)
    expect(f.starts).toHaveLength(0)
  } finally { await f.close() }
})
