/** Data contract only. No renderer, networking, engine objects or game loop. */
export type Pair = [number, number]
export type GridData = { schema: 'grid.v1'; cellSize: Pair; cellGap?: Pair; enabled?: boolean }
export type TileCell = { x: number; y: number; tileId: string }
export type TilemapData = { schema: 'tilemap.v1'; gridNodeId: string; cells: TileCell[]; tileAnchor?: Pair; collisionEnabled?: boolean; member?: string; enabled?: boolean }
export type TilemapRendererData = { schema: 'tilemap-renderer.v1'; sortingOrder?: number; enabled?: boolean }
export type TileDefinition = {
  sprite: { assetRef: string; member: string; atlasMember?: string; frame?: string }
  size: Pair
  pivot?: Pair
  offset?: Pair
  collision?: { points: Pair[]; mode: 'solid' | 'trigger' | 'one-way'; normal?: Pair }
}
export type TileSetData = { schema: 'beegame-tileset.v1'; tiles: Record<string, TileDefinition> }

function object(value: unknown, keys: string[], path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(`${path}: expected object`)
  for (const key of Object.keys(value)) if (!keys.includes(key)) throw Error(`${path}.${key}: unknown field`)
  return value as Record<string, unknown>
}
function string(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()) throw Error(`${path}: expected non-empty trimmed string`)
}
function pair(value: unknown, path: string, range: 'finite' | 'positive' | 'nonnegative' | 'normalized' = 'finite'): asserts value is Pair {
  if (!Array.isArray(value) || value.length !== 2 || value.some(n => typeof n !== 'number' || !Number.isFinite(n) ||
    (range === 'positive' && n <= 0) || (range === 'nonnegative' && n < 0) || (range === 'normalized' && (n < 0 || n > 1))))
    throw Error(`${path}: expected ${range} [x,y]`)
}
function optionalBoolean(value: unknown, path: string) { if (value !== undefined && typeof value !== 'boolean') throw Error(`${path}: expected boolean`) }
function version(value: unknown, expected: string) { if (value !== expected) throw Error(`Expected schema ${expected}; legacy/unversioned Tilemap data is unsupported`) }
function member(value: unknown, path: string) {
  string(value, path)
  if (value.startsWith('/') || value.includes('\\') || value.includes(':') || value.split('/').some(part => !part || part === '..' || part === '.')) throw Error(`${path}: expected exact project-relative file path`)
}

