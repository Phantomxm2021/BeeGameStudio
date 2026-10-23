export type NavigationAction = 'orbit' | 'pan' | 'dolly' | 'look'

export type NavigationPointer = {
  button: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
}

/** Unity Scene View pointer mapping. Platform-specific branches only cover
 * the single-button macOS alternatives documented by Unity. */
export function resolveUnityNavigationAction(
  event: NavigationPointer,
  options: { viewMode: '2d' | '3d'; handMode: boolean; apple: boolean },
): NavigationAction | null {
  if (event.button === 1) return 'pan'
  if (event.button === 2) {
    if (event.altKey) return 'dolly'
    return options.viewMode === '3d' ? 'look' : 'pan'
  }
  if (event.button !== 0) return null
  if (event.altKey) {
    if (options.apple && event.ctrlKey) return 'dolly'
    if ((options.apple && event.metaKey) || (!options.apple && event.ctrlKey)) return 'pan'
    return options.viewMode === '3d' ? 'orbit' : null
  }
  return options.handMode ? 'pan' : null
}

export function isApplePlatform(navigatorLike: Pick<Navigator, 'platform' | 'userAgent'>): boolean {
  return /Mac|iPhone|iPad|iPod/i.test(`${navigatorLike.platform} ${navigatorLike.userAgent}`)
}

export function wheelPixels(event: Pick<WheelEvent, 'deltaY' | 'deltaMode'>, pageHeight: number): number {
  if (event.deltaMode === 1) return event.deltaY * 16
  if (event.deltaMode === 2) return event.deltaY * pageHeight
  return event.deltaY
}
