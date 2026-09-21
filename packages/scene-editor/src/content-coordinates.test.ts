import { describe, expect, it } from 'vitest'
import { affine2d, compose2d, point2d, rectLayout, uiAnchor, uiLocalMatrix } from './content-coordinates'
import { editorRect, rectTransform } from './rect-transform'
import { identityTransform, makeFixture, type SceneNode } from './model'
import { nodeWorldMatrix, transformSelection } from './selection-transform'

describe('Content coordinates', () => {
  it('uses x,y order for all nine anchors, keeping old spellings as aliases', () => {
    for (const [row, y] of [['top', 0], ['middle', .5], ['bottom', 1]] as const)
      for (const [col, x] of [['left', 0], ['center', .5], ['right', 1]] as const)
        expect(uiAnchor(`${row}-${col}`)).toEqual([x, y])
    expect(uiAnchor('center')).toEqual(uiAnchor('middle-center'))
    expect(() => uiAnchor('toString')).toThrow()
    expect(() => uiAnchor('right-top')).toThrow()
  })
  it('places nested menu and button once, without double parent translation', () => {
    const menu = uiLocalMatrix([960,540], [264,250], uiAnchor('middle-center'), [0,70])
    const button = uiLocalMatrix([264,250], [264,52], uiAnchor('middle-center'), [0,-84])
    expect(point2d(menu,0,0)).toEqual([348,215])
    expect(point2d(compose2d(menu,button),0,0)).toEqual([348,230])
  })
  it('rotates and scales around a custom pivot rather than the center', () => {
    const matrix = uiLocalMatrix([960,540], [240,20], uiAnchor('middle-center'), [-118,70], [0,.5], Math.PI/2, [2,3])
    const pivot = point2d(matrix,0,10)
    expect(pivot[0]).toBeCloseTo(362)
    expect(pivot[1]).toBeCloseTo(340)
    expect(point2d(matrix,240,10)[1]).toBeCloseTo(820)
  })
  it('composes parent rotation, non-uniform scale and reflection', () => {
    const parent = affine2d(100,50,Math.PI/2,2,1), child = affine2d(10,20,Math.PI/4,-1,3)
    const composed = compose2d(parent,child)
    expect(point2d(composed,0,0)[0]).toBeCloseTo(80)
    expect(point2d(composed,0,0)[1]).toBeCloseTo(70)
    const expected = point2d(parent,...point2d(child,3,7))
    point2d(composed,3,7).forEach((v,i) => expect(v).toBeCloseTo(expected[i]))
  })
  it('resolves fixed and stretched rect anchors in parent-local space', () => {
    expect(rectLayout([200,100],[.5,.5],[1,0],[1,0],[0,0],[-10,20],[40,10])).toEqual({ size:[40,10], position:[90,-30] })
    expect(rectLayout([200,100],[.5,.5],[0,0],[1,1],[.5,.5],[0,0],[-20,-10])).toEqual({ size:[180,90], position:[0,0] })
  })
  it('uses the same rect offset in world matrices and selection edits', () => {
    const parent: SceneNode = { id:'p', name:'p', parentId:null, children:['c'], active:true, locked:false, tags:[], transform:identityTransform(), components:[{ id:'pr',type:'rect-transform',enabled:true,anchorMin:[0,0],anchorMax:[0,0],pivot:[.5,.5],anchoredPosition:[0,0],sizeDelta:[2,1],properties:{} }] }
    const child: SceneNode = { ...parent, id:'c', name:'c', parentId:'p', children:[], components:[{ id:'cr',type:'rect-transform',enabled:true,anchorMin:[1,1],anchorMax:[1,1],pivot:[0,1],anchoredPosition:[-.1,-.2],sizeDelta:[.4,.1],properties:{} }] }
    const nodes = {p:parent,c:child}
    expect(editorRect(child,nodes)).toEqual({size:[.4,.1],position:[.9,.3]})
    const doc = { ...makeFixture(), rootIds:['p'], nodes }
    expect(nodeWorldMatrix(doc,'c').elements.slice(12,15)).toEqual([.9,.3,0])
    const next = { ...child.transform, position:[1,0,0] as [number,number,number] }
    const operations = transformSelection(doc,['c'],'c',next)
    expect(operations).toHaveLength(1)
    expect(rectTransform(child,nodes,rectTransform(child,nodes,next),true).position[0]).toBeCloseTo(1)
    expect(operations[0]).toMatchObject({ type:'scene.setTransform' })
    if (operations[0].type !== 'scene.setTransform') throw new Error('Expected transform')
    expect(operations[0].transform.position[0]).toBeCloseTo(1)
  })
})
