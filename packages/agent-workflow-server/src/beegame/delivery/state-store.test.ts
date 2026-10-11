import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readProjectDelivery, projectDeliveryStatePath, save, withStateMutation } from './state-store'

test('one canonical state store serializes aliases and releases the lock after failure', async () => {
  const root = await mkdtemp('/private/tmp/bgs-stage-store-'), workspace = join(root, 'game'), alias = join(root, 'alias')
  try {
    await mkdir(workspace); await symlink(workspace, alias)
    await save(workspace, root, { version: 1, objective: '', status: 'active', phase: 'content' })
    expect(projectDeliveryStatePath(alias, root)).toBe(projectDeliveryStatePath(workspace, root))
    await expect(withStateMutation(workspace, root, async () => { throw Error('interrupted') })).rejects.toThrow('interrupted')
    await Promise.all([workspace, alias].map((path, i) => withStateMutation(path, root, async () => {
      const state = (await readProjectDelivery(path, root))!
      await Promise.resolve()
      await save(path, root, { ...state, objective: state.objective + i })
    })))
    expect((await readProjectDelivery(workspace, root))?.objective).toBe('01')
    const path = projectDeliveryStatePath(workspace, root)
    expect(await readdir(join(path, '..'))).toEqual(['state.json'])
    const legacy = JSON.stringify({ version: 2, objective: 'Retired workflow', status: 'active' })
    await writeFile(path, legacy)
    await expect(readProjectDelivery(workspace, root)).rejects.toThrow('no automatic migration')
    expect(await readFile(path, 'utf8')).toBe(legacy)
  } finally { await rm(root, { recursive: true, force: true }) }
})
