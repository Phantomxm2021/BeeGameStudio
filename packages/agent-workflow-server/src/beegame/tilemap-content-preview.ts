/** Offline diagnostic PNG only. Not a renderer for generated games. */
import sharp from 'sharp'
import type { BeeGameAssetManifest } from './asset-contracts'
import { readRegisteredResourceFile, readTileSetResource } from './tilemap-contract'
import { atlasFrameName, parseSpriteSheet } from '../../../scene-editor/src/sprite-sheet'
import { tileRect, type GridData, type TilemapData } from '../../../scene-editor/src/tilemap-data'
import { point2d, type Affine2D } from '../../../scene-editor/src/content-coordinates'

export async function tilemapContentOverlay(input: {
  workspacePath: string
  manifest: BeeGameAssetManifest
  assetRef: string
  grid: GridData
  map: TilemapData
  pose: Affine2D
  canvas: { width: number; height: number }
}): Promise<sharp.OverlayOptions | undefined> {
  const { workspacePath, manifest, grid, map, pose, canvas } = input
  const set = readTileSetResource(workspacePath, manifest, input.assetRef, map.member)
  const files = new Map<string, Buffer>()
  const read = (resource: string, member: string) => {
    const key = JSON.stringify([resource, member])
    let bytes = files.get(key)
    if (!bytes) {
      bytes = readRegisteredResourceFile(workspacePath, manifest, resource, member).bytes
      files.set(key, bytes)
    }
    return bytes
  }
  const definitions: string[] = [], instances: string[] = []
  const images = new Map<string, string>()
  for (const cell of [...map.cells].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const tile = set.tiles[cell.tileId]
    if (!tile) throw Error(`Missing tile ${cell.tileId}`)
    const rect = tileRect(grid, map, cell, tile)
    const corners = [[rect.x, rect.y], [rect.x + rect.width, rect.y], [rect.x, rect.y + rect.height], [rect.x + rect.width, rect.y + rect.height]]
      .map(([x, y]) => point2d(pose, x, y))
    if (Math.max(...corners.map(p => p[0])) <= 0 || Math.max(...corners.map(p => p[1])) <= 0 ||
      Math.min(...corners.map(p => p[0])) >= canvas.width || Math.min(...corners.map(p => p[1])) >= canvas.height) continue
    // Repeated cells share one embedded image; never decode/composite per cell.
    const key = JSON.stringify(tile.sprite)
    let id = images.get(key)
    if (!id) {
      id = `tile${images.size}`
      const { assetRef, member, atlasMember, frame } = tile.sprite
      let image = sharp(read(assetRef, member))
      if (atlasMember) {
        const sheet = parseSpriteSheet(JSON.parse(read(assetRef, atlasMember).toString('utf8')))
        const region = sheet && 'frames' in sheet ? sheet.frames[atlasFrameName(frame!)] : undefined
        if (!region) throw Error(`Missing tile atlas frame ${frame}`)
        image = image.extract({ left: region.x, top: region.y, width: region.width, height: region.height })
      }
      const bytes = await image.png().toBuffer()
      definitions.push(`<image id="${id}" width="1" height="1" preserveAspectRatio="none" xlink:href="data:image/png;base64,${bytes.toString('base64')}"/>`)
      images.set(key, id)
    }
    instances.push(`<use xlink:href="#${id}" transform="matrix(${rect.width} 0 0 ${rect.height} ${rect.x} ${rect.y})"/>`)
  }
  if (!instances.length) return undefined
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvas.width}" height="${canvas.height}"><defs>${definitions.join('')}</defs><g transform="matrix(${pose.join(' ')})">${instances.join('')}</g></svg>`
  return { input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: 0, blend: 'over' }
}
