import { describe, expect, test } from 'bun:test'
import { strToU8, zipSync } from 'fflate'
import { createBeeGameSkillsApp } from './app'
import type { BeeGameUserSkill } from './types'

function skillZip(files: Record<string, string>): File {
  const archive = zipSync(Object.fromEntries(Object.entries(files).map(([path, value]) => [path, strToU8(value)])))
  return new File([new Blob([archive as unknown as BlobPart])], 'skill.zip', { type: 'application/zip' })
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

describe('BeeGame skill import routes', () => {
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
})
