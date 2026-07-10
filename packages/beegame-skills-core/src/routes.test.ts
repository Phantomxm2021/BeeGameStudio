import { describe, expect, test } from 'bun:test'
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate'
import { createBeeGameSkillsApp } from './app'
import { parseSkillZipPackage } from './store'
import type { BeeGameUserSkill } from './types'

function skillZip(files: Record<string, string>): File {
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])))
  return new File([new Blob([archive as unknown as BlobPart])], 'skill.zip', { type: 'application/zip' })
}

function duplicateSkillZip(): File {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => {
    if (error) throw error
    chunks.push(chunk)
  })
  for (const content of [
    '---\nname: first\ndescription: first\n---',
    '---\nname: second\ndescription: second\n---',
  ]) {
    const entry = new ZipPassThrough('SKILL.md')
    archive.add(entry)
    entry.push(strToU8(content), true)
  }
  archive.end()
  const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0))
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new File([bytes], 'duplicate-skill.zip', { type: 'application/zip' })
}

function makeApp() {
  const saved: BeeGameUserSkill[] = []
  return createBeeGameSkillsApp({
    requireRequestUser: false,
    resolveRequestUser: async () => ({ id: 'user-1' }),
    getCurrentUser: () => ({ id: 'user-1' }),
    hasPermission: () => true,
    repository: {
      listUserSkills: async () => saved,
      listEnabledUserSkills: async () => saved,
      importUserSkill: async (_userId, input) => {
        const skill = { id: 'skill-1', slug: 'route-skill', name: 'route-skill', description: 'route test', enabled: true, files: input.files, createdAt: '', updatedAt: '' }
        saved.push(skill)
        return skill
      },
      updateUserSkillEnabled: async () => saved[0]!,
      deleteUserSkill: async () => true,
    },
  })
}

function makeFailingApp(failure: 'list' | 'enable' | 'delete') {
  return createBeeGameSkillsApp({
    requireRequestUser: false,
    resolveRequestUser: async () => ({ id: 'user-1' }),
    getCurrentUser: () => ({ id: 'user-1' }),
    hasPermission: () => true,
    repository: {
      listUserSkills: async () => {
        if (failure === 'list') throw new Error('private list failure')
        return []
      },
      listEnabledUserSkills: async () => [],
      importUserSkill: async () => { throw new Error('unused') },
      updateUserSkillEnabled: async () => {
        if (failure === 'enable') throw new Error('private enable failure')
        throw new Error('unused')
      },
      deleteUserSkill: async () => {
        if (failure === 'delete') throw new Error('private delete failure')
        return false
      },
    },
  })
}

function makeFailingInternalApp() {
  return createBeeGameSkillsApp({
    requireRequestUser: false,
    resolveRequestUser: async () => ({ id: 'user-1' }),
    getCurrentUser: () => ({ id: 'user-1' }),
    hasPermission: () => true,
    serviceToken: 'service-secret',
    repository: {
      listUserSkills: async () => [],
      listEnabledUserSkills: async () => { throw new Error('private enabled-skills failure') },
      importUserSkill: async () => { throw new Error('unused') },
      updateUserSkillEnabled: async () => { throw new Error('unused') },
      deleteUserSkill: async () => false,
    },
  })
}

