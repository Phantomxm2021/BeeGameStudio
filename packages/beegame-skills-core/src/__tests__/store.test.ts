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
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'skill.json'),
      'utf8',
    )).resolves.toContain('"slug": "movement-contracts"')
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Movement')
    await expect(readFile(
      join(dataDir, 'skills', 'user_1', 'movement-contracts', 'files', 'SKILL.md'),
      'utf8',
    )).rejects.toThrow()

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

  test('rejects duplicate user skill slugs', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-duplicate-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: movement-contracts',
        'description: Keep movement controls consistent.',
        '---',
      ].join('\n'),
    }))

    importUserSkill('user_1', { files }, { dataDir })

    expect(() => importUserSkill('user_1', { files }, { dataDir }))
      .toThrow('Skill already exists')
    expect(listUserSkills('user_1', { dataDir })).toHaveLength(1)
  })

  test('migrates legacy user-skills json into per-user skill folders', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-legacy-'))
    await writeFile(join(dataDir, 'user-skills.json'), JSON.stringify({
      version: 1,
      skillsByUserId: {
        user_legacy: [
          {
            id: 'skill_legacy',
            slug: 'legacy-skill',
            name: 'legacy-skill',
            description: 'Legacy skill.',
            enabled: true,
            files: [
              {
                path: 'SKILL.md',
                content: [
                  '---',
                  'name: legacy-skill',
                  'description: Legacy skill.',
                  '---',
                  '',
                  '# Legacy',
                ].join('\n'),
              },
            ],
            createdAt: '2026-07-09T00:00:00.000Z',
            updatedAt: '2026-07-09T00:00:00.000Z',
          },
        ],
      },
    }), 'utf8')

    expect(listUserSkills('user_legacy', { dataDir }).map(skill => skill.slug))
      .toEqual(['legacy-skill'])
    await expect(readFile(
      join(dataDir, 'skills', 'user_legacy', 'legacy-skill', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Legacy')
    await expect(readFile(join(dataDir, 'user-skills.json'), 'utf8')).rejects.toThrow()
    await expect(readFile(join(dataDir, 'user-skills.json.legacy'), 'utf8')).resolves.toContain('legacy-skill')
  })

  test('migrates unscoped user skill folders into the skills root', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-unscoped-'))
    const userId = 'user_with_legacy_skill_dir'
    const legacySkillDir = join(dataDir, userId, 'threejs-fundamentals')
    await mkdir(join(legacySkillDir, 'files', 'references'), { recursive: true })
    await writeFile(join(legacySkillDir, 'skill.json'), JSON.stringify({
      id: 'skill_three',
      slug: 'threejs-fundamentals',
      name: 'threejs-fundamentals',
      description: 'Three.js fundamentals.',
      enabled: true,
      createdAt: '2026-07-09T00:00:00.000Z',
      updatedAt: '2026-07-09T00:00:00.000Z',
    }), 'utf8')
    await writeFile(join(legacySkillDir, 'files', 'SKILL.md'), [
      '---',
      'name: threejs-fundamentals',
      'description: Three.js fundamentals.',
      '---',
      '',
      '# Three.js',
    ].join('\n'), 'utf8')

    expect(listUserSkills(userId, { dataDir }).map(skill => skill.slug))
      .toEqual(['threejs-fundamentals'])
    await expect(readFile(
      join(dataDir, 'skills', userId, 'threejs-fundamentals', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Three.js')
    await expect(readFile(join(dataDir, userId, 'threejs-fundamentals', 'files', 'SKILL.md'), 'utf8'))
      .rejects.toThrow()
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
