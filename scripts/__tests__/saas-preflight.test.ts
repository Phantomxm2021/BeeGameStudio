import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, {recursive: true, force: true}))) })

async function preflight(extra: Record<string, string>) {
  const cwd = await mkdtemp(join(tmpdir(), 'bgs-preflight-')); roots.push(cwd)
  const proc = Bun.spawn([process.execPath, resolve(import.meta.dir, '../check-beegame-saas-preflight.ts')], {
    cwd,
    env: {PATH: process.env.PATH, BEEGAME_SUPABASE_URL: 'https://audit.invalid',
      BEEGAME_SUPABASE_ANON_KEY: 'test-anon', BEEGAME_SUPABASE_AVATAR_BUCKET: 'avatars',
      BEEGAME_SUPABASE_ASSET_BUCKET: 'assets', BEEGAME_SUPABASE_ACCESS_TOKEN: 'test-user-token',
      BEEGAME_SUPABASE_USER_ID: 'test-user', ...extra},
    stdout: 'pipe', stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  return {code, output: stdout + stderr}
}

test('trusted V3 deployment requires its runtime key and accepts the configured key without logging it', async () => {
  const missing = await preflight({})
  expect(missing.code).toBe(1)
  expect(missing.output).toContain('fail Trusted V3 runtime service-role key')
  for (const key of ['BEEGAME_SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const configured = await preflight({[key]: 'private-runtime-secret-fixture'})
    expect(configured.code).toBe(0)
    expect(configured.output).not.toContain('private-runtime-secret-fixture')
  }
})

test('frontend service-role exposure fails even under the anonymous-key alias', async () => {
  for (const key of ['VITE_SUPABASE_SERVICE_ROLE_KEY', 'VITE_SUPABASE_ANON_KEY']) {
    const result = await preflight({BEEGAME_SUPABASE_SERVICE_ROLE_KEY: 'private-runtime-secret-fixture', [key]: 'private-runtime-secret-fixture'})
    expect(result.code).toBe(1)
    expect(result.output).toContain('fail Frontend service-role secret')
    expect(result.output).not.toContain('private-runtime-secret-fixture')
  }
})
