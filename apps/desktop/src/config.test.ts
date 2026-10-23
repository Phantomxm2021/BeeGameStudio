import { describe, expect, it, vi } from 'vitest'
import { getTrustedOrigins } from './config'

describe('desktop renderer trust configuration', () => {
  it('trusts only the configured renderer origin', () => {
    vi.stubEnv(
      'BEEGAME_DESKTOP_TRUSTED_ORIGINS',
      'https://unverified.example.com',
    )
    expect(getTrustedOrigins('https://app.example.com/path')).toEqual(
      new Set(['https://app.example.com']),
    )
  })
})
