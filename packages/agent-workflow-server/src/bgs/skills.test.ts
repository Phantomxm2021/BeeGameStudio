import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, lstat, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BgsClient } from './client'
import { configureBgsSkills } from './skills'

test('registers roots before retiring managed links; preserves user files and failed registrations', async () => {
  const root = await mkdtemp('/private/tmp/bgs-shared-skills-'), home = join(root, 'home'), builtins = join(root, 'catalog'), user = join(root, 'user')
  const directory = join(home, 'skills'), source = join(builtins, 'fixture')
  await mkdir(directory, { recursive: true }); await mkdir(source, { recursive: true })
  await writeFile(join(source, 'SKILL.md'), 'Shared source')
  const legacy = join(directory, 'bgs-builtin-fixture')
  await symlink(source, legacy)
  await symlink(source, join(directory, 'bgs-user-old'))
  await symlink(source, join(directory, 'personal-link'))
  await writeFile(join(directory, 'bgs-builtin-personal-file'), 'Keep')
  const client = { request: async (method: string, params: unknown) => {
    expect(method).toBe('skills/extraRoots/set')
    expect(params).toEqual({ extraRoots: [builtins, user] })
    return {}
  } } as Pick<BgsClient, 'request'>
  try {
    const failed = { request: async () => { throw Error('registration failed') } } as Pick<BgsClient, 'request'>
    await expect(configureBgsSkills(failed, home, builtins, user)).rejects.toThrow('registration failed')
    expect((await lstat(legacy)).isSymbolicLink()).toBe(true)
    await Promise.all(Array.from({ length: 4 }, () => configureBgsSkills(client, home, builtins, user)))
    expect(await lstat(legacy).catch(() => undefined)).toBeUndefined()
    expect(await lstat(join(directory, 'bgs-user-old')).catch(() => undefined)).toBeUndefined()
    expect((await lstat(join(directory, 'personal-link'))).isSymbolicLink()).toBe(true)
    expect(await readFile(join(directory, 'bgs-builtin-personal-file'), 'utf8')).toBe('Keep')
    expect(await readFile(join(source, 'SKILL.md'), 'utf8')).toBe('Shared source')
  } finally { await rm(root, { recursive: true, force: true }) }
})
