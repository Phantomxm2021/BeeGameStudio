import { expect, test } from 'bun:test'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { createAgentWorkflowApp } from '../app'
import { createLocalWorkflowStore } from '../beegame/workflow-v3/store'
import { discussionMessagesSinceMeasurement } from '../beegame/workflow-v3/measured-build'
import type { AgentMeasurement } from '../beegame/workflow-v3/state'

test.each([false, true])('formal project bootstrap starts the same V3 native goal with an initial reference: %s', async withReference => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-formal-v3-bootstrap-'))
  const store = createLocalWorkflowStore(join(root, 'workflow-store'))
  const cleanups: Array<() => void | Promise<void>> = []
  const prompts: string[] = [], systemContexts: string[] = [], workspaces: string[] = []
  const app = createAgentWorkflowApp({ currentUser: { id: 'owner', role: 'owner' },
    dashboardDataRoot: join(root, 'dashboard'), defaultWorkspacePath: join(root, 'projects'),
    workflowV3Store: store, modelConfigStore: false, skillsConfig: false,
    sessionRunner: { async start(input) {
      systemContexts.push(input.systemContext ?? '')
      workspaces.push(input.cwd)
      const nativeId = input.resumeSessionId ?? '11111111-2222-4333-8444-555555555555'
      input.onNativeSessionId?.(nativeId)
      return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
      await turn.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType: 'assistant.message', text: 'Synthetic goal ended' })
    } } } }, registerCleanup: cleanup => cleanups.push(cleanup) })
  try {
    const model = await app.request('/api/model-configs', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Offline', provider: 'openai-compatible', apiKey: 'fake',
        model: 'fake', isDefault: true }) })
    expect(model.status).toBe(200)
    const response = await app.request('/api/projects/bootstrap', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        project: { id: 'formal-game', name: 'New game', created_at: Date.now() },
        brief: { idea: 'Make a small game', option: { title: 'Selected game' },
          settings: { orientation: 'Landscape', resourceLibraryUsage: 'optional' },
          ...(withReference ? { attachments: [{ type: 'file', filename: 'brief.txt', mediaType: 'text/plain',
            data: Buffer.from('Synthetic reference only').toString('base64') }] } : {}),
          documentLanguage: 'en', gameUserVisibleLanguage: 'en', agentResponseLanguage: 'en' },
      }) })
    expect(response.status, await response.clone().text()).toBe(202)
    const body = await response.json() as { session: { id: string }; project: { root_path: string } }
    for (let i = 0; i < 100 && prompts.length === 0; i++) await Bun.sleep(5)
    expect(prompts).toHaveLength(1)
    // Bootstrap starts the confirmed goal, not a planning-only first turn.
    expect(prompts[0]).toContain('Stop at the requested boundary')
    expect(prompts[0]).not.toContain('$game-creative-director-expert')
    const workspace = await realpath(body.project.root_path)
    expect(workspaces).toEqual([workspace])
    if (withReference) {
      const attachments = await readdir(join(workspace, '.beegame-attachments'))
      expect(attachments).toHaveLength(1)
      expect(await readFile(join(workspace, '.beegame-attachments', attachments[0]!), 'utf8')).toBe('Synthetic reference only')
    }
    const guide = await readFile(join(workspace, 'AGENTS.md'))
    // Native BGS loads the saved guide from cwd. Host context carries its
    // identity and the current tool contract, not a duplicate guide body.
    expect(guide.toString('utf8')).toContain('machine indexes and task coverage graphs are not required')
    expect(guide.toString('utf8')).toContain('The current user assignment determines deliverables and stopping point')
    expect(guide.toString('utf8')).toContain('Select and read applicable Skills')
    expect(systemContexts[0]).toContain('Project working conventions and navigation: AGENTS.md (SHA-256 ' +
      createHash('sha256').update(guide).digest('hex') + ', ' + guide.byteLength + ' bytes).')
    expect(systemContexts[0]).toContain('Bgs loads applicable AGENTS.md instructions natively')
    expect(systemContexts[0]).not.toContain(guide.toString('utf8'))
    expect(systemContexts[0]).toContain('Plain documents need no index or finalization')
    expect(systemContexts.join('\n')).toContain('no redundant per-image approval, unknown paid replay or automatic paid retry')
    expect(prompts[0]).not.toContain('first assignment ends at visual-direction handoff')
    expect(prompts[0]).not.toContain('current milestone and its deliverables')
    const run = await store.read('formal-game', 'owner')
    expect(run?.chatSessionId).toBe(body.session.id)
    expect(run?.agentTurns).toHaveLength(1)
    for (const obsolete of ['confirmed-brief', 'continue', 'action']) {
      expect((await app.request(`/api/beegame-sessions/${body.session.id}/${obsolete}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
      })).status).toBe(404)
    }
    expect(JSON.parse(run!.requirements.text)).toMatchObject({ idea: 'Make a small game',
      selected_option: { title: 'Selected game' }, resource_library_usage: 'optional' })
    expect(existsSync(join(root, 'dashboard', 'project-delivery'))).toBe(false)
    for (let i = 0; i < 100 && !(await store.read('formal-game', 'owner'))?.agentTurns?.[0]?.finishedAt; i++) await Bun.sleep(5)
    const settled = (await store.read('formal-game', 'owner'))!
    const followup = await app.request('/api/projects/formal-game/workflow-v3/agent/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        requestKey: 'plain-chat-1', runId: settled.id, chatSessionId: settled.chatSessionId,
        expectedVersion: settled.version, requirementsRevision: settled.requirements.revision,
        text: 'Why is the game difficult?',
      }),
    })
    expect(followup.status, await followup.clone().text()).toBe(202)
    for (let i = 0; i < 100 && prompts.length < 2; i++) await Bun.sleep(5)
    expect(prompts[1]).toContain('Why is the game difficult?')
    for (let i = 0; i < 100 && !(await store.read('formal-game', 'owner'))?.agentTurns?.[1]?.quiescedAt; i++) await Bun.sleep(5)
    const afterChat = (await store.read('formal-game', 'owner'))!
    expect(afterChat.agentTurns?.[1]).toMatchObject({ status: 'ended', message: { intent: 'message' } })
    expect(discussionMessagesSinceMeasurement(afterChat,
      { requirementsRevision: settled.requirements.revision } as AgentMeasurement))
      .toEqual([{ requestKey: 'plain-chat-1', text: 'Why is the game difficult?' }])
    expect(existsSync(join(root, 'dashboard', 'project-delivery'))).toBe(false)
  } finally {
    for (const cleanup of cleanups.reverse()) await cleanup()
    await rm(root, { recursive: true, force: true })
  }
})
