import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, afterEach } from 'bun:test'
import { zipSync, strToU8 } from 'fflate'
import {
  importUserSkill,
  listUserSkills,
  materializeBuiltinSkills,
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

  test('keeps custom skills isolated by authenticated user', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-users-'))
    const files = parseSkillZipPackage(createSkillZip({
      'SKILL.md': [
        '---',
        'name: private-workflow',
        'description: User-owned workflow.',
        '---',
        '',
        '# Private Workflow',
      ].join('\n'),
    }))

    importUserSkill('user-a', { files }, { dataDir })

    expect(listUserSkills('user-a', { dataDir })).toHaveLength(1)
    expect(listUserSkills('user-b', { dataDir })).toEqual([])
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

  test('preserves nested reference documents across storage reload and materialization', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-nested-references-'))
    const userId = 'reference-owner'
    importUserSkill(userId, {
      files: parseSkillZipPackage(createSkillZip({
        'SKILL.md': [
          '---',
          'name: nested-references',
          'description: Uses a nested reference document.',
          '---',
          '',
          '# Nested references',
        ].join('\n'),
        'references/input/touch.md': '# Touch contract',
      })),
    }, { dataDir })

    const reloaded = listUserSkills(userId, { dataDir })
    expect(reloaded[0]?.files.map(file => file.path)).toEqual([
      'references/input/touch.md',
      'SKILL.md',
    ])

    materializeUserSkills(reloaded, { dataDir })
    await expect(readFile(join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      'user-nested-references',
      'references',
      'input',
      'touch.md',
    ), 'utf8')).resolves.toContain('# Touch contract')
  })

  test('materializes built-in skills into the isolated runtime config', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-builtins-'))
    const sourceDir = join(dataDir, 'source-builtins')
    await mkdir(join(sourceDir, 'acceptance'), { recursive: true })
    await writeFile(join(sourceDir, 'acceptance', 'SKILL.md'), [
      '---',
      'name: acceptance',
      'description: Validate a deliverable.',
      '---',
      '',
      '# Acceptance',
    ].join('\n'), 'utf8')

    materializeBuiltinSkills({ dataDir }, sourceDir)

    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'acceptance', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('# Acceptance')
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', '.beegame-builtins.json'),
      'utf8',
    )).resolves.toContain('"acceptance"')
    expect(existsSync(join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      'builtinskills',
    ))).toBe(false)
  })

  test('preserves user skills and removes only stale built-in projections', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-skills-core-projection-'))
    const sourceDir = join(dataDir, 'source-builtins')
    await mkdir(join(sourceDir, 'first'), { recursive: true })
    await writeFile(join(sourceDir, 'first', 'SKILL.md'), [
      '---',
      'name: first',
      'description: First built-in.',
      '---',
    ].join('\n'), 'utf8')
    const userSkillDir = join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      'user-custom',
    )
    await mkdir(userSkillDir, { recursive: true })
    await writeFile(join(userSkillDir, 'SKILL.md'), 'user skill', 'utf8')

    materializeBuiltinSkills({ dataDir }, sourceDir)
    await rm(join(sourceDir, 'first'), { recursive: true, force: true })
    await mkdir(join(sourceDir, 'second'), { recursive: true })
    await writeFile(join(sourceDir, 'second', 'SKILL.md'), [
      '---',
      'name: second',
      'description: Second built-in.',
      '---',
    ].join('\n'), 'utf8')
    await writeFile(join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      '.beegame-builtins.json',
    ), JSON.stringify({
      version: 1,
      skills: ['first', 'user-custom', '../outside'],
    }), 'utf8')
    materializeBuiltinSkills({ dataDir }, sourceDir)

    expect(existsSync(join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      'first',
    ))).toBe(false)
    await expect(readFile(join(
      dataDir,
      '.runtime',
      'app',
      'skills',
      'second',
      'SKILL.md',
    ), 'utf8')).resolves.toContain('Second built-in')
    await expect(readFile(join(userSkillDir, 'SKILL.md'), 'utf8'))
      .resolves.toBe('user skill')
  })
})

function createSkillZip(files: Record<string, string>): Uint8Array {
  return zipSync(Object.fromEntries(
    Object.entries(files).map(([path, content]) => [path, strToU8(content)]),
  ))
}
