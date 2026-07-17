import { describe, expect, test } from 'bun:test'
import { createPreviewCapabilityManager } from '../auth/preview-capability'

describe('preview capability', () => {
  test('issues an HttpOnly cookie scoped to one preview session', () => {
    const manager = createPreviewCapabilityManager()
    const cookie = manager.issueCookie(
      new Request('http://127.0.0.1:62174/api/projects/project-1/preview'),
      'session/with spaces',
      'user-1',
    )

    expect(cookie).toContain('beegame_preview_capability=')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/previews/session%2Fwith%20spaces/')
    expect(cookie).not.toContain('Secure')
  })

  test('accepts only an untampered capability for the active session', () => {
    const manager = createPreviewCapabilityManager()
    const setCookie = manager.issueCookie(
      new Request('https://studio.example/api/projects/project-1/preview'),
      'session-1',
      'user-1',
    )
    expect(setCookie).toContain('Secure')
    const cookie = setCookie.split(';', 1)[0]
    const request = new Request('https://studio.example/previews/session-1/', {
      headers: { cookie },
    })
    const capabilityUrl = manager.issueUrl(
      '/previews/session-1/?__beegame_preview_refresh=1',
      'session-1',
      'user-1',
    )
    const sandboxedNavigation = new Request(`https://studio.example${capabilityUrl}`, {
      headers: {
        origin: 'null',
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
      },
    })

    expect(manager.verifyRequest(request, 'session-1')).toEqual({ userId: 'user-1' })
    expect(manager.verifyRequest(sandboxedNavigation, 'session-1')).toEqual({ userId: 'user-1' })
    expect(manager.verifyRequest(request, 'session-2')).toBeUndefined()
    expect(capabilityUrl).toContain('__beegame_preview_refresh=1')
    expect(capabilityUrl).toContain('__beegame_preview_capability=')

    const tampered = new Request(request.url, {
      headers: { cookie: `${cookie}x` },
    })
    expect(manager.verifyRequest(tampered, 'session-1')).toBeUndefined()

    const moduleRequest = new Request(
      'https://studio.example/previews/session-1/src/main.tsx',
      {
        headers: {
          origin: 'null',
          'sec-fetch-dest': 'script',
          'sec-fetch-mode': 'cors',
        },
      },
    )
    expect(manager.allowsSandboxedSubresource(moduleRequest, 'session-1')).toBe(true)
    expect(manager.allowsSandboxedSubresource(moduleRequest, 'session-2')).toBe(false)

    const navigationRequest = new Request(moduleRequest.url, {
      headers: {
        origin: 'null',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
      },
    })
    expect(manager.allowsSandboxedSubresource(navigationRequest, 'session-1')).toBe(false)

    manager.revokeSession('session-1')
    expect(manager.verifyRequest(request, 'session-1')).toBeUndefined()
    expect(manager.verifyRequest(sandboxedNavigation, 'session-1')).toBeUndefined()
    expect(manager.allowsSandboxedSubresource(moduleRequest, 'session-1')).toBe(false)
  })
})