describe('BeeGame skill import routes', () => {
  test('checks skills permission before any repository call', async () => {
    let repositoryCalls = 0
    const app = createBeeGameSkillsApp({
      requireRequestUser: false,
      resolveRequestUser: async () => ({ id: 'viewer', role: 'viewer' }),
      getCurrentUser: () => ({ id: 'viewer', role: 'viewer' }),
      hasPermission: () => false,
      repository: {
        listUserSkills: async () => { repositoryCalls += 1; return [] },
        listEnabledUserSkills: async () => { repositoryCalls += 1; return [] },
        importUserSkill: async () => { repositoryCalls += 1; throw new Error('must not run') },
        updateUserSkillEnabled: async () => { repositoryCalls += 1; throw new Error('must not run') },
        deleteUserSkill: async () => { repositoryCalls += 1; return false },
      },
    })
    const response = await app.request('/api/user-skills')
    expect(response.status).toBe(403)
    expect(repositoryCalls).toBe(0)
  })

  test('fails closed for internal enabled skills when service token is absent', async () => {
    const app = makeApp()
    const response = await app.request('/api/internal/user-skills/enabled?userId=user-1')
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized', message: 'invalid service token' })
  })

  test('redacts and traces internal enabled-skills repository failures after service-token auth', async () => {
    const response = await makeFailingInternalApp().request('/api/internal/user-skills/enabled?userId=user-1', {
      headers: { authorization: 'Bearer service-secret' },
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: 'Request failed', traceId: expect.any(String) })
    expect(JSON.stringify(body)).not.toContain('private enabled-skills failure')
  })

  test.each([
    ['list', '/api/user-skills', undefined],
    ['enable', '/api/user-skills/skill-1/enabled', { method: 'PUT', body: '{}' }],
    ['delete', '/api/user-skills/skill-1', { method: 'DELETE' }],
  ] as const)('returns a traced generic error for unexpected %s failures', async (failure, path, init) => {
    const response = await makeFailingApp(failure).request(path, init)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Request failed', traceId: expect.any(String) })
  })
  test('rejects traversal before repository import', async () => {
    const app = makeApp()
    const body = new FormData()
    body.append('skill', skillZip({ 'SKILL.md': '---\nname: route-skill\ndescription: route test\n---', '../outside.md': 'bad' }))
    const response = await app.request('/api/user-skills/import', { method: 'POST', body })
    expect(response.status).toBe(400)
  })

  test('requires a zip upload', async () => {
    const app = makeApp()
    const body = new FormData()
    body.append('skill', new File(['text'], 'skill.txt', { type: 'text/plain' }))
    expect((await app.request('/api/user-skills/import', { method: 'POST', body })).status).toBe(400)
  })

  test('imports exactly one root skill file', async () => {
    const app = makeApp()
    const body = new FormData()
    body.append('skill', skillZip({ 'SKILL.md': '---\nname: route-skill\ndescription: route test\n---' }))
    expect((await app.request('/api/user-skills/import', { method: 'POST', body })).status).toBe(200)
  })

  test('returns a generic traced error and logs sanitized import details', async () => {
    const app = makeApp()
    const body = new FormData()
    const secretPath = '../private/secret.md'
    body.append('skill', skillZip({
      'SKILL.md': '---\nname: route-skill\ndescription: route test\n---',
      [secretPath]: 'payload-secret',
    }))
    const originalWarn = console.warn
    const warnings: unknown[] = []
    console.warn = (...args) => warnings.push(args)
    try {
      const response = await app.request('/api/user-skills/import', { method: 'POST', body })
      const payload = await response.json()
      expect(response.status).toBe(400)
      expect(payload).toEqual({ error: 'Skill import failed', traceId: expect.any(String) })
      expect(JSON.stringify(payload)).not.toContain(secretPath)
      expect(JSON.stringify(warnings)).not.toContain(secretPath)
      expect(JSON.stringify(warnings)).not.toContain('payload-secret')
      expect(JSON.stringify(warnings)).toContain(payload.traceId)
    } finally {
      console.warn = originalWarn
    }
  })

  test('rejects oversized multipart input before parsing it', async () => {
    const app = makeApp()
    const response = await app.request('/api/user-skills/import', {
      method: 'POST',
      headers: { 'content-type': 'multipart/form-data; boundary=unused', 'content-length': String(13 * 1024 * 1024) },
      body: 'not-buffered',
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'Skill import failed', traceId: expect.any(String) })
  })

  test('rejects duplicate normalized ZIP entries before object-map collapse', async () => {
    const bytes = await duplicateSkillZip().arrayBuffer()
    expect(() => parseSkillZipPackage(bytes)).toThrow()
  })
})
