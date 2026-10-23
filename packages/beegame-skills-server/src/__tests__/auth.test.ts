import { describe, expect, test } from 'bun:test'
import { createBeeGameSkillsApp } from '@bee-game-studio/beegame-skills-core'
import type { BeeGameSkillsRepository } from '@bee-game-studio/beegame-skills-core/types'
import { createBeeGameSkillsAuthContext, createConfiguredSkillsUserResolver, hasBeeGameSkillsPermission } from '../auth'

describe('Skills authentication configuration', () => {
  for (const configured of [{}, {BEEGAME_SUPABASE_URL: 'https://audit.invalid'}, {BEEGAME_SUPABASE_ANON_KEY: 'test-anon'}]) {
    test('fails closed in production when Supabase configuration is incomplete: ' + Object.keys(configured).join(','), async () => {
      const resolver = createConfiguredSkillsUserResolver({NODE_ENV: 'production', ...configured})
      expect(resolver).toBeUndefined()
      const auth = createBeeGameSkillsAuthContext({currentUserResolver: resolver})
      const app = createBeeGameSkillsApp({
        repository: {listUserSkills: () => { throw new Error('Unauthenticated repository access') }} as unknown as BeeGameSkillsRepository,
        getCurrentUser: auth.getCurrentUser, resolveRequestUser: auth.resolveRequestUser,
        hasPermission: hasBeeGameSkillsPermission, requireRequestUser: true,
      })
      for (const path of ['/api/user-skills', '/api/user-skills/import']) {
        const response = await app.request(path, {method: path.endsWith('import') ? 'POST' : 'GET'})
        expect(response.status).toBe(401)
      }
    })
  }
  test('retains the explicitly non-production local development identity', async () => {
    const resolve = createConfiguredSkillsUserResolver({NODE_ENV: 'development', BEEGAME_LOCAL_USER_ID: 'developer'})!
    expect(await resolve(new Request('http://audit.invalid/api/user-skills'))).toEqual({id: 'developer', role: 'owner', permissions: ['skills.manage']})
  })
  test('configured production authentication never treats a missing bearer token as local', async () => {
    const resolve = createConfiguredSkillsUserResolver({NODE_ENV: 'production', BEEGAME_SUPABASE_URL: 'https://audit.invalid', BEEGAME_SUPABASE_ANON_KEY: 'test-anon'})!
    expect(await resolve(new Request('http://audit.invalid/api/user-skills'))).toBeUndefined()
  })
})
