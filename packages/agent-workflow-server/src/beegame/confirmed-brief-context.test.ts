import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfirmedBriefContext } from './confirmed-brief-context'
import { BeeGameSessionManager, recoverLatestProjectSessionFromDisk, type BeeGameSessionRunner } from './session-manager'

const brief = {
  kind: 'confirmed_build_brief',
  resource_library_usage: 'preferred',
  document_language: 'zh',
  game_user_visible_language: 'zh',
  agent_response_language: 'zh',
}

test('accepts canonical confirmed policy and language facts', () => {
  expect(() => validateConfirmedBriefContext(JSON.stringify(brief))).not.toThrow()
})

test.each([
  ['{', 'valid JSON'],
  [JSON.stringify({ kind: 'summary' }), 'invalid kind'],
  [JSON.stringify({ ...brief, resource_library_usage: undefined }), 'invalid resource_library_usage'],
  [JSON.stringify({ ...brief, agent_response_language: undefined }), 'explicit response, document, and player-visible languages'],
])('retains confirmed-context validation for %s', (context, message) => {
  expect(() => validateConfirmedBriefContext(context)).toThrow(message)
})

test.each(['confirmed_brief', 'workflow_v3_goal', 'workflow_v3_change', 'workflow_v3_production'])('new and resumed turns retain %s context without replacing independent evidence', async displayKind => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-confirmed-context-'))
  const contexts: Array<string | undefined> = []
  const startContexts: Array<string | undefined> = []
  const runner: BeeGameSessionRunner = { async start(input) { startContexts.push(input.confirmedBriefContext); return {
    reusable: false, stop() {}, async submit(input) { contexts.push(input.confirmedBriefContext) },
  } } }
  const first = new BeeGameSessionManager(runner, root, () => ({}))
  const resumed = new BeeGameSessionManager(runner, root, () => ({}))
  try {
    const workspacePath = join(root, 'game')
    const context = JSON.stringify(brief)
    const messageOrigin = displayKind === 'workflow_v3_production' ? 'workflow' as const : 'user' as const
    const session = first.start({ workspacePath, userId: 'owner', projectId: 'game' })
    await first.sendWithDisplay(session.id, 'Confirmed goal', {
      displayKind, messageOrigin, confirmedBriefContext: context,
    })
    await first.waitForSessionIdle(session.id)
    expect(contexts).toEqual([context])
    if (messageOrigin === 'workflow') {
      expect(first.transcriptFacts(session.id).filter(event => event.type === 'user.message')).toEqual([])
      expect(first.transcriptFacts(session.id).find(event => event.type === 'turn.started')?.payload)
        .toMatchObject({ messageOrigin, confirmedBriefContext: context })
    } else {
      expect(first.transcriptFacts(session.id).find(event => event.type === 'user.message')?.payload)
        .toMatchObject({ displayKind, confirmedBriefContext: context })
    }
    const evidenceDir = join(root, 'confirmed-brief-evidence')
    expect(existsSync(evidenceDir)).toBe(false)
    await first.dispose()

    // Synthetic historical evidence is deliberately different from the chat context.
    // Resume must use the transcript and leave every historical byte untouched.
    await mkdir(evidenceDir)
    const evidencePath = join(evidenceDir, `${session.id}.json`)
    const historical = '{"version":1,"contextDigest":"historical-digest","resourceLibraryUsage":"optional"}\n'
    await writeFile(evidencePath, historical)
    resumed.start({ workspacePath, userId: 'owner', projectId: 'game', transcriptSessionId: session.id })
    await expect(resumed.sendWithDisplay(session.id, 'Invalid update', {
      displayKind: 'confirmed_brief', confirmedBriefContext: JSON.stringify({ kind: 'summary' }),
    })).rejects.toThrow('invalid kind')
    expect(contexts).toHaveLength(1)
    await resumed.sendWithDisplay(session.id, 'Continue')
    await resumed.waitForSessionIdle(session.id)
    expect(contexts).toEqual([context, context])
    expect(await readFile(evidencePath, 'utf8')).toBe(historical)

    const updated = JSON.stringify({ ...brief, resource_library_usage: 'required' })
    await resumed.sendWithDisplay(session.id, 'Updated goal', {
      displayKind, messageOrigin, confirmedBriefContext: updated,
    })
    await resumed.waitForSessionIdle(session.id)
    expect(contexts).toEqual([context, context, updated])
    expect(startContexts).toEqual(contexts)
    expect(await readFile(evidencePath, 'utf8')).toBe(historical)
  } finally {
    await first.dispose()
    await resumed.dispose()
    await rm(root, { recursive: true, force: true })
  }
})

for (const reason of ['production-handoff', 'user-resume', 'workflow-origin-only'] as const)
test(`restored session preserves index and event delivery for ${reason}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-resume-event-'))
  const runner: BeeGameSessionRunner = { async start() { return {
    reusable: false, stop() {}, async submit(input) {
      for (const eventType of ['tool.started', 'tool.completed', 'assistant.message'] as const)
        await input.onMessage({ type: 'runtime_event', runtime: 'bgs', eventType,
          text: 'Synthetic ' + eventType, toolUseID: 'synthetic-tool', toolName: 'SyntheticRead' })
    },
  } } }
  const first = new BeeGameSessionManager(runner, root, () => ({}))
  const restored = new BeeGameSessionManager(runner, root, () => ({}))
  try {
    const workspacePath = join(root, 'game')
    const session = first.start({ workspacePath, userId: 'owner', projectId: 'game' })
    await first.send(session.id, 'Initial authorized assignment')
    await first.waitForSessionIdle(session.id)
    await first.dispose()
    // Remove only the synthetic locator so this test detects a skipped update,
    // rather than passing because the first session already wrote one.
    const indexPath = join(workspacePath, 'logs', 'index.json')
    await rm(indexPath)
    restored.start({ workspacePath, userId: 'owner', projectId: 'game', transcriptSessionId: session.id })
    const delivered: string[] = [], projectDelivered: string[] = []
    const unsubscribe = restored.subscribeEvents(session.id, event => { delivered.push(event.type) })
    const unsubscribeProject = restored.subscribeProjectEvents({workspacePath,userId:'owner',projectId:'game'}, event => { projectDelivered.push(event.type) })
    try {
      await restored.sendWithDisplay(session.id, 'Next actual assignment', {
        messageOrigin: reason === 'user-resume' ? 'user' : 'workflow',
        ...(reason === 'production-handoff' ? {resumeReason:reason} : {}),
      })
      await restored.waitForSessionIdle(session.id)
      const resumedCount = reason === 'production-handoff' ? 0 : 1
      expect(delivered.filter(type => type === 'session.resumed')).toHaveLength(resumedCount)
      expect(projectDelivered).toEqual(delivered)
      for (const type of ['turn.started', 'tool.started', 'tool.completed', 'assistant.message'])
        expect(delivered).toContain(type)
      expect(delivered.includes('user.message')).toBe(reason === 'user-resume')
      const facts = restored.transcriptFacts(session.id)
      expect(facts.filter(event => event.type === 'session.resumed')).toHaveLength(resumedCount)
      expect(facts.filter(event => event.type === 'assistant.message')).toHaveLength(2)
      const index = JSON.parse(await readFile(indexPath, 'utf8'))
      expect(index.sessions[session.id].sessionId).toBe(session.id)
      expect((await recoverLatestProjectSessionFromDisk(workspacePath))?.id).toBe(session.id)
    } finally { unsubscribe(); unsubscribeProject() }
  } finally {
    await first.dispose(); await restored.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
