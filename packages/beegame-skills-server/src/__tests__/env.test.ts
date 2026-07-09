import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getBeeGameSkillsEnvDiagnostics,
  loadBeeGameSkillsEnvFile,
  resolveBeeGameSkillsEnvFile,
  resolveBeeGameSkillsListenOptions,
} from '../env'

describe('BeeGame skills env', () => {
  test('loads env files without overriding existing values or exposing secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'beegame-skills-env-'))
    const envPath = join(dir, '.env.skills')
    const env: Record<string, string | undefined> = {
      BEEGAME_SKILLS_SERVICE_TOKEN: 'process-token',
    }
    await writeFile(envPath, [
      'BEEGAME_SKILLS_PORT=62200',
      'BEEGAME_SKILLS_SERVICE_TOKEN=file-token',
      'BEEGAME_SUPABASE_URL=https://project.supabase.co',
    ].join('\n'))

    try {
      const result = await loadBeeGameSkillsEnvFile(envPath, env)

      expect(result.loadedKeys).toContain('BEEGAME_SKILLS_PORT')
      expect(result.loadedKeys).toContain('BEEGAME_SUPABASE_URL')
      expect(result.skippedExistingKeys).toContain('BEEGAME_SKILLS_SERVICE_TOKEN')
      expect(env.BEEGAME_SKILLS_SERVICE_TOKEN).toBe('process-token')
      expect(resolveBeeGameSkillsListenOptions(env)).toEqual({
        host: '127.0.0.1',
        port: 62200,
      })
      expect(getBeeGameSkillsEnvDiagnostics(result, env)).toContainEqual({
        key: 'BEEGAME_SKILLS_SERVICE_TOKEN',
        configured: true,
        source: 'process-env',
        length: 'process-token'.length,
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('resolves root skills env before local env and docker production env', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'beegame-skills-env-'))
    await mkdir(join(dir, 'docker'))
    const rootPath = join(dir, '.env.skills')
    const localPath = join(dir, '.env.local')
    const dockerPath = join(dir, 'docker/.env.production')
    await writeFile(rootPath, 'BEEGAME_SKILLS_PORT=62201\n')
    await writeFile(localPath, 'BEEGAME_SKILLS_PORT=62202\n')
    await writeFile(dockerPath, 'BEEGAME_SKILLS_PORT=62203\n')

    try {
      expect(resolveBeeGameSkillsEnvFile({ cwd: dir, env: {} })).toBe(rootPath)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
