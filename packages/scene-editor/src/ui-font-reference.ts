/** Explicit members must never silently fall back to a resource's default face. */
export function uiFontKey(font: unknown): string | undefined {
  if (!font || typeof font !== 'object') return undefined
  const { assetRef, member } = font as { assetRef?: unknown; member?: unknown }
  if (typeof assetRef !== 'string' || !assetRef) return undefined
  return typeof member === 'string' && member ? JSON.stringify([assetRef, member]) : assetRef
}
