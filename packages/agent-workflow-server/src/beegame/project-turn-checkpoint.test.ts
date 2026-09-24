import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProjectTurnCheckpointStore } from './project-turn-checkpoint'

test('restores project, native context, and delivery state while retaining replaced work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-edit-checkpoint-'))
  const workspace = join(root, 'project')
  const dataRoot = join(root, 'data')
  const native = join(root, 'native.jsonl')
  const delivery = join(dataRoot, 'delivery', 'state.json')
  await mkdir(workspace)
  await mkdir(join(dataRoot, 'delivery'), { recursive: true })
  await writeFile(join(workspace, 'game.ts'), 'before')
  await mkdir(join(workspace, 'node_modules'))
  await writeFile(join(workspace, 'node_modules', 'cached.js'), 'dependency cache')
  await mkdir(join(workspace, '.beegame', 'chat'), { recursive: true })
  await writeFile(join(workspace, '.beegame', 'chat', 'project-events.jsonl'), 'prior audit')
  await mkdir(join(workspace, 'transcripts'))
  await writeFile(join(workspace, 'transcripts', 'session.jsonl'), 'prior transcript')
  await writeFile(native, 'prior context')
  await writeFile(delivery, '{"status":"prior"}')
  const store = createProjectTurnCheckpointStore(dataRoot)
  await store.save({ ownerId: 'owner', workspacePath: workspace, clientMessageId: 'message-1',
    sessionId: 'session-1', nativeSessionId: 'native-1', nativeTranscriptPath: native,
    deliveryStatePath: delivery })
  await writeFile(join(workspace, 'game.ts'), 'after')
  await writeFile(join(workspace, 'new.ts'), 'created')
  await writeFile(join(workspace, '.beegame', 'chat', 'project-events.jsonl'), 'append-only audit')
  await writeFile(join(workspace, 'transcripts', 'session.jsonl'), 'append-only transcript')
  await writeFile(native, 'later context')
  await writeFile(delivery, '{"status":"later"}')
  // A runtime restart must still find the durable pre-turn checkpoint.
  const result = await createProjectTurnCheckpointStore(dataRoot).restore({ ownerId: 'owner', workspacePath: workspace,
    clientMessageId: 'message-1', sessionId: 'session-1', deliveryStatePath: delivery })
  expect(await readFile(join(workspace, 'game.ts'), 'utf8')).toBe('before')
  expect((await readdir(workspace)).sort()).toEqual(['.beegame', 'game.ts', 'node_modules', 'transcripts'])
  expect(await readFile(join(workspace, 'node_modules', 'cached.js'), 'utf8')).toBe('dependency cache')
  expect(await readFile(join(workspace, '.beegame', 'chat', 'project-events.jsonl'), 'utf8')).toBe('append-only audit')
  expect(await readFile(join(workspace, 'transcripts', 'session.jsonl'), 'utf8')).toBe('append-only transcript')
  expect(await readFile(native, 'utf8')).toBe('prior context')
  expect(await readFile(delivery, 'utf8')).toBe('{"status":"prior"}')
  expect(result.nativeSessionId).toBe('native-1')
  expect(await readFile(join(result.archivePath, 'workspace', 'game.ts'), 'utf8')).toBe('after')
  expect(await readFile(join(result.archivePath, 'native.jsonl'), 'utf8')).toBe('later context')
  await store.reapplyArchive({ workspacePath: workspace, archivePath: result.archivePath,
    nativeTranscriptPath: native, deliveryStatePath: delivery })
  expect(await readFile(join(workspace, 'game.ts'), 'utf8')).toBe('after')
  expect(await readFile(join(workspace, 'new.ts'), 'utf8')).toBe('created')
  expect(await readFile(native, 'utf8')).toBe('later context')
  expect(await readFile(delivery, 'utf8')).toBe('{"status":"later"}')
})

test('refuses a message without its own checkpoint', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beegame-edit-checkpoint-'))
  const workspace = join(root, 'project')
  await mkdir(workspace)
  const store = createProjectTurnCheckpointStore(join(root, 'data'))
  await expect(store.restore({ ownerId: 'owner', workspacePath: workspace,
    clientMessageId: 'old', sessionId: 'session-1', deliveryStatePath: join(root, 'delivery.json') }))
    .rejects.toThrow('no pre-turn checkpoint')
})
