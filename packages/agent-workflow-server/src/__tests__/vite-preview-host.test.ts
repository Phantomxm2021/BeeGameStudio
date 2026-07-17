import { describe, expect, test } from 'bun:test'
import {
  createManagedVitePreviewPlugin,
  disableViteStyleHmr,
  rewriteRootStaticAssetRequest,
  stripViteClientScript,
} from '../beegame/vite-preview-host'

describe('managed Vite preview host', () => {
  test('removes the HMR client script when managed HMR is disabled', () => {
    const html = '<head><script type="module" src="/previews/session/@vite/client"></script></head>'

    expect(stripViteClientScript(html, '/previews/session/')).toBe('<head></head>')
  })

  test('removes the final Vite client tag regardless of attribute order and quoting', () => {
    const html = [
      '<head>',
      "<script crossorigin src = '/previews/session/@vite/client' type='module'></script>",
      '<script type="module" src="/previews/session/src/main.tsx"></script>',
      '</head>',
    ].join('')

    expect(stripViteClientScript(html, '/previews/session/')).toBe(
      '<head><script type="module" src="/previews/session/src/main.tsx"></script></head>',
    )
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

  test('removes the Vite client dependency from transformed style modules', () => {
    const clientImport = 'import { updateStyle as __vite__updateStyle, removeStyle as __vite__removeStyle } from "/previews/session/@vite/client"'
    const acceptExpression = 'import.meta.hot.accept()'
    const pruneExpression = 'import.meta.hot.prune(() => __vite__removeStyle(__vite__id))'
    const code = [
      clientImport,
      'const __vite__id = "/src/styles.css"',
      'const __vite__css = "body { color: white }"',
      '__vite__updateStyle(__vite__id, __vite__css)',
      acceptExpression,
      pruneExpression,
    ].join('\n')
    const acceptStart = code.indexOf(acceptExpression)
    const pruneStart = code.indexOf(pruneExpression)
    const transformed = disableViteStyleHmr(code, {
      body: [
        {
          type: 'ImportDeclaration',
          start: 0,
          end: clientImport.length,
          source: { value: '/previews/session/@vite/client' },
          specifiers: [
            { imported: { name: 'updateStyle' }, local: { name: '__vite__updateStyle' } },
            { imported: { name: 'removeStyle' }, local: { name: '__vite__removeStyle' } },
          ],
        },
        {
          type: 'ExpressionStatement',
          start: acceptStart,
          end: acceptStart + acceptExpression.length,
          expression: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'MemberExpression',
                object: {
                  type: 'MetaProperty',
                  meta: { name: 'import' },
                  property: { name: 'meta' },
                },
                property: { name: 'hot' },
              },
              property: { name: 'accept' },
            },
          },
        },
        {
          type: 'ExpressionStatement',
          start: pruneStart,
          end: pruneStart + pruneExpression.length,
          expression: {
            type: 'CallExpression',
            callee: {
              type: 'MemberExpression',
              object: {
                type: 'MemberExpression',
                object: {
                  type: 'MetaProperty',
                  meta: { name: 'import' },
                  property: { name: 'meta' },
                },
                property: { name: 'hot' },
              },
              property: { name: 'prune' },
            },
          },
        },
      ],
    })

    expect(transformed?.code).not.toContain('@vite/client')
    expect(transformed?.code).not.toContain('import.meta.hot')
    expect(transformed?.code).toContain('data-beegame-preview-style')
    expect(transformed?.code).toContain('body { color: white }')
  })
})
