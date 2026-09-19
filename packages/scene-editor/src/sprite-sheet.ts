import type { SpriteSheet, SpriteRendererComponent } from './model'

/** Normalize the two formats actually delivered by project resources: named
 * packed atlas frames and horizontal directional/state strips. */
function isStrip(value: unknown): value is Exclude<SpriteSheet, { frames: unknown }> {
  if (!value || typeof value !== 'object') return false
  const table = value as Record<string, unknown>
  const positive = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n > 0
  const names = (v: unknown) => v === undefined || (Array.isArray(v) && v.every(n => typeof n === 'string'))
  return positive(table.frameWidth) && positive(table.frameHeight)
    && names(table.states) && names(table.facings)
    && (table.framesPerFacing === undefined || positive(table.framesPerFacing))
    && (!Array.isArray(table.facings) || !table.facings.length || positive(table.framesPerFacing))
    && (table.frameDurationMs === undefined || (Array.isArray(table.frameDurationMs) && table.frameDurationMs.every(positive)))
}

export function parseSpriteSheet(value: unknown): SpriteSheet | undefined {
  if (isStrip(value)) return value
  if (!value || typeof value !== 'object' || !('frames' in value)) return undefined
  const source = (value as { frames: unknown }).frames
  const entries = Array.isArray(source) ? source.map(entry => [entry?.filename, entry] as const)
    : source && typeof source === 'object' ? Object.entries(source) : []
  if (!entries.length) throw new Error('Sprite atlas contains no frames')
  const frames: Extract<SpriteSheet, { frames: unknown }>['frames'] = {}
  for (const [filename, entry] of entries) {
    if (typeof filename !== 'string' || !entry || typeof entry !== 'object') throw new Error('Sprite atlas frame requires a filename and rectangle')
    const { frame, rotated, trimmed } = entry
    if (rotated || trimmed) throw new Error(`Sprite atlas frame ${filename}: rotated/trimmed frames are not supported`)
    if (!frame || ![frame.x, frame.y, frame.w, frame.h].every(Number.isFinite) || frame.x < 0 || frame.y < 0 || frame.w <= 0 || frame.h <= 0) throw new Error(`Invalid sprite atlas rectangle: ${filename}`)
    const name = atlasFrameName(filename)
    if (frames[name]) throw new Error(`Duplicate sprite atlas frame: ${name}`)
    frames[name] = { x: frame.x, y: frame.y, width: frame.w, height: frame.h }
  }
  return { frames }
}
export const atlasFrameName = (name: string) => name.replace(/\.(png|webp|jpe?g)$/i, '')

export function spriteSheetSelection(table: SpriteSheet | undefined, properties: Record<string, unknown> = {}): Pick<SpriteRendererComponent, 'frame' | 'animation'> {
  if (!table) return {}
  if ('frames' in table) {
    const name = typeof properties.frame === 'string' ? atlasFrameName(properties.frame) : Object.keys(table.frames)[0]
    if (!table.frames[name]) throw new Error(`Sprite atlas has no frame "${name}"`)
    return { frame: table.frames[name] }
  }
  const frame = { x: 0, y: 0, width: table.frameWidth, height: table.frameHeight }
  if (table.facings?.length && table.framesPerFacing) {
    const initialFacing = typeof properties.initialFacing === 'string' && table.facings.includes(properties.initialFacing) ? properties.initialFacing : table.facings[0]
    frame.x = table.facings.indexOf(initialFacing) * table.framesPerFacing * table.frameWidth
    return { frame, animation: { frameWidth: table.frameWidth, frameHeight: table.frameHeight, framesPerFacing: table.framesPerFacing,
      facings: table.facings, initialFacing, loop: true, ...(table.frameDurationMs ? { frameDurationMs: table.frameDurationMs } : {}) } }
  }
  if (table.states?.length && typeof properties.frame === 'string') {
    const normalize = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '')
    frame.x = Math.max(0, table.states.findIndex(state => normalize(state) === normalize(properties.frame as string))) * table.frameWidth
  }
  return { frame }
}
