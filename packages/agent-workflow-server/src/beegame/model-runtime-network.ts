import { getMacroDefines } from '../../../../scripts/defines'
import {
  createPinnedUndiciDispatcher,
  type ApprovedOutboundTarget,
  type PinnedUndiciTlsOptions,
} from '@bee-game-studio/security-core'

type PinnedRuntimeFetch = typeof fetch & { close(): Promise<void> }
type RuntimeDispatcher = {
  close?: () => Promise<void> | void
  destroy?: () => Promise<void> | void
}
type BeeGameMacroGlobals = {
  VERSION: string
  BUILD_TIME: string
  FEEDBACK_CHANNEL: string
  ISSUES_EXPLAINER: string
  NATIVE_PACKAGE_URL: string
  PACKAGE_URL: string
  VERSION_CHANGELOG: string
}

export function ensureBeeGameMacroGlobals(): void {
  const target = globalThis as typeof globalThis & {
    MACRO?: BeeGameMacroGlobals
  }
  if (target.MACRO) return
  target.MACRO = Object.fromEntries(
    Object.entries(getMacroDefines()).map(([key, value]) => [
      key.replace('MACRO.', ''),
      JSON.parse(value) as string,
    ]),
  ) as BeeGameMacroGlobals
}

export function createPinnedRuntimeFetch(
  baseFetch: typeof fetch,
  approvedOutboundTargets: Record<string, ApprovedOutboundTarget>,
  options: { tls?: PinnedUndiciTlsOptions } = {},
): PinnedRuntimeFetch {
  const dispatchers = new Map<
    string,
    ReturnType<typeof createPinnedUndiciDispatcher>
  >()
  for (const target of Object.values(approvedOutboundTargets)) {
    if (!target.trustedDevelopmentProxy && !dispatchers.has(target.url.origin))
      dispatchers.set(
        target.url.origin,
        createPinnedUndiciDispatcher(target, { tls: options.tls }),
      )
  }
  const approvedOrigins = new Map(
    Object.values(approvedOutboundTargets).map(target => [
      target.url.origin,
      target,
    ]),
  )
  const pinnedFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const parsed = parseUrl(url)
    const approvedTarget = parsed ? approvedOrigins.get(parsed.origin) : undefined
    const dispatcher = parsed ? dispatchers.get(parsed.origin) : undefined
    if (
      parsed &&
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !approvedTarget
    )
      throw new Error('Outbound URL is not permitted')
    return dispatcher
      ? baseFetch(input, { ...init, redirect: 'error', dispatcher } as RequestInit)
      : approvedTarget
        ? baseFetch(input, { ...init, redirect: 'error' })
        : baseFetch(input, init)
  }) as PinnedRuntimeFetch
  pinnedFetch.close = async () => {
    await Promise.all([...dispatchers.values()].map(closeRuntimeDispatcher))
  }
  return pinnedFetch
}

async function closeRuntimeDispatcher(
  dispatcher: RuntimeDispatcher,
): Promise<void> {
  if (typeof dispatcher.close === 'function') await dispatcher.close()
  else if (typeof dispatcher.destroy === 'function') await dispatcher.destroy()
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value)
  } catch {
    return undefined
  }
}
