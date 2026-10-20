/** Explicit members must never silently fall back to a resource's default face. */
export function uiFontKey(font: unknown): string | undefined {
  if (!font || typeof font !== 'object' || Array.isArray(font)) return undefined
  const { assetRef, member } = font as { assetRef?: unknown; member?: unknown }
  if (typeof assetRef !== 'string' || !assetRef.trim()) return undefined
  if (member !== undefined && (typeof member !== 'string' || !member.trim())) return undefined
  return typeof member === 'string' ? JSON.stringify([assetRef, member]) : assetRef
}
