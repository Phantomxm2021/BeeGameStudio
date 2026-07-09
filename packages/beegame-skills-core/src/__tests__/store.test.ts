import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, afterEach } from 'bun:test'
import { zipSync, strToU8 } from 'fflate'
import {
  importUserSkill,
  listUserSkills,
  materializeUserSkills,
  parseSkillZipPackage,
} from '../store'
import {
  BeeGameSkillValidationError,
} from '../types'

let dataDir = ''

afterEach(async () => {
  if (dataDir) await rm(dataDir, { recursive: true, force: true })
  dataDir = ''
})

describe('BeeGame skills store', () => {
  test('imports zip skill packages and materializes enabled skills', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: movement-contracts',
        'description: Keep movement controls consistent.',
        '---',
        '',
        '# Movement',
      ].join('\n'),
      'references/xr.md': '# XR movement',
    }))

    const skill = importUserSkill('user_1', { files }, { dataDir })

    expect(skill.slug).toBe('movement-contracts')
    expect(listUserSkills('user_1', { dataDir })).toHaveLength(1)

    materializeUserSkills([skill], { dataDir })
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-movement-contracts', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Movement')
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-movement-contracts', 'references', 'xr.md'),
      'utf8',
    )).resolves.toContain('XR movement')
  })

  test('rejects unsafe package paths', () => {
    expect(() => parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: unsafe-skill',
        'description: Unsafe.',
        '---',
      ].join('\n'),
      '../outside.md': 'bad',
    }))).toThrow(BeeGameSkillValidationError)
  })

  test('removes stale materialized user skill folders', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-clean-'))
    const staleDir = join(dataDir, '.runtime', 'app', 'skills', 'user-stale-skill')
    await mkdir(staleDir, { recursive: true })
    await writeFile(join(staleDir, 'SKILL.md'), 'stale', 'utf8')
    materializeUserSkills([], { dataDir })
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-stale-skill', 'SKILL.md'),
      'utf8',
    )).rejects.toThrow()
  })
})

function createSkillZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strToU8(content)]),
  ))
}
