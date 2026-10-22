import { describe, expect, it } from 'bun:test'
import { point2d } from '../../../scene-editor/src/content-coordinates'
import { sceneWorldTransforms2d, type SceneSpatialNode as Node } from '../../../scene-editor/src/scene-layout-inspection'

// Exercise the geometry used by current inspection and production rendering.
describe('shared Scene coordinates', () => {
  it('inherits parent rotation, scale and translation exactly once', () => {
    const parent: Node = {id:'p',transform:{position:[100,50,0],rotation:[0,0,Math.PI/2],scale:[2,1,1]}}
    const child: Node = {id:'c',parentId:'p',transform:{position:[10,20,0]}}
    const matrix = sceneWorldTransforms2d([parent, child]).poses.get('c')!
    expect(point2d(matrix,0,0)[0]).toBeCloseTo(80)
    expect(point2d(matrix,0,0)[1]).toBeCloseTo(70)
  })
  it('resolves rect anchors and adds Transform.position only once', () => {
    const parent: Node = {id:'p', transform:{position:[100,50,0]}, components:[{type:'rect-transform',data:{anchorMin:[0,0],anchorMax:[0,0],pivot:[.5,.5],anchoredPosition:[0,0],sizeDelta:[200,100]}}]}
    const child: Node = {id:'c',parentId:'p',transform:{position:[5,7,0]},components:[{type:'rect-transform',data:{anchorMin:[1,0],anchorMax:[1,0],pivot:[0,0],anchoredPosition:[-10,20],sizeDelta:[40,10]}}]}
    const { poses, rects } = sceneWorldTransforms2d([parent, child])
    expect(rects.get('c')).toEqual({size:[40,10],position:[90,-30]})
    expect(point2d(poses.get('c')!,0,0)).toEqual([195,27])
  })
})
