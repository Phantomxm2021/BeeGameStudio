import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEV_RENDERER_URL, getRendererUrl, getTrustedOrigins } from './config'

afterEach(() => { vi.unstubAllEnvs() })

describe('desktop renderer trust configuration', () => {
  it('uses bundled content by default and keeps remote production URLs HTTPS-only', () => {
    vi.stubEnv('BEEGAME_DESKTOP_APP_URL', '')
    vi.stubEnv('VITE_BEEGAME_DESKTOP_APP_URL', '')
    expect(getRendererUrl(true)).toBe(DEV_RENDERER_URL)
    vi.stubEnv('BEEGAME_DESKTOP_APP_URL', 'https://app.example.com')
    expect(getRendererUrl(true)).toBe('https://app.example.com')
    vi.stubEnv('BEEGAME_DESKTOP_APP_URL', 'http://app.example.com')
    expect(() => getRendererUrl(true)).toThrow('must use HTTPS')
  })
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
