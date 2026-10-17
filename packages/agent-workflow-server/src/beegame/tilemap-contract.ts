/** Filesystem validation of authored TileSet data. No game loading or rendering. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute, basename, extname } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { readBeeGameAssetManifestSync } from './asset-contracts'
import { parseTileSet, type TileDefinition } from '../../../scene-editor/src/tilemap-data'
import { parseSpriteSheet, atlasFrameName, spriteSheetSelection } from '../../../scene-editor/src/sprite-sheet'

/** Per inspection call, shared by standalone Scenes and UI-linked framing. */
export function createSceneTileSetResolver(workspace: string) {
  const cache = new Map<string, ReturnType<typeof readTileSetResource>>()
  return (id: string, member?: string) => {
    if (!existsSync(resolve(workspace, 'assets/asset-manifest.json'))) return undefined
    const manifest = readBeeGameAssetManifestSync(workspace)
    if (!manifest.resources.some(resource => resource.id === id && resource.status === 'verified')) return undefined
    const key = JSON.stringify([id, member])
    if (!cache.has(key)) cache.set(key, readTileSetResource(workspace, manifest, id, member))
    return cache.get(key)
  }
}

/** Resolve exact registered identities, never choose a similar name or the
 * first of several files. Binding reuses the registered-file and atlas readers. */
export function validateResourceSelections(workspace: string, manifest: BeeGameAssetManifest, value: unknown, issues: string[], location = 'data') {
  if (Array.isArray(value)) { value.forEach((item, i) => validateResourceSelections(workspace, manifest, item, issues, `${location}[${i}]`)); return }
  if (!value || typeof value !== 'object') return
  const record = value as Record<string, any>
  if (typeof record.assetRef === 'string') {
    try {
      const resource = manifest.resources.find(r => r.id === record.assetRef)
      if (!resource) throw Error('Unknown resource ' + record.assetRef)
      const fields = { ...record, ...(record.data && typeof record.data === 'object' ? record.data : {}) }
      const member = (name?: string) => {
        if (!name) return resource.root_path
        if (resource.file_paths.includes(name)) return name
        const matches = resource.file_paths.filter(path => basename(path, extname(path)) === name)
        if (matches.length !== 1) throw Error(`Missing or ambiguous member ${record.assetRef}/${name}; specify a registered file path`)
        return matches[0]!
      }
      const selected = member(fields.member)
      readRegisteredResourceFile(workspace, manifest, record.assetRef, selected)
      if (fields.atlasMember || fields.frame) {
        const tablePath = fields.atlasMember ? member(fields.atlasMember)
          : resource.file_paths.find(path => path === selected.replace(/\.[^.]+$/, '.json'))
        if (!tablePath) throw Error(`No registered atlas metadata for ${record.assetRef}/${selected}`)
        const sheet = parseSpriteSheet(JSON.parse(readRegisteredResourceFile(workspace, manifest, record.assetRef, tablePath).bytes.toString()))
        if (!sheet) throw Error('Unsupported atlas metadata: ' + tablePath)
        if (typeof fields.frame === 'string') {
          if (!('frames' in sheet)) {
            const names = sheet.states ?? sheet.facings ?? []
            const normalized = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
            if (!names.some(name => normalized(name) === normalized(fields.frame))) throw Error('Unknown atlas frame ' + fields.frame)
          }
          spriteSheetSelection(sheet, fields)
        }
      }
    } catch (error) { issues.push(location + ': ' + (error instanceof Error ? error.message : String(error))) }
  }
  for (const [key, item] of Object.entries(record)) validateResourceSelections(workspace, manifest, item, issues, `${location}.${key}`)
}

export function readRegisteredResourceFile(workspace: string, manifest: BeeGameAssetManifest, id: string, member?: string) {
  const resource = manifest.resources.find(resource => resource.id === id)
  if (!resource || resource.status !== 'verified') throw Error(`Missing verified resource ${id}`)
  const path = member ?? resource.root_path
  if (!resource.file_paths.includes(path)) throw Error(`Resource ${id}: unregistered file ${path}`)
  const root = realpathSync(workspace), absolute = realpathSync(resolve(root, path))
  const local = relative(root, absolute)
  if (isAbsolute(local) || local === '..' || local.startsWith('../')) throw Error(`Resource ${id}: path escapes project`)
  return { path, bytes: readFileSync(absolute) }
}

export function validateTileSprite(workspace: string, manifest: BeeGameAssetManifest, tile: TileDefinition, files = new Map<string, ReturnType<typeof readRegisteredResourceFile>>()) {
  const read = (id: string, path: string) => {
    const key = JSON.stringify([id,path])
    let file = files.get(key)
    if (!file) { file = readRegisteredResourceFile(workspace,manifest,id,path); files.set(key,file) }
    return file
  }
  const { assetRef, member, atlasMember, frame } = tile.sprite
  const image = read(assetRef, member)
  if (!/\.(png|webp|jpe?g|gif|avif)$/i.test(member)) throw Error(`Tile sprite is not an image: ${member}`)
  if (!atlasMember) return
  const table = read(assetRef, atlasMember)
  const sheet = parseSpriteSheet(JSON.parse(table.bytes.toString('utf8')))
  const region = sheet && 'frames' in sheet ? sheet.frames[atlasFrameName(frame!)] : undefined
  if (!region) throw Error(`Missing named atlas frame ${assetRef}/${atlasMember}#${frame}`)
  // PNG headers can be checked without a decoder/process; all formats are also
  // checked against the decoded image by the editor before drawing.
  if (image.bytes.length >= 24 && image.bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    if (region.x + region.width > image.bytes.readUInt32BE(16) || region.y + region.height > image.bytes.readUInt32BE(20))
      throw Error(`Atlas frame outside image: ${frame}`)
  }
}

export function readTileSetResource(workspace: string, manifest: BeeGameAssetManifest, assetRef: string, member?: string) {
  const file = readRegisteredResourceFile(workspace, manifest, assetRef, member)
  const tileset = parseTileSet(JSON.parse(file.bytes.toString('utf8')))
  const files = new Map<string, ReturnType<typeof readRegisteredResourceFile>>()
  for (const [id, tile] of Object.entries(tileset.tiles)) {
    try { validateTileSprite(workspace, manifest, tile, files) }
    catch (error) { throw Error(`TileSet ${assetRef}, tile ${id}: ${String(error)}`) }
  }
  return tileset
}
