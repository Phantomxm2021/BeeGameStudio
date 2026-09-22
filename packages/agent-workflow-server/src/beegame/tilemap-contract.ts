/** Filesystem validation of authored TileSet data. No game loading or rendering. */
import { readFileSync, realpathSync } from 'node:fs'
import { resolve, relative, isAbsolute } from 'node:path'
import type { BeeGameAssetManifest } from './asset-contracts'
import { parseTileSet, type TileDefinition } from '../../../scene-editor/src/tilemap-data'
import { parseSpriteSheet, atlasFrameName } from '../../../scene-editor/src/sprite-sheet'

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
