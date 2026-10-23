import { afterEach, expect, it, vi } from 'vitest'
import { currentKeyboardLabels } from '../src/platform'

afterEach(() => vi.unstubAllGlobals())

it.each([
  [{ userAgentData: { platform: 'macOS' }, platform: 'Linux x86_64' }, '⌘', '↩'],
  [{ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }, 'Ctrl', 'F2'],
  [{ platform: 'Linux x86_64' }, 'Ctrl', 'F2'],
  [{ platform: '', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)' }, '⌘', '↩'],
])('detects platform from browser metadata with legacy fallback: %j', (navigatorLike, modifier, rename) => {
  vi.stubGlobal('navigator', navigatorLike)
  expect(currentKeyboardLabels()).toMatchObject({ modifier, rename })
})
