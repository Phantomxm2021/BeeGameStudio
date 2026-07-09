import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  UserSkillValidationError,
  deleteUserSkill,
  listUserSkills,
  materializeUserSkills,
  upsertUserSkill,
} from '../user-skills-store'

describe('user skills store', () => {
  let dataDir = ''

  afterEach(async () => {
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true })
      dataDir = ''
    }
  })

  test('saves declarative skills and materializes enabled skills into runtime config', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-user-skills-'))
    const skill = upsertUserSkill({
      content: [
        '---',
        'name: movement-contracts',
        'description: Keep locomotion controls consistent across generated games.',
        '---',
        '',
        '# Movement Contracts',
        '',
        'Keep movement relative to the actor orientation unless the game explicitly defines another frame.',
      ].join('\n'),
      references: [{
        path: 'references/xr.md',
        content: '# XR\n\nSupport seated and standing comfort options.',
      }],
    }, { dataDir })

    expect(skill.slug).toBe('movement-contracts')
    expect(listUserSkills({ dataDir })).toHaveLength(1)

    materializeUserSkills(listUserSkills({ dataDir }), { dataDir })

    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-movement-contracts', 'SKILL.md'),
      'utf8',
    )).resolves.toContain('Movement Contracts')
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-movement-contracts', 'references', 'xr.md'),
      'utf8',
    )).resolves.toContain('Support seated')
  })

  test('cleans stale materialized user skills without touching built-in skills', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-user-skills-'))
    await mkdir(join(dataDir, '.runtime', 'app', 'skills', 'core-skill'), {
      recursive: true,
    })
    await writeFile(
      join(dataDir, '.runtime', 'app', 'skills', 'core-skill', 'SKILL.md'),
      'core',
      'utf8',
    )
    const skill = upsertUserSkill({
      content: [
        '---',
        'name: temporary-skill',
        'description: Temporary skill.',
        '---',
        '',
        '# Temporary',
      ].join('\n'),
    }, { dataDir })
    materializeUserSkills(listUserSkills({ dataDir }), { dataDir })

    deleteUserSkill(skill.id, { dataDir })
    materializeUserSkills(listUserSkills({ dataDir }), { dataDir })

    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'user-temporary-skill', 'SKILL.md'),
      'utf8',
    )).rejects.toThrow()
    await expect(readFile(
      join(dataDir, '.runtime', 'app', 'skills', 'core-skill', 'SKILL.md'),
      'utf8',
    )).resolves.toBe('core')
  })

  test('rejects invalid frontmatter and unsafe reference paths', async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'beegame-user-skills-'))

    expect(() => upsertUserSkill({
      content: '# Missing frontmatter',
    }, { dataDir })).toThrow(UserSkillValidationError)

    expect(() => upsertUserSkill({
      content: [
        '---',
        'name: safe-skill',
        'description: Safe skill.',
        '---',
        '',
        '# Safe',
      ].join('\n'),
      references: [{
        path: 'references/../secret.md',
        content: 'secret',
      }],
    }, { dataDir })).toThrow(UserSkillValidationError)
  })
})
