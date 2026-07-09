import { describe, expect, test } from 'bun:test'
import { PreviewAccessManager } from '../beegame/preview-access-manager'

describe('PreviewAccessManager', () => {
  test('consumes a grant once and creates a session for its user and preview generation', () => {
    let id = 0
    const manager = new PreviewAccessManager({
      now: () => new Date('2026-07-10T00:00:00.000Z'),
      randomId: () => `opaque-${++id}`,
    })
    const grant = manager.issue({
      userId: 'owner-a',
      projectId: 'project-a',
      sessionId: 'session-a',
      generation: 3,
    })

    const access = manager.consumeGrant(grant.token, {
      sessionId: 'session-a',
      generation: 3,
    })

    expect(access).toMatchObject({
      userId: 'owner-a',
      projectId: 'project-a',
      sessionId: 'session-a',
      generation: 3,
    })
    expect(manager.consumeGrant(grant.token, {
      sessionId: 'session-a',
      generation: 3,
    })).toBeUndefined()
  })

  test('rejects expired and revoked browser sessions', () => {
    let now = new Date('2026-07-10T00:00:00.000Z')
    const manager = new PreviewAccessManager({
      now: () => now,
      randomId: () => crypto.randomUUID(),
      ttlMs: 1_000,
    })
    const grant = manager.issue({
      userId: 'owner-a',
      projectId: 'project-a',
      sessionId: 'session-a',
      generation: 3,
    })
    const access = manager.consumeGrant(grant.token, {
      sessionId: 'session-a',
      generation: 3,
    })

    now = new Date('2026-07-10T00:00:02.000Z')
    expect(manager.authorize(access?.token, {
      sessionId: 'session-a',
      generation: 3,
    })).toBeUndefined()

    const freshGrant = manager.issue({
      userId: 'owner-a',
      projectId: 'project-a',
      sessionId: 'session-a',
      generation: 3,
    })
    const freshAccess = manager.consumeGrant(freshGrant.token, {
      sessionId: 'session-a',
      generation: 3,
    })
    manager.revoke('session-a')

    expect(manager.authorize(freshAccess?.token, {
      sessionId: 'session-a',
      generation: 3,
    })).toBeUndefined()
  })
})
