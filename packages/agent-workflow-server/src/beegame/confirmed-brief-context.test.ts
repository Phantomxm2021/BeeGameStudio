import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateConfirmedBriefContext } from './confirmed-brief-context'
import { BeeGameSessionManager, type BeeGameSessionRunner } from './session-manager'

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

test.each(['confirmed_brief', 'workflow_v3_goal', 'workflow_v3_change'])('new and resumed turns retain %s context without replacing independent evidence', async displayKind => {
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
    const session = first.start({ workspacePath, userId: 'owner', projectId: 'game' })
    await first.sendWithDisplay(session.id, 'Confirmed goal', {
      displayKind, confirmedBriefContext: context,
    })
    await first.waitForSessionIdle(session.id)
    expect(contexts).toEqual([context])
    expect(first.transcriptFacts(session.id).find(event => event.type === 'user.message')?.payload)
      .toMatchObject({ displayKind, confirmedBriefContext: context })
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
      displayKind, confirmedBriefContext: updated,
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
