import type { Browser, BrowserContext, BrowserContextOptions, Frame, FrameLocator, Page } from 'playwright-core'

export function resolvePreviewApi(apiUrl?: string): Promise<string>
export type PreviewRuntimeErrors = { pageErrors: number; consoleErrors: number; failedRequests: number; httpErrors: number }
export function withPreviewPage<T>(options: {
  apiUrl?: string
  mode?: 'development' | 'production'
  contextOptions?: BrowserContextOptions
  beforeNavigate?: (input: { page: Page; context: BrowserContext }) => void | Promise<void>
  runtimeErrorPolicy?: 'observe' | 'fail'
}, inspect: (input: {
  page: Page; frame: FrameLocator; gameFrame: Frame; context: BrowserContext; browser: Browser
  environment: unknown; runtimeErrors: PreviewRuntimeErrors
}) => T | Promise<T>): Promise<T>
export function checkNumericSamples(samples: unknown, bounds: { minimum?: number; maximum?: number }): {
  status: 'passed' | 'failed' | 'unverified'
  count: number
  observedMinimum?: number
  observedMaximum?: number
  violations: Array<{ index: number; value: number }>
  note: string
}
export function checkTextSeparation(gameFrame: Frame, selectors: string[]): Promise<{
  status: 'passed' | 'failed' | 'unverified'
  groups: Array<{ selector: string; elements: number; rects: Array<{ x: number; y: number; width: number; height: number }> }>
  overlaps: Array<{ first: string; second: string; width: number; height: number }>
  note: string
}>
