import { expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { BeeGameSessionManager, projectChatSource, readSessionTranscriptFactsFromDisk, readSessionTranscriptPageFromDisk } from './session-manager'
import { projectChatPath, appendChatTranscript } from './project-records'
import { readChatHistoryPage } from './chat-history'

const noModel = { async start(): Promise<never> { throw Error('This read-only test must never start a model') } }

test('one project log supplies all sessions, stable global IDs, recovery and read-only history', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-single-chat-')), workspace = join(root, 'project')
  const first = new BeeGameSessionManager(noModel, root), second = new BeeGameSessionManager(noModel, root)
  try {
    const a = first.start({ workspacePath: workspace, projectId: 'project', userId: 'owner', language: 'zh' })
    expect(first.metadata(a.id)?.transcriptPath).toBe(projectChatPath(workspace))
    await first.dispose()
    const b = second.start({ workspacePath: workspace, projectId: 'project', userId: 'owner' })
    await second.dispose()
    const path = projectChatPath(workspace), before = await readFile(path, 'utf8')
    const all = before.trim().split('\n').map(line => JSON.parse(line))
    expect(all.map(event => event.id)).toEqual(all.map((_, index) => index + 1))
    expect(new Set(all.map(event => event.sessionId))).toEqual(new Set([a.id, b.id]))
    expect(existsSync(join(workspace, 'transcripts'))).toBe(false)
    expect((await readSessionTranscriptFactsFromDisk(a.id, workspace)).every(event => event.sessionId === a.id)).toBe(true)
    expect((await readSessionTranscriptPageFromDisk(b.id, workspace)).rows.every(event => event.sessionId === b.id)).toBe(true)
    const source = projectChatSource(workspace)
    const page = await readChatHistoryPage(source.path, source.reader, { limit: 100 })
    expect(new Set(page.events.map(event => event.sessionId))).toEqual(new Set([a.id, b.id]))
    expect(await readFile(path, 'utf8')).toBe(before)
  } finally { await first.dispose(); await second.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('recovery after an oversized progress record preserves the final event cursor without loading its cumulative body', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-progress-recovery-')), workspace = join(root, 'project')
  const writer = new BeeGameSessionManager(noModel, root), recovered = new BeeGameSessionManager(noModel, root)
  try {
    const session = writer.start({ workspacePath: workspace, userId: 'owner' })
    await writer.dispose()
    const path = projectChatPath(workspace)
    appendChatTranscript(path, { id: 900, sessionId: session.id, turnId: 'crashed-turn', type: 'turn.started', text: 'Start', createdAt: new Date(900) })
    appendChatTranscript(path, { id: 1000, sessionId: session.id, turnId: 'crashed-turn', type: 'tool.progress', text: 'delta',
      payload: { type: 'tool.progress', toolName: 'Shell', toolUseID: 'command', output: 'x'.repeat(5 * 1024 * 1024) }, createdAt: new Date(1000) })
    recovered.start({ workspacePath: workspace, userId: 'owner', transcriptSessionId: session.id })
    const events = recovered.transcriptFacts(session.id)
    expect(events.at(-1)).toMatchObject({ id: 1001, type: 'turn.failed', turnId: 'crashed-turn' })
    expect(events.find(event => event.id === 1000)?.payload?.output).toBeUndefined()
    expect((await readSessionTranscriptPageFromDisk(session.id, workspace, { afterId: 1000 })).rows[0]?.id).toBe(1001)
  } finally { await writer.dispose(); await recovered.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('oversized Shell completion receipts omit only output across disk facts and synchronous recovery', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-shell-recovery-')), workspace = join(root, 'project')
  const writer = new BeeGameSessionManager(noModel, root), recovered = new BeeGameSessionManager(noModel, root)
  try {
    const session = writer.start({ workspacePath: workspace, userId: 'owner' })
    await writer.dispose()
    const path = projectChatPath(workspace), oversizedOutput = 'x'.repeat(5 * 1024 * 1024)
    appendChatTranscript(path, { id: 900, sessionId: session.id, turnId: 'crashed-shell-turn', type: 'turn.started', text: 'Start', createdAt: new Date(900) })
    for (const receipt of [
      { id: 901, type: 'tool.completed', toolUseID: 'shell-completed', status: 'completed', exitCode: 0, failed: false },
      { id: 902, type: 'tool.failed', toolUseID: 'shell-failed', status: 'failed', exitCode: 17, failed: true },
    ]) {
      appendChatTranscript(path, { id: receipt.id, sessionId: session.id, turnId: 'crashed-shell-turn', type: receipt.type,
        text: receipt.type === 'tool.failed' ? 'Shell failed' : 'Shell completed', createdAt: new Date(receipt.id), payload: {
          type: receipt.type, toolName: 'Shell', toolUseID: receipt.toolUseID, parentToolUseID: 'agent-parent',
          input: { command: 'printf shell-receipt-fixture', cwd: workspace }, output: oversizedOutput,
          exitCode: receipt.exitCode, durationMs: 250, status: receipt.status, is_error: receipt.failed,
        } })
    }

    const facts = await readSessionTranscriptFactsFromDisk(session.id, workspace)
    const shellFacts = facts.filter(event => event.payload?.toolName === 'Shell')
    expect(shellFacts).toHaveLength(2)
    expect(shellFacts[0]).toMatchObject({ type: 'tool.completed', payload: {
      toolUseID: 'shell-completed', toolName: 'Shell', parentToolUseID: 'agent-parent',
      input: { command: 'printf shell-receipt-fixture', cwd: workspace }, exitCode: 0,
      durationMs: 250, status: 'completed', is_error: false,
    } })
    expect(shellFacts[1]).toMatchObject({ type: 'tool.failed', payload: {
      toolUseID: 'shell-failed', toolName: 'Shell', parentToolUseID: 'agent-parent',
      input: { command: 'printf shell-receipt-fixture', cwd: workspace }, exitCode: 17,
      durationMs: 250, status: 'failed', is_error: true,
    } })
    expect(shellFacts.every(event => event.payload?.output === undefined)).toBe(true)

    // Force the shared reader to invalidate its async facts cache before the
    // synchronous resume path reads the same oversized completion rows.
    appendChatTranscript(path, { id: 903, sessionId: session.id, turnId: 'crashed-shell-turn', type: 'system.status',
      text: 'Still recovering', createdAt: new Date(903), payload: { type: 'system.status', status: 'running' } })
    recovered.start({ workspacePath: workspace, userId: 'owner', transcriptSessionId: session.id })
    const recoveredShellFacts = recovered.transcriptFacts(session.id).filter(event => event.payload?.toolName === 'Shell')
    expect(recovered.transcriptFacts(session.id).at(-1)).toMatchObject({ type: 'turn.failed', turnId: 'crashed-shell-turn' })
    expect(recoveredShellFacts).toHaveLength(2)
    expect(recoveredShellFacts[0]).toMatchObject({ payload: {
      toolUseID: 'shell-completed', input: { command: 'printf shell-receipt-fixture', cwd: workspace },
      exitCode: 0, durationMs: 250, status: 'completed', is_error: false,
    } })
    expect(recoveredShellFacts[1]).toMatchObject({ payload: {
      toolUseID: 'shell-failed', input: { command: 'printf shell-receipt-fixture', cwd: workspace },
      exitCode: 17, durationMs: 250, status: 'failed', is_error: true,
    } })
    expect(recoveredShellFacts.every(event => event.payload?.output === undefined)).toBe(true)
  } finally { await writer.dispose(); await recovered.dispose(); await rm(root, { recursive: true, force: true }) }
})

test('a torn authoritative tail blocks append without trimming or rewriting evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-chat-incomplete-')), workspace = join(root, 'project')
  const writer = new BeeGameSessionManager(noModel, root), recovered = new BeeGameSessionManager(noModel, root)
  try {
    const session = writer.start({ workspacePath: workspace, userId: 'owner' })
    await writer.dispose()
    const path = projectChatPath(workspace)
    await appendFile(path, '{"id":999,"text":"unfinished')
    const before = await readFile(path, 'utf8')
    expect(() => recovered.start({ workspacePath: workspace, userId: 'owner', transcriptSessionId: session.id })).toThrow('incomplete final record')
    expect(await readFile(path, 'utf8')).toBe(before)
  } finally { await writer.dispose(); await recovered.dispose(); await rm(root, { recursive: true, force: true }) }
})
