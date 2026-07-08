import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  loadBeeGameBillingEnvFile,
  resolveBeeGameBillingEnvFile,
  summarizeBeeGameBillingEnv,
} from '../env'

describe('BeeGame billing env', () => {
  test('loads env files without overriding existing values or exposing secrets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-billing-env-'))
    const envPath = join(root, '.env.billing')
    try {
      await writeFile(envPath, [
        '# local billing env',
        'BEEGAME_SUPABASE_URL=https://project.supabase.co',
        'BEEGAME_SUPABASE_ANON_KEY=anon-key',
        'BEEGAME_SUPABASE_SERVICE_ROLE_KEY=service-role-secret',
        'BEEGAME_STRIPE_SECRET_KEY=sk_test_secret',
        'BEEGAME_STRIPE_WEBHOOK_SECRET="whsec_test_secret"',
        'BEEGAME_STRIPE_PRICE_CREDITS=price_123=500',
        '',
      ].join('\n'))
      const env: Record<string, string | undefined> = {
        BEEGAME_STRIPE_SECRET_KEY: 'existing-secret',
      }

      const result = await loadBeeGameBillingEnvFile(envPath, env)
      const summary = summarizeBeeGameBillingEnv(env)

      expect(result.loadedPath).toBe(envPath)
      expect(result.loadedKeys).toEqual([
        'BEEGAME_SUPABASE_URL',
        'BEEGAME_SUPABASE_ANON_KEY',
        'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
        'BEEGAME_STRIPE_WEBHOOK_SECRET',
        'BEEGAME_STRIPE_PRICE_CREDITS',
      ])
      expect(result.skippedExistingKeys).toEqual(['BEEGAME_STRIPE_SECRET_KEY'])
      expect(env.BEEGAME_STRIPE_SECRET_KEY).toBe('existing-secret')
      expect(env.BEEGAME_STRIPE_WEBHOOK_SECRET).toBe('whsec_test_secret')
      expect(summary.configured).toEqual([
        'BEEGAME_SUPABASE_URL',
        'BEEGAME_SUPABASE_ANON_KEY',
        'BEEGAME_SUPABASE_SERVICE_ROLE_KEY',
        'BEEGAME_STRIPE_SECRET_KEY',
        'BEEGAME_STRIPE_WEBHOOK_SECRET',
        'BEEGAME_STRIPE_PRICE_CREDITS',
      ])
      expect(JSON.stringify(summary)).not.toContain('secret')
      expect(JSON.stringify(summary)).not.toContain('anon-key')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('resolves explicit env file before default local paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'beegame-billing-env-root-'))
    try {
      const explicitPath = join(root, 'custom.env')
      const defaultPath = join(root, 'docker', '.env.billing')
      await writeFile(explicitPath, 'BEEGAME_BILLING_MODE=server\n')
      await mkdir(join(root, 'docker'), { recursive: true })
      await writeFile(defaultPath, 'BEEGAME_BILLING_MODE=server\n')
      expect(resolveBeeGameBillingEnvFile({
        cwd: root,
        env: { BEEGAME_BILLING_ENV_FILE: explicitPath },
      })).toBe(explicitPath)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
