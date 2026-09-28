import { expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BeeGameSessionManager, type BeeGameSessionRunnerStartInput } from './session-manager'
import { sendProjectConversation, isProjectConversation } from './project-conversation'
import { beginProjectDelivery, PROJECT_DOCUMENTS, projectDeliveryStatePath, readProjectDelivery } from './project-delivery'

async function idle(manager: BeeGameSessionManager, id: string) {
  for (let i = 0; i < 500 && manager.get(id)?.turnStatus !== 'idle'; i++)
    await Bun.sleep(5)
  expect(manager.get(id)?.turnStatus).toBe('idle')
}

test('resumed implementation receives current responsive semantics without rewriting authored content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-runtime-contract-handoff-'))
  const workspace = join(root, 'project')
  let observed = false
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      const format = JSON.parse(await readFile(join(workspace, '.beegame/delivery/content-format.json'), 'utf8'))
      expect(format.uiLayoutContract.responsive).toContain('portrait')
      expect(format.runtimeConsumption.checks['ui-layout'].properties).toEqual(['layout'])
      expect(JSON.stringify(turn.prompt)).toContain('responsive requirements and authored layout conflict')
      expect(await readFile(join(workspace, 'content/ui.json'), 'utf8')).toBe('authored content unchanged')
      expect(await readFile(join(workspace, '.beegame/delivery/content-contract.json'), 'utf8')).toBe('authority snapshot unchanged')
      observed = true
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await mkdir(join(workspace, 'content'))
    await writeFile(join(workspace, 'content/ui.json'), 'authored content unchanged')
    await writeFile(join(workspace, '.beegame/delivery/content-format.json'), '{}')
    await writeFile(join(workspace, '.beegame/delivery/content-contract.json'), 'authority snapshot unchanged')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'implementation',
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'test' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Continue' })
    await idle(manager, session.id)
    expect(observed).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test.each(['continue', 'stop', 'cleanup-error', 'handoff-error'] as const)('delivery handoff waits for cleanup and honors %s', async action => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-handoff-'))
  const workspace = join(root, 'project')
  let releaseCleanup!: () => void
  let enteredCleanup!: () => void
  const cleaning = new Promise<void>(resolve => { enteredCleanup = resolve })
  const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve })
  let turns = 0
  let callbacks = 0
  let continuationError: unknown
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      turns++
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(join(workspace, 'docs'), { recursive: true })
    for (const name of PROJECT_DOCUMENTS) await writeFile(join(workspace, 'docs', name), '# Design')
    await beginProjectDelivery(workspace, root, 'Fixture delivery')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'implementation',
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Start', autoContinuation: true,
      openCapabilities: () => ({ instruction: 'Fixture', close: async () => {
        enteredCleanup(); await cleanup
        if (action === 'cleanup-error') throw new Error('Fixture cleanup failed')
      } }),
      afterTurnSettled: async progress => {
        callbacks++
        if (action === 'handoff-error') throw new Error('Fixture handoff failed')
        try {
          expect(progress).toMatchObject({ phase: 'acceptance', shouldContinue: true })
          // Use the real send guard: idle alone is insufficient if activeTurn is still retained.
          await manager.send(session.id, 'Next turn')
        } catch (error) { continuationError = error }
      },
    })
    await cleaning
    await Bun.sleep(20)
    expect(callbacks).toBe(0)
    if (action === 'stop') manager.stop(session.id)
    releaseCleanup()
    for (let i = 0; i < 100 && (action === 'continue' ? turns < 2 : manager.get(session.id)?.turnStatus !== 'idle'); i++)
      await Bun.sleep(5)
    await Bun.sleep(20)
    expect(continuationError).toBeUndefined()
    expect(callbacks).toBe(action === 'continue' || action === 'handoff-error' ? 1 : 0)
    expect(turns).toBe(action === 'continue' ? 2 : 1)
    const errors = manager.events(session.id).filter(event => event.payload?.subtype === 'delivery_error')
    expect(errors).toHaveLength(action.endsWith('error') ? 1 : 0)
    if (action.endsWith('error')) expect(errors[0]?.text).toContain(action === 'cleanup-error' ? 'Fixture cleanup failed' : 'Fixture handoff failed')
  } finally { releaseCleanup?.(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('raw project turns reuse native context; language change resumes, not a new delivery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let closed = 0
  let opened = 0
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      await turn.onMessage({ type: 'result', subtype: 'success', result: '检查完成' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const send = (message: string, language: 'zh' | 'en', clientMessageId: string) => sendProjectConversation({
      sessions: manager, sessionId: session.id, ownerId: 'owner', message,
      options: { language, clientMessageId },
      openCapabilities: () => ({ instruction: 'Optional preview tool',
        previewBaseUrl: `http://127.0.0.1:${50000 + ++opened}/private-preview`,
        close: async () => { closed++ } }),
    })
    await send('UI 有问题，先只诊断', 'zh', 'one'); await idle(manager, session.id)
    await send('只修复按钮文字', 'zh', 'two'); await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    await send('Make the player faster', 'en', 'three'); await idle(manager, session.id)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect(prompts.map(prompt => (prompt as Array<{ text: string }>).at(-1)?.text))
      .toEqual(['UI 有问题，先只诊断', '只修复按钮文字', 'Make the player faster'])
    expect(JSON.stringify(prompts)).toContain("Previous turns' temporary localhost capability URLs have expired")
    expect(JSON.stringify(prompts)).toContain('isolated muted browser and records console/network/screenshot evidence')
    expect(JSON.stringify(prompts[0])).toContain('http://127.0.0.1:50001/private-preview')
    expect(JSON.stringify(prompts[1])).toContain('http://127.0.0.1:50002/private-preview')
    expect(JSON.stringify(prompts[1])).not.toContain('http://127.0.0.1:50001/private-preview')
    expect(starts[0]?.systemContext).toContain('relevant project documents')
    expect(starts[0]?.systemContext).not.toContain('UI 有问题')
    expect(closed).toBe(3)
    expect(manager.events(session.id).filter(e => e.type === 'user.message').map(e => e.payload?.clientMessageId)).toEqual(['one', 'two', 'three'])
    expect(isProjectConversation(manager.events(session.id))).toBe(true)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('platform context precedes the natural user request in a confirmed project turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-natural-project-request-'))
  const workspace = join(root, 'project')
  let prompt: unknown
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      prompt = turn.prompt
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, '我想做一个贪吃蛇游戏')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Confirmed brief and delivery instructions',
      initialBrief: { displayText: '我想做一个贪吃蛇游戏', confirmedBriefContext: JSON.stringify({
        kind: 'confirmed_build_brief', resource_library_usage: 'optional',
        document_language: 'zh', game_user_visible_language: 'zh', agent_response_language: 'zh',
      }) } })
    await idle(manager, session.id)
    const blocks = prompt as Array<{ type: string; text: string }>
    expect(blocks[0]?.text).toContain('Confirmed brief and delivery instructions')
    expect(blocks.at(-1)?.text).toBe('我想做一个贪吃蛇游戏')
    expect(manager.events(session.id).find(event => event.type === 'user.message')?.text)
      .toBe('我想做一个贪吃蛇游戏')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('optional asset command exists only during a project turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-assets-'))
  let observed = ''
  const manager = new BeeGameSessionManager({ async start(start) {
    return { stop() {}, async submit(turn) {
      const directory = join(start.cwd, '.beegame', 'tmp', start.sessionId)
      observed = await readFile(join(directory, 'assets.mjs'), 'utf8')
      const context = await readFile(join(directory, 'context.md'), 'utf8')
      expect(context).toContain('assets.mjs help')
      expect(context).not.toContain('http://127.0.0.1:12345')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: 'Inspect resources',
      openCapabilities: () => ({ instruction: 'Optional assets', resourceTools: { libraryBaseUrl: 'http://127.0.0.1:12345' }, close: async () => {} }) })
    await idle(manager, session.id)
    expect(observed).toContain('http://127.0.0.1:12345')
    await expect(access(join(root, 'project', '.beegame', 'tmp', session.id, 'assets.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('delivery phase changes and completion preserve the native runner and stable instructions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-session-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const observedMilestones: string[] = []
  const observedPrompts: unknown[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      observedPrompts.push(turn.prompt)
      observedMilestones.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8'))
      if (observedMilestones.length === 1) {
        await mkdir(join(workspace, 'docs'), { recursive: true })
        for (const name of PROJECT_DOCUMENTS) await writeFile(join(workspace, 'docs', name), '# Game design\n')
      }
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Milestone finished' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    for (const prompt of ['Start delivery', 'Continue review', 'Prepare resources']) {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message: prompt,
        initialBrief: prompt === 'Start delivery' ? { displayText: prompt, confirmedBriefContext: JSON.stringify({
          kind: 'confirmed_build_brief', resource_library_usage: 'optional',
          document_language: 'en', game_user_visible_language: 'en', agent_response_language: 'en',
        }) } : undefined,
        autoContinuation: prompt !== 'Start delivery' })
      await idle(manager, session.id)
    }
    expect(observedMilestones.map(value => value.match(/Current delivery milestone: ([\w-]+)/)?.[1]))
      .toEqual(['author', 'review', 'resources'])
    expect(observedMilestones[0]).toContain('Current delivery milestone: author')
    expect(JSON.stringify(observedPrompts[0])).toContain('You may use available subagents for independent work when useful')
    expect(JSON.stringify(observedPrompts[1])).not.toContain('You may use available subagents for independent work when useful')
    expect(JSON.stringify(observedPrompts[2])).not.toContain('You may use available subagents for independent work when useful')
    expect(starts).toHaveLength(1)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
    const state = await readProjectDelivery(workspace, root)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'complete' }))
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
      sessionId: session.id, ownerId: 'owner', message: 'Explain the controls' })
    await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.systemContext).not.toContain('at the start of each turn')
    expect(starts[0]?.systemContext).not.toContain('within the current delivery milestone')
    expect(observedMilestones[3]).toContain('"phase": "complete"')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('same-phase automatic continuation does not repeat the full milestone handoff', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-delivery-compact-handoff-'))
  const workspace = join(root, 'project')
  const prompts: string[] = []
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(JSON.stringify(turn.prompt))
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Still authoring' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a small game')
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    const send = async (message: string, autoContinuation: boolean) => {
      await sendProjectConversation({ sessions: manager, deliveryDataRoot: root,
        sessionId: session.id, ownerId: 'owner', message, autoContinuation })
      await idle(manager, session.id)
    }
    await send('Begin', true)
    await send('Continue', true)
    await send('Please continue', false)
    expect(starts).toHaveLength(1)
    expect(starts[0]?.systemContext).not.toContain('Publishing uses current-version evidence')
    expect(prompts[0]).toContain('Write the eight implementable design documents')
    expect(prompts[1]).toContain('milestone: author')
    expect(prompts[1]).not.toContain('Write the eight implementable design documents')
    expect(prompts[2]).toContain('Write the eight implementable design documents')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('forwards the BeeGameStudio built-in Skill catalog to the native Agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-skill-runtime-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('00000000-0000-4000-8000-000000000001')
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root, () => ({
    BEEGAME_CONFIG_DIR: join(root, 'config'),
    BEEGAME_NATIVE_BUILTIN_SKILLS_DIR: join(root, 'builtinskills'),
    SKILL_SEARCH_ENABLED: '1',
  }))
  try {
    const session = manager.start({ workspacePath: join(root, 'project'),
      userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id,
      ownerId: 'owner', message: 'Design a level' })
    await idle(manager, session.id)
    expect(starts[0]?.env.BEEGAME_NATIVE_BUILTIN_SKILLS_DIR)
      .toBe(join(root, 'builtinskills'))
    expect(starts[0]?.env.SKILL_SEARCH_ENABLED).toBe('1')
    expect((await manager.projectEditCheckpointInfo(session.id)).nativeTranscriptPath)
      .toStartWith(join(root, 'config', 'projects'))
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('release interface is precise and appears only when delivery can be accepted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-release-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  const contexts: string[] = []
  const reportCheckers: string[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      contexts.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8'))
      if (prompts.length > 1)
        reportCheckers.push(await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'check-acceptance.mjs'), 'utf8'))
      await turn.onMessage({ type: 'result', subtype: 'success', result: '验收通过' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await beginProjectDelivery(workspace, root, 'Build a playable game')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: 'Explain the design', deliveryDataRoot: root })
    await idle(manager, session.id)
    expect(starts[0]?.systemContext).not.toContain('this turn must')
    expect(starts[0]?.systemContext).not.toContain('verification {')
    expect(contexts[0]).not.toContain('scope "delivery"')
    const state = await readProjectDelivery(workspace, root)
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({ ...state, phase: 'acceptance' }))
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: '验收当前版本', deliveryDataRoot: root })
    await idle(manager, session.id)
    expect(starts).toHaveLength(1)
    expect(JSON.stringify(prompts[1])).toContain('evidencePaths')
    expect(contexts[1]).toContain('environment as nonempty strings')
    expect(contexts[1]).toContain('observation:"target-runtime"|"simulation"')
    expect(contexts[1]).toContain('verification.contentChecks')
    expect(contexts[1]).toContain('report-format check')
    expect(JSON.stringify(prompts[1])).toContain('not at the report top level')
    expect(JSON.stringify(prompts[1])).toContain('report-only corrections may reuse unchanged runtime evidence')
    expect(JSON.stringify(prompts[1])).toContain('Failed or unverified bindings cannot be a delivery PASS')
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner',
      message: 'Continue acceptance', deliveryDataRoot: root, autoContinuation: true })
    await idle(manager, session.id)
    expect(JSON.stringify(prompts[2])).toContain('milestone: acceptance')
    expect(JSON.stringify(prompts[2])).toContain('verification.contentChecks')
    expect(JSON.stringify(prompts[2])).not.toContain('evidencePaths')
    expect(contexts[2]).toContain('evidencePaths')
    expect(reportCheckers).toHaveLength(2)
    await expect(access(join(workspace, '.beegame/tmp', session.id, 'check-acceptance.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
    // A natural-language PASS still must not manufacture release evidence.
    expect((await readProjectDelivery(workspace, root))?.accepted).toBeUndefined()
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('continue uses the confirmed brief in the same native session', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-blocked-'))
  const workspace = join(root, 'project')
  const starts: BeeGameSessionRunnerStartInput[] = []
  const prompts: unknown[] = []
  let handoff = ''
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    return { stop() {}, async submit(turn) {
      prompts.push(turn.prompt)
      handoff = await readFile(join(workspace, '.beegame/tmp', start.sessionId, 'context.md'), 'utf8')
      await turn.onMessage({ type: 'result', subtype: 'success', result: '已读取现有阻塞原因' })
    } }
  } }, root)
  try {
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    manager.appendUserMessage(session.id, '做一个老师批改作业的游戏', { displayKind: 'confirmed_brief' })
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '继续' })
    await idle(manager, session.id)
    expect(prompts).toEqual(['继续'])
    expect(starts[0]?.systemContext).toContain('context.md')
    expect(starts[0]?.systemContext).not.toContain('做一个老师批改作业的游戏')
    expect(handoff).toContain('做一个老师批改作业的游戏')
    expect(await Bun.file(join(workspace, '.beegame/tmp', session.id, 'context.md')).exists()).toBe(false)
    expect(manager.events(session.id).filter(e => e.type === 'user.message' && e.text === '继续')).toHaveLength(1)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('attachments survive the project entry and a transport retry does not duplicate the turn', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-images-'))
  const prompts: unknown[] = []
  const manager = new BeeGameSessionManager({ async start() { return { stop() {}, async submit(turn) {
    prompts.push(turn.prompt)
    await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
  } } } }, root)
  try {
    const session = manager.start({ workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' })
    const data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aK1cAAAAASUVORK5CYII='
    const input = { sessions: manager, sessionId: session.id, ownerId: 'owner', message: '修复截图中的问题',
      options: { clientMessageId: 'picture-request', attachments: [{ type: 'image' as const, filename: 'bug.png', mediaType: 'image/png' as const, data }] } }
    await sendProjectConversation(input); await idle(manager, session.id)
    await sendProjectConversation(input)
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toMatchObject([{ type: 'text', text: input.message }, { type: 'image', source: { data } }])
    expect(manager.events(session.id).filter(e => e.type === 'user.message')[0]?.payload?.attachments).toHaveLength(1)
    await expect(sendProjectConversation({ ...input, message: '另外的问题' })).rejects.toThrow('another request')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('restart restores the native UUID and request identity without delivery recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-resume-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runner = { async start(start: BeeGameSessionRunnerStartInput) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn: Parameters<import('./session-manager').BeeGameSessionRuntime['submit']>[0]) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }
  let manager = new BeeGameSessionManager(runner, root)
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, sessionId: session.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    await idle(manager, session.id); await manager.dispose()
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({ ...base, transcriptSessionId: session.id })
    expect(isProjectConversation(manager.transcript(restored.id))).toBe(true)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '只检查UI', options: { clientMessageId: 'before-restart' } })
    expect(starts).toHaveLength(1)
    await sendProjectConversation({ sessions: manager, sessionId: restored.id, ownerId: 'owner', message: '继续' })
    await idle(manager, restored.id)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a user message resumes an interrupted delivery milestone after restart without repeating it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-interrupted-delivery-resume-'))
  const workspace = join(root, 'project')
  const base = { workspacePath: workspace, userId: 'owner', projectId: 'project' }
  let interrupted = true
  const starts: BeeGameSessionRunnerStartInput[] = []
  const runner = { async start(start: BeeGameSessionRunnerStartInput) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn: Parameters<import('./session-manager').BeeGameSessionRuntime['submit']>[0]) {
      if (interrupted) throw new Error('Fixture: previous server process exited mid-turn')
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Review finished' })
    } }
  } }
  let manager = new BeeGameSessionManager(runner, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'review',
    }))
    const session = manager.start(base)
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'Review the documents', autoContinuation: true })
    await idle(manager, session.id)
    expect(manager.transcript(session.id).findLast(event => event.type === 'turn.failed')).toBeTruthy()
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('review')

    await manager.dispose()
    interrupted = false
    manager = new BeeGameSessionManager(runner, root)
    const restored = manager.start({ ...base, transcriptSessionId: session.id })
    expect(restored.id).toBe(session.id)
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: restored.id,
      ownerId: 'owner', message: '继续' })
    await idle(manager, restored.id)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('resources')
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
    expect(manager.transcript(restored.id).filter(event => event.type === 'user.message').at(-1)?.text).toBe('继续')
    expect(manager.transcript(restored.id).filter(event => event.type === 'turn.completed')).toHaveLength(1)
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('an ordinary user answer during review does not advance an uninterrupted milestone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-review-user-answer-'))
  const workspace = join(root, 'project')
  const manager = new BeeGameSessionManager({ async start() {
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Answered the question' })
    } }
  } }, root)
  try {
    await mkdir(workspace)
    await beginProjectDelivery(workspace, root, 'Build a game')
    await writeFile(projectDeliveryStatePath(workspace, root), JSON.stringify({
      ...(await readProjectDelivery(workspace, root)), phase: 'review',
    }))
    const session = manager.start({ workspacePath: workspace, userId: 'owner', projectId: 'project' })
    await sendProjectConversation({ sessions: manager, deliveryDataRoot: root, sessionId: session.id,
      ownerId: 'owner', message: 'What is being reviewed?' })
    await idle(manager, session.id)
    expect((await readProjectDelivery(workspace, root))?.phase).toBe('review')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stopping and continuing reuses the same project session and native context', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-stop-resume-'))
  const starts: BeeGameSessionRunnerStartInput[] = []
  const manager = new BeeGameSessionManager({ async start(start) {
    starts.push(start)
    start.onNativeSessionId?.('a28f9e61-96d5-4e38-981b-5acd25076508')
    return { stop() {}, async submit(turn) {
      await turn.onMessage({ type: 'result', subtype: 'success', result: 'Done' })
    } }
  } }, root)
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const original = manager.start(base)
    await sendProjectConversation({ sessions: manager, sessionId: original.id, ownerId: 'owner', message: '先检查UI' })
    await idle(manager, original.id)
    manager.stop(original.id)
    await manager.waitForSessionIdle(original.id)
    const resumed = manager.start({ ...base, transcriptSessionId: original.id })
    expect(resumed.id).toBe(original.id)
    expect(isProjectConversation(manager.transcript(resumed.id))).toBe(true)
    await sendProjectConversation({ sessions: manager, sessionId: resumed.id, ownerId: 'owner', message: '继续修复' })
    await idle(manager, resumed.id)
    expect(starts).toHaveLength(2)
    expect(starts[1]?.sessionId).toBe(original.id)
    expect(starts[1]?.resumeSessionId).toBe('a28f9e61-96d5-4e38-981b-5acd25076508')
  } finally { await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('stop during preparation closes capabilities and does not launch a model or publish a user message', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-conversation-stop-'))
  const manager = new BeeGameSessionManager({ async start() { throw new Error('Must not launch') } }, root)
  let release!: () => void
  const preparing = new Promise<void>(resolve => { release = resolve })
  let closed = 0
  try {
    const base = { workspacePath: join(root, 'project'), userId: 'owner', projectId: 'project' }
    const session = manager.start(base)
    const sent = manager.sendWithDisplay(session.id, '修复', { prepareTurn: async () => {
      await preparing
      return { close: async () => { closed++ } }
    } })
    manager.stop(session.id)
    expect(() => manager.start({ ...base, transcriptSessionId: session.id })).toThrow('still stopping')
    release()
    await expect(sent).rejects.toThrow('stopped during turn preparation')
    expect(closed).toBe(1)
    expect(manager.events(session.id).filter(e => e.type === 'user.message')).toHaveLength(0)
    expect(manager.get(session.id)?.turnStatus).toBe('idle')
  } finally { release(); await manager.dispose(); await rm(root, { recursive: true, force: true }) }
})
