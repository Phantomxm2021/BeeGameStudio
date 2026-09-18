import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'bun:test'
import { computeWorkspaceRevision } from './revision'

const workspaces: string[] = []

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

test('runtime observability logs do not change workspace identity', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/game.ts'), 'export const game = true\n')

  const before = await computeWorkspaceRevision(workspace)
  await mkdir(join(workspace, '.beegame/logs'), { recursive: true })
  await writeFile(
    join(workspace, '.beegame/logs/native-runtime.jsonl'),
    '{"type":"turn_started"}\n',
  )
  const after = await computeWorkspaceRevision(workspace)

  expect(after).toBe(before)
})

test('implementation files still change workspace identity', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'beegame-revision-'))
  workspaces.push(workspace)
  await mkdir(join(workspace, 'src'), { recursive: true })
  await writeFile(join(workspace, 'src/game.ts'), 'export const game = true\n')
  const before = await computeWorkspaceRevision(workspace)

  await writeFile(join(workspace, 'src/game.ts'), 'export const game = false\n')

  expect(await computeWorkspaceRevision(workspace)).not.toBe(before)
})
