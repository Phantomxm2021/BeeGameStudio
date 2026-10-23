import { describe, expect, it } from 'vitest'
import {
  captureWindowBounds,
  clampWindowBounds,
  isAllowedExternalUrl,
  isTrustedRendererUrl,
  parseOAuthCallbackUrl,
  sanitizeFileName,
} from './security'

describe('desktop security boundaries', () => {
  it('allows only credential-free HTTP(S) external URLs', () => {
    expect(isAllowedExternalUrl('https://example.com/help')).toBe(true)
    expect(isAllowedExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedExternalUrl('https://user:pass@example.com')).toBe(false)
    expect(isAllowedExternalUrl('file:///tmp/file')).toBe(false)
  })

  it('matches renderer origins exactly', () => {
    const origins = new Set(['https://app.example.com'])
    expect(isTrustedRendererUrl('https://app.example.com/path', origins)).toBe(
      true,
    )
    expect(isTrustedRendererUrl('https://evil.example.com/path', origins)).toBe(
      false,
    )
  })

  it('accepts only complete one-time OAuth callbacks', () => {
    expect(
      parseOAuthCallbackUrl(
        'beegame://oauth/callback?code=one-time&state=state',
      ),
    ).not.toBeNull()
    expect(
      parseOAuthCallbackUrl(
        'beegame://oauth/callback?error=access_denied&oauth_state=state',
      ),
    ).not.toBeNull()
    expect(
      parseOAuthCallbackUrl('beegame://oauth/callback?code=one-time'),
    ).toBeNull()
    expect(
      parseOAuthCallbackUrl(
        'beegame://oauth/callback?code=one-time&state=state#token',
      ),
    ).toBeNull()
    expect(
      parseOAuthCallbackUrl('https://app.example.com/callback?code=x&state=y'),
    ).toBeNull()
  })

  it('sanitizes save and download names', () => {
    expect(sanitizeFileName('../secret.txt')).toBe('.._secret.txt')
    expect(sanitizeFileName('')).toBe('download')
  })

  it('clamps saved bounds fully inside the selected work area', () => {
    expect(
      clampWindowBounds({ x: 1800, y: -500, width: 1600, height: 1000 }, [
        { x: 0, y: 0, width: 1440, height: 860 },
        { x: 1440, y: 0, width: 1920, height: 1080 },
      ]),
    ).toEqual({ x: 1760, y: 0, width: 1600, height: 1000 })
  })

  it('does not read bounds from a destroyed window', () => {
    const getBounds = () => {
      throw new Error('destroyed')
    }
    expect(
      captureWindowBounds({ isDestroyed: () => true, getBounds }),
    ).toBeNull()
    expect(
      captureWindowBounds({ isDestroyed: () => false, getBounds }),
    ).toBeNull()
  })
})
