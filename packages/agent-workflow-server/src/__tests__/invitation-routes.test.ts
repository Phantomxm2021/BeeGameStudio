import { describe, expect, test } from 'bun:test'
import { createAgentWorkflowApp } from '../app'
import type { InvitationService } from '../invitation-service'

function createFakeInvitationService(
  observedTokens: string[] = [],
): InvitationService {
  const record = {
    id: 'invitation-1',
    code: 'BEE-ALPHA',
    label: 'Alpha',
    enabled: true,
    maxUses: 3,
    usedCount: 0,
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  }
  return {
    getPublicSettings: async () => ({ required: true }),
    validateCode: async code => code === 'BEE-ALPHA',
    list: async token => {
      observedTokens.push(token)
      return [record]
    },
    saveSettings: async (_token, required) => ({ required }),
    create: async () => record,
    update: async () => record,
    delete: async () => true,
  }
}

describe('invitation routes', () => {
  test('keeps public registration checks available without authentication', async () => {
    const app = createAgentWorkflowApp({
      currentUserResolver: async () => undefined,
      invitationService: createFakeInvitationService(),
    })

    const settings = await app.request('/api/invitations/settings')
    const validation = await app.request('/api/invitations/validate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'BEE-ALPHA' }),
    })

    expect(settings.status).toBe(200)
    expect(await settings.json()).toEqual({ required: true })
    expect(validation.status).toBe(200)
    expect(await validation.json()).toEqual({ valid: true })
  })

  test('passes the authenticated owner token to invitation administration', async () => {
    const observedTokens: string[] = []
    const app = createAgentWorkflowApp({
      currentUser: { id: 'owner-1', role: 'owner' },
      invitationService: createFakeInvitationService(observedTokens),
    })

    const response = await app.request('/api/admin/invitations', {
      headers: { authorization: 'Bearer owner-access-token' },
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toHaveLength(1)
    expect(observedTokens).toEqual(['owner-access-token'])
  })

  test('rejects invitation administration without owner permission', async () => {
    const app = createAgentWorkflowApp({
      currentUser: { id: 'developer-1', role: 'developer' },
      invitationService: createFakeInvitationService(),
    })

    const response = await app.request('/api/admin/invitations', {
      headers: { authorization: 'Bearer developer-access-token' },
    })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'Forbidden' })
  })
})
