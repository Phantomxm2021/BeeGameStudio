const MAX_EXTERNAL_URL_LENGTH = 4096
const MAX_FILENAME_LENGTH = 180

export type WindowWorkArea = {
  x: number
  y: number
  width: number
  height: number
}

export type WindowBounds = WindowWorkArea

export function isAllowedExternalUrl(value: string): boolean {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_EXTERNAL_URL_LENGTH
  )
    return false
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    )
  } catch {
    return false
  }
}

export function isTrustedRendererUrl(
  value: string,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  try {
    const url = new URL(value)
    return trustedOrigins.has(url.origin)
  } catch {
    return false
  }
}

export function parseOAuthCallbackUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'beegame:' ||
      url.hostname !== 'oauth' ||
      url.pathname !== '/callback'
    )
      return null
    if (
      url.hash ||
      !(url.searchParams.get('code') || url.searchParams.get('error')) ||
      !(url.searchParams.get('state') || url.searchParams.get('oauth_state'))
    )
      return null
    return url
  } catch {
    return null
  }
}

export function clampWindowBounds(
  candidate: WindowBounds,
  workAreas: readonly WindowWorkArea[],
): WindowBounds | null {
  if (
    !workAreas.length ||
    ![candidate.x, candidate.y, candidate.width, candidate.height].every(
      Number.isFinite,
    )
  )
    return null
  const centerX = candidate.x + candidate.width / 2
  const centerY = candidate.y + candidate.height / 2
  const display =
    workAreas.find(
      area =>
        centerX >= area.x &&
        centerX <= area.x + area.width &&
        centerY >= area.y &&
        centerY <= area.y + area.height,
    ) ?? workAreas[0]
  const width = Math.min(candidate.width, display.width)
  const height = Math.min(candidate.height, display.height)
  return {
    x: Math.min(
      Math.max(candidate.x, display.x),
      display.x + display.width - width,
    ),
    y: Math.min(
      Math.max(candidate.y, display.y),
      display.y + display.height - height,
    ),
    width,
    height,
  }
}

export function captureWindowBounds(window: {
  isDestroyed: () => boolean
  getBounds: () => WindowBounds
}): WindowBounds | null {
  if (window.isDestroyed()) return null
  try {
    return window.getBounds()
  } catch {
    return null
  }
}

export function sanitizeFileName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .split('')
    .map(character => (character.charCodeAt(0) < 32 ? '_' : character))
    .join('')
    .replace(/^\.+$/, '_')
  return (normalized || 'download').slice(0, MAX_FILENAME_LENGTH)
}