export function parseGridData(value: unknown): GridData {
  const v = object(value, ['schema','cellSize','cellGap','enabled'], 'Grid')
  version(v.schema, 'grid.v1'); pair(v.cellSize, 'Grid.cellSize', 'positive')
  if (v.cellGap !== undefined) pair(v.cellGap, 'Grid.cellGap', 'nonnegative')
  optionalBoolean(v.enabled, 'Grid.enabled')
  return structuredClone(v) as GridData
}
export function parseTilemapData(value: unknown): TilemapData {
  const v = object(value, ['schema','gridNodeId','cells','tileAnchor','collisionEnabled','member','enabled'], 'Tilemap')
  version(v.schema, 'tilemap.v1'); string(v.gridNodeId, 'Tilemap.gridNodeId')
  if (!Array.isArray(v.cells)) throw Error('Tilemap.cells: expected array')
  const occupied = new Set<string>()
  v.cells.forEach((cell, i) => {
    const c = object(cell, ['x','y','tileId'], `Tilemap.cells[${i}]`)
    if (!Number.isSafeInteger(c.x) || !Number.isSafeInteger(c.y)) throw Error(`Tilemap.cells[${i}]: coordinates must be safe integers`)
    string(c.tileId, `Tilemap.cells[${i}].tileId`)
    const key = `${c.x},${c.y}`
    if (occupied.has(key)) throw Error(`Tilemap.cells[${i}]: duplicate cell ${key}`)
    occupied.add(key)
  })
  if (v.tileAnchor !== undefined) pair(v.tileAnchor, 'Tilemap.tileAnchor', 'normalized')
  if (v.member !== undefined) member(v.member, 'Tilemap.member')
  optionalBoolean(v.enabled, 'Tilemap.enabled'); optionalBoolean(v.collisionEnabled, 'Tilemap.collisionEnabled')
  return structuredClone(v) as TilemapData
}
export function parseTilemapRendererData(value: unknown): TilemapRendererData {
  const v = object(value, ['schema','sortingOrder','enabled'], 'TilemapRenderer')
  version(v.schema, 'tilemap-renderer.v1')
  if (v.sortingOrder !== undefined && !Number.isSafeInteger(v.sortingOrder)) throw Error('TilemapRenderer.sortingOrder: expected integer')
  optionalBoolean(v.enabled, 'TilemapRenderer.enabled')
  return structuredClone(v) as TilemapRendererData
}
export function parseTileSet(value: unknown): TileSetData {
  const v = object(value, ['schema','tiles'], 'TileSet')
  version(v.schema, 'beegame-tileset.v1')
  if (!v.tiles || typeof v.tiles !== 'object' || Array.isArray(v.tiles)) throw Error('TileSet.tiles: expected named tile definitions')
  for (const [id, value] of Object.entries(v.tiles)) {
    string(id, 'Tile ID')
    const path = `TileSet.tiles.${id}`
    const tile = object(value, ['sprite','size','pivot','offset','collision'], path)
    const sprite = object(tile.sprite, ['assetRef','member','atlasMember','frame'], `${path}.sprite`)
    string(sprite.assetRef, `${path}.sprite.assetRef`); member(sprite.member, `${path}.sprite.member`)
    if ((sprite.atlasMember === undefined) !== (sprite.frame === undefined)) throw Error(`${path}: atlasMember and frame must be specified together`)
    if (sprite.atlasMember !== undefined) { member(sprite.atlasMember, `${path}.sprite.atlasMember`); string(sprite.frame, `${path}.sprite.frame`) }
    pair(tile.size, `${path}.size`, 'positive')
    if (tile.pivot !== undefined) pair(tile.pivot, `${path}.pivot`, 'normalized')
    if (tile.offset !== undefined) pair(tile.offset, `${path}.offset`)
    if (tile.collision !== undefined) {
      const collision = object(tile.collision, ['points','mode','normal'], `${path}.collision`)
      if (!['solid','trigger','one-way'].includes(String(collision.mode))) throw Error(`${path}.collision.mode: unsupported`)
      if (!Array.isArray(collision.points) || collision.points.length < 3) throw Error(`${path}.collision.points: polygon requires at least 3 points`)
      collision.points.forEach((p, i) => pair(p, `${path}.collision.points[${i}]`))
      if (collision.mode === 'one-way') {
        pair(collision.normal, `${path}.collision.normal`)
        if (Math.hypot(...collision.normal) === 0) throw Error(`${path}.collision.normal: cannot be zero`)
      } else if (collision.normal !== undefined) throw Error(`${path}.collision.normal: only valid for one-way collision`)
    }
  }
  return structuredClone(v) as TileSetData
}

type DataNode = { id: string; parentId?: string | null; components?: { type: string; data?: Record<string, unknown> }[] }
export function validateTilemapGrid(nodes: readonly DataNode[], node: DataNode, map: TilemapData): void {
  const byId = new Map(nodes.map(n => [n.id, n]))
  const visited = new Set<string>()
  let current: DataNode | undefined = node
  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (current.id === map.gridNodeId) {
      const grid = current.components?.find(c => c.type === 'grid')
      if (!grid) throw Error(`Tilemap ${node.id}: ${map.gridNodeId} has no Grid`)
      parseGridData(grid.data)
      return
    }
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  throw Error(`Tilemap ${node.id}: Grid must be on this node or an ancestor`)
}

/** Logical-pixel geometry, independent of any engine; pivot is not node position. */
export function tileRect(grid: GridData, map: TilemapData, cell: TileCell, tile: TileDefinition) {
  const gap = grid.cellGap ?? [0,0], anchor = map.tileAnchor ?? [.5,.5], pivot = tile.pivot ?? [.5,.5], offset = tile.offset ?? [0,0]
  const x = cell.x * (grid.cellSize[0] + gap[0]) + grid.cellSize[0] * anchor[0] + offset[0]
  const y = cell.y * (grid.cellSize[1] + gap[1]) + grid.cellSize[1] * anchor[1] + offset[1]
  return { x: x - tile.size[0] * pivot[0], y: y - tile.size[1] * pivot[1], width: tile.size[0], height: tile.size[1], pivotPosition: [x,y] as Pair }
}
export function setTileCell(map: TilemapData, x: number, y: number, tileId: string | null): TilemapData {
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) throw Error('Cell coordinates must be safe integers')
  const cells = map.cells.filter(cell => cell.x !== x || cell.y !== y)
  if (tileId !== null) cells.push({ x, y, tileId })
  return parseTilemapData({ ...map, cells })
}
