import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  getConfirmedBriefEvidence,
  recordConfirmedBriefEvidence,
} from './confirmed-brief-evidence'

describe('confirmed brief evidence', () => {
  let dataRoot = ''

  afterEach(async () => {
    if (dataRoot) await rm(dataRoot, { recursive: true, force: true })
  })

  test('persists only canonical user-confirmed policy and language facts', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'confirmed-brief-'))
    recordConfirmedBriefEvidence({
      dataRoot,
      sessionId: 'session-a',
      confirmedBriefContext: JSON.stringify({
        kind: 'confirmed_build_brief',
        resource_library_usage: 'preferred',
        document_language: 'zh',
        game_user_visible_language: 'zh',
        agent_response_language: 'zh',
      }),
      createdAt: new Date('2026-07-21T00:00:00.000Z'),
    })

    expect(getConfirmedBriefEvidence({ dataRoot, sessionId: 'session-a' })).toEqual({
      version: 1,
      sessionId: 'session-a',
      contextDigest: expect.any(String),
      resourceLibraryUsage: 'preferred',
      documentLanguage: 'zh',
      gameUserVisibleLanguage: 'zh',
      agentResponseLanguage: 'zh',
      createdAt: '2026-07-21T00:00:00.000Z',
    })
  })

  test('rejects a non-canonical or policy-free context', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'confirmed-brief-'))
    expect(() => recordConfirmedBriefEvidence({
      dataRoot,
      sessionId: 'session-a',
      confirmedBriefContext: JSON.stringify({ kind: 'summary' }),
      createdAt: new Date(),
    })).toThrow('invalid kind')
  })

  test('rejects canonical-looking evidence when any explicit language policy is missing', async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'confirmed-brief-'))
    expect(() => recordConfirmedBriefEvidence({
      dataRoot,
      sessionId: 'session-a',
      confirmedBriefContext: JSON.stringify({
        kind: 'confirmed_build_brief',
        resource_library_usage: 'preferred',
        document_language: 'zh',
        game_user_visible_language: 'zh',
      }),
      createdAt: new Date(),
    })).toThrow('explicit response, document, and player-visible languages')
  })
})
