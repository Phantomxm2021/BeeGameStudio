import { describe, expect, test } from 'bun:test'
import { createManagedVitePreviewPlugin, rewriteRootStaticAssetRequest, stripViteClientScript } from '../beegame/vite-preview-host'

describe('managed Vite preview host', () => {
  test('removes the HMR client script when managed HMR is disabled', () => {
    const html = '<head><script type="module" src="/previews/session/@vite/client"></script></head>'

    expect(stripViteClientScript(html, '/previews/session/')).toBe('<head></head>')
  })

  test('maps root-relative static files to the managed session base', () => {
    expect(rewriteRootStaticAssetRequest('/assets/models/hero.glb', '/previews/session/'))
      .toBe('/previews/session/assets/models/hero.glb')
    expect(rewriteRootStaticAssetRequest('/audio/sfx/fire.ogg?cache=1', '/previews/session/'))
      .toBe('/previews/session/audio/sfx/fire.ogg?cache=1')
  })

  test('does not rewrite API or client routes', () => {
    expect(rewriteRootStaticAssetRequest('/api/projects', '/previews/session/')).toBe('/api/projects')
    expect(rewriteRootStaticAssetRequest('/game', '/previews/session/')).toBe('/game')
    expect(rewriteRootStaticAssetRequest('/previews/session/assets/main.js', '/previews/session/'))
      .toBe('/previews/session/assets/main.js')
  })

  test('installs the root-static compatibility middleware before Vite serves files', () => {
    let middleware: ((request: { url?: string }, response: unknown, next: () => void) => void) | undefined
    createManagedVitePreviewPlugin('/previews/session/').configureServer({
      middlewares: { use: handler => { middleware = handler } },
    })
    const request = { url: '/assets/models/hero.glb' }
    let didContinue = false
    middleware?.(request, {}, () => { didContinue = true })

    expect(request.url).toBe('/previews/session/assets/models/hero.glb')
    expect(didContinue).toBe(true)
  })
})
