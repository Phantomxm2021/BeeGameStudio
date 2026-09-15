const DEV_RENDERER_URL = 'http://127.0.0.1:62173'
declare const __BEEGAME_PACKAGED_APP_URL__: string

function requireHttpUrl(value: string, label: string): URL {
  const url = new URL(value)
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`${label} must use HTTP(S).`)
  return url
}

export function getRendererUrl(isPackaged: boolean): string {
  const configuredDevUrl = process.env.BEEGAME_DESKTOP_DEV_SERVER_URL?.trim()
  if (!isPackaged) {
    const url = requireHttpUrl(
      configuredDevUrl || DEV_RENDERER_URL,
      'BEEGAME_DESKTOP_DEV_SERVER_URL',
    )
    if (!['127.0.0.1', 'localhost'].includes(url.hostname))
      throw new Error('Desktop development renderer must use localhost.')
    return url.toString().replace(/\/$/, '')
  }

  const embedded =
    typeof __BEEGAME_PACKAGED_APP_URL__ === 'string'
      ? __BEEGAME_PACKAGED_APP_URL__.trim()
      : ''
  const configured =
    embedded ||
    process.env.BEEGAME_DESKTOP_APP_URL?.trim() ||
    process.env.VITE_BEEGAME_DESKTOP_APP_URL?.trim()
  if (!configured)
    throw new Error(
      'Set BEEGAME_DESKTOP_APP_URL to the trusted HTTPS renderer URL before packaging.',
    )
  const url = requireHttpUrl(configured, 'BEEGAME_DESKTOP_APP_URL')
  if (url.protocol !== 'https:')
    throw new Error('BEEGAME_DESKTOP_APP_URL must use HTTPS when packaged.')
  return url.toString().replace(/\/$/, '')
}

export function getTrustedOrigins(rendererUrl: string): Set<string> {
  return new Set<string>([new URL(rendererUrl).origin])
}

export { DEV_RENDERER_URL }
