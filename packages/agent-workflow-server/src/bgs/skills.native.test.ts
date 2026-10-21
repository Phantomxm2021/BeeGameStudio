import { expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { getBuiltinSkillsDirectory } from '@bee-game-studio/beegame-skills-core/store'
import { BgsClient } from './client'
import { configureBgsSkills } from './skills'

const nativeTest = process.env.BGS_SANDBOX_TESTS === '1' ? test : test.skip
nativeTest('two accounts discover one shared catalog and only their own imported skills without projection links', async () => {
  const root = await mkdtemp('/private/tmp/bgs-shared-native-'), catalog = getBuiltinSkillsDirectory()
  const names = (await readdir(catalog, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name).sort()
  try {
    for (const owner of ['owner-a', 'owner-b']) {
      const account = join(root, owner), home = join(account, 'bgs'), user = join(account, 'skills')
      await mkdir(join(home, 'skills'), { recursive: true })
      await mkdir(join(user, owner), { recursive: true })
      await writeFile(join(user, owner, 'SKILL.md'), `---\nname: ${owner}\ndescription: Private fixture skill.\n---\nPrivate fixture\n`)
      await symlink(join(catalog, names[0]!), join(home, 'skills', 'bgs-builtin-legacy'))
      const client = await BgsClient.connect({ cwd: account, env: { PATH: process.env.PATH!, HOME: account, BGS_HOME: home }, config: { cli_auth_credentials_store: 'file' } })
      try {
        await configureBgsSkills(client, home, catalog, user)
        const result = await client.request('skills/list', { cwds: [account], forceReload: true })
        expect(result.data.flatMap((entry: any) => entry.errors)).toEqual([])
        const skills = result.data.flatMap((entry: any) => entry.skills)
        expect(skills.filter((s: any) => s.path.startsWith(catalog + '/')).map((s: any) => s.name).sort()).toEqual(names)
        expect(skills.some((s: any) => s.name === owner && s.path === join(user, owner, 'SKILL.md'))).toBe(true)
        expect(skills.some((s: any) => s.name === (owner === 'owner-a' ? 'owner-b' : 'owner-a'))).toBe(false)
        expect((await readdir(join(home, 'skills'))).some(name => name.startsWith('bgs-builtin-') || name.startsWith('bgs-user-'))).toBe(false)
      } finally { await client.close() }
    }
  } finally { await rm(root, { recursive: true, force: true }) }
}, 15_000)
