import { describe,it,expect } from 'vitest'
import { cellAt,cellLine,boxCells,paintCells } from '../src/tilemap-paint'
import type { GridData } from '../src/tilemap-data'

const grid:GridData={schema:'grid.v1',cellSize:[32,16],cellGap:[2,4]}
describe('Tilemap brush cell operations',()=>{
  it('maps negative coordinates and ignores the gap between cells',()=>{
    expect(cellAt(grid,-3,-5)).toEqual({x:-1,y:-1})
    expect(cellAt(grid,34,20)).toEqual({x:1,y:1})
    expect(cellAt(grid,33,1)).toBeNull()
    expect(cellAt(grid,1,18)).toBeNull()
    expect(cellAt(grid,Infinity,0)).toBeNull()
  })
  it('bridges fast pointer moves in both directions without gaps',()=>{
    const line=cellLine({x:-2,y:0},{x:4,y:3})
    expect(line).toHaveLength(7)
    expect(line[0]).toEqual({x:-2,y:0})
    expect(line.at(-1)).toEqual({x:4,y:3})
    for(let i=1;i<line.length;i++) expect(Math.max(Math.abs(line[i].x-line[i-1].x),Math.abs(line[i].y-line[i-1].y))).toBe(1)
    expect(cellLine({x:3,y:0},{x:0,y:0})).toEqual([{x:3,y:0},{x:2,y:0},{x:1,y:0},{x:0,y:0}])
  })
  it('box fill includes both ends regardless of drag direction',()=>{
    expect(boxCells({x:2,y:1},{x:0,y:0})).toEqual([{x:0,y:0},{x:1,y:0},{x:2,y:0},{x:0,y:1},{x:1,y:1},{x:2,y:1}])
    expect(()=>boxCells({x:0,y:0},{x:100000,y:1})).toThrow('too large')
  })
  it('overwrites and erases sparse cells without mutating the original',()=>{
    const base=[{x:0,y:0,tileId:'old'}]
    const painted=paintCells(base,cellLine({x:0,y:0},{x:3,y:0}),'new')
    expect(painted).toHaveLength(4)
    expect(painted.every(c=>c.tileId==='new')).toBe(true)
    expect(paintCells(painted,[{x:1,y:0},{x:2,y:0}],null)).toEqual([{x:0,y:0,tileId:'new'},{x:3,y:0,tileId:'new'}])
    expect(base).toEqual([{x:0,y:0,tileId:'old'}])
  })
})
