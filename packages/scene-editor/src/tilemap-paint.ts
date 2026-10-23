import type { GridData, TileCell } from './tilemap-data'

export type TilePaintTool = 'paint' | 'erase' | 'pick' | 'box'
export type CellPoint = { x: number; y: number }

/** Input is Tilemap-local logical pixels, after inverse world transform. */
export function cellAt(grid: GridData, x: number, y: number): CellPoint | null {
  const sx=grid.cellSize[0]+(grid.cellGap?.[0] ?? 0), sy=grid.cellSize[1]+(grid.cellGap?.[1] ?? 0)
  const cx=Math.floor(x/sx), cy=Math.floor(y/sy)
  if(!Number.isSafeInteger(cx) || !Number.isSafeInteger(cy)) return null
  if(x-cx*sx >= grid.cellSize[0] || y-cy*sy >= grid.cellSize[1]) return null
  return {x:cx,y:cy}
}

/** Bresenham bridges fast pointer moves, so a stroke does not leave holes. */
export function cellLine(a: CellPoint, b: CellPoint): CellPoint[] {
  const cells:CellPoint[]=[]
  let x=a.x,y=a.y
  const dx=Math.abs(b.x-a.x),dy=-Math.abs(b.y-a.y),sx=a.x<b.x?1:-1,sy=a.y<b.y?1:-1
  let error=dx+dy
  for(;;){
    cells.push({x,y})
    if(x===b.x && y===b.y) return cells
    const twice=2*error
    if(twice>=dy){error+=dy;x+=sx}
    if(twice<=dx){error+=dx;y+=sy}
  }
}

// This protects the editor from accidental enormous drags while zoomed out.
// It is not a content limit or an Agent constraint.
export const MAX_PAINT_CELLS = 100_000
export function boxCells(a: CellPoint,b: CellPoint):CellPoint[]{
  const minX=Math.min(a.x,b.x),maxX=Math.max(a.x,b.x),minY=Math.min(a.y,b.y),maxY=Math.max(a.y,b.y)
  if((maxX-minX+1)*(maxY-minY+1)>MAX_PAINT_CELLS) throw Error('Brush area too large; zoom in or paint a smaller area')
  const cells:CellPoint[]=[]
  for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)cells.push({x,y})
  return cells
}
export function paintCells(base:readonly TileCell[], points:readonly CellPoint[], tileId:string|null):TileCell[]{
  const cells=new Map(base.map(c=>[`${c.x},${c.y}`,c]))
  for(const p of points){const key=`${p.x},${p.y}`;if(tileId===null) cells.delete(key); else cells.set(key,{...p,tileId})}
  return [...cells.values()]
}
