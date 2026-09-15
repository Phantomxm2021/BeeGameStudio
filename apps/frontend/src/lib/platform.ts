export type DesktopOAuthCallbackHandler = (
  callbackUrl: string,
) => void | Promise<void>

export type BeeGameDesktopBridge = {
  readonly isDesktop: true
  openExternal: (url: string) => Promise<void>
  onOAuthCallback: (handler: DesktopOAuthCallbackHandler) => () => void
}

declare global {
  interface Window {
    beeGameDesktop?: BeeGameDesktopBridge
  }
}

export function isDesktopShell(): boolean {
  return (
    typeof window !== 'undefined' && window.beeGameDesktop?.isDesktop === true
  )
}

export function getOAuthRedirectUri(): string {
  const configured = String(
    import.meta.env.VITE_BEEGAME_DESKTOP_OAUTH_REDIRECT_URI ?? '',
  ).trim()
  if (isDesktopShell()) return configured || 'beegame://oauth/callback'
  return typeof window === 'undefined' ? '' : window.location.origin
}

export async function openExternal(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('Only HTTP(S) external links can be opened.')
  }
  if (isDesktopShell()) {
    await window.beeGameDesktop!.openExternal(parsed.toString())
    return
  }
  window.open(parsed.toString(), '_blank', 'noopener,noreferrer')
}

export function onDesktopOAuthCallback(
  handler: DesktopOAuthCallbackHandler,
): () => void {
  if (!isDesktopShell()) return () => undefined
  return window.beeGameDesktop!.onOAuthCallback(handler)
}
