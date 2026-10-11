import { expect, spyOn, test } from 'bun:test'
import * as fs from 'node:fs/promises'
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

test.each([true, false])('failed reapply restores native history and delivery alongside files (previous history: %s)', async nativeExisted => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-reapply-failure-'))
  const workspace = join(root, 'workspace'), native = join(root, 'native.jsonl'), delivery = join(root, 'delivery.json')
  await mkdir(workspace)
  await writeFile(join(workspace, 'game.ts'), 'A')
  if (nativeExisted) await writeFile(native, 'A')
  await writeFile(delivery, 'A')
  const store = createProjectTurnCheckpointStore(join(root, 'data'))
  const identity = { ownerId: 'owner', workspacePath: workspace, clientMessageId: 'request', sessionId: 'session', deliveryStatePath: delivery }
  await (await store.save({ ...identity, nativeTranscriptPath: native })).commit()
  for (const path of [join(workspace, 'game.ts'), native, delivery]) await writeFile(path, 'B')
  const { archivePath } = await store.restore(identity)
  const originalCopy = fs.copyFile
  const copy = spyOn(fs, 'copyFile').mockImplementation(async (source, destination, ...rest) => {
    if (source === join(archivePath, 'delivery.json') && destination === delivery) {
      await writeFile(delivery, 'partially overwritten')
      throw new Error('Injected delivery write failure')
    }
    return originalCopy(source, destination, ...rest)
  })
  try {
    await expect(store.reapplyArchive({ workspacePath: workspace, archivePath,
      nativeTranscriptPath: native, deliveryStatePath: delivery })).rejects.toThrow('Injected delivery write failure')
    expect(await readFile(join(workspace, 'game.ts'), 'utf8')).toBe('A')
    if (nativeExisted) expect(await readFile(native, 'utf8')).toBe('A')
    else expect(await Bun.file(native).exists()).toBe(false)
    expect(await readFile(delivery, 'utf8')).toBe('A')
    await store.assertRecovered(workspace)
  } finally { copy.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})

test('failed rollback retains its evidence and blocks another project request after restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-reapply-incomplete-'))
  const workspace = join(root, 'workspace'), native = join(root, 'native.jsonl'), delivery = join(root, 'delivery.json')
  await mkdir(workspace)
  for (const path of [join(workspace, 'game.ts'), native, delivery]) await writeFile(path, 'A')
  const dataRoot = join(root, 'data'), store = createProjectTurnCheckpointStore(dataRoot)
  const identity = { ownerId: 'owner', workspacePath: workspace, clientMessageId: 'request', sessionId: 'session', deliveryStatePath: delivery }
  await (await store.save({ ...identity, nativeTranscriptPath: native })).commit()
  for (const path of [join(workspace, 'game.ts'), native, delivery]) await writeFile(path, 'B')
  const { archivePath } = await store.restore(identity)
  const originalCopy = fs.copyFile
  const copy = spyOn(fs, 'copyFile').mockImplementation(async (source, destination, ...rest) => {
    if (destination === delivery) throw new Error('Injected persistent write failure')
    return originalCopy(source, destination, ...rest)
  })
  try {
    await expect(store.reapplyArchive({ workspacePath: workspace, archivePath,
      nativeTranscriptPath: native, deliveryStatePath: delivery })).rejects.toThrow('backup retained')
    expect(await readFile(native, 'utf8')).toBe('A')
    const markers = join(dataRoot, 'project-turn-checkpoints/recovery-required')
    const marker = JSON.parse(await readFile(join(markers, (await readdir(markers))[0]!), 'utf8'))
    expect(await readFile(join(marker.backup, 'native.jsonl'), 'utf8')).toBe('A')
    const restarted = createProjectTurnCheckpointStore(dataRoot)
    await expect(restarted.assertRecovered(workspace)).rejects.toThrow('recovery is incomplete')
    await expect(restarted.save(identity)).rejects.toThrow('recovery is incomplete')
  } finally { copy.mockRestore(); await fs.rm(root, { recursive: true, force: true }) }
})
