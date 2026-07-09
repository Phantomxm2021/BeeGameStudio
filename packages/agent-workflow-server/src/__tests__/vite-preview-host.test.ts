import { describe, expect, test } from 'bun:test'
import { stripViteClientScript } from '../beegame/vite-preview-host'

describe('managed Vite preview host', () => {
  test('removes the HMR client script when managed HMR is disabled', () => {
    const html = '<head><script type="module" src="/previews/session/@vite/client"></script></head>'

    expect(stripViteClientScript(html, '/previews/session/')).toBe('<head></head>')
  })
})
