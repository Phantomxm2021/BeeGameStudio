import { describe, expect, it } from 'bun:test'
import sharp from 'sharp'
import { affine2d, point2d } from '../../../scene-editor/src/content-coordinates'
import { applyOpacity, firstSpriteFrame, sceneRect, transformedOverlay, worldPose } from './scene-content-preview'

type Node = Parameters<typeof worldPose>[0]
describe('Scene preview coordinates', () => {
  it('scales original alpha without changing RGB for zero, fractional and full opacity', async () => {
    const bytes = await sharp(Buffer.from([180, 70, 30, 128, 20, 40, 60, 255]),
      { raw: { width: 2, height: 1, channels: 4 } }).png().toBuffer()
    for (const opacity of [0, .5, 1]) {
      const data = await sharp(await applyOpacity(bytes, opacity)).raw().toBuffer()
      expect([...data]).toEqual([180, 70, 30, Math.round(128 * opacity), 20, 40, 60, Math.round(255 * opacity)])
    }
  })
  it('reports unreadable sprite metadata instead of silently showing the whole atlas', async () => {
    await expect(firstSpriteFrame({ workspacePath: '/missing', resource: {file_paths:['idle.png','idle.json']} as any,
      member:'idle', bytes:Buffer.from('invalid'), node:{id:'fox'} }))
      .rejects.toThrow('Sprite frame fox/idle')
  })
  it('crops authored frameSize when the spritesheet has no sidecar', async () => {
    const bytes = await sharp({create:{width:192,height:144,channels:4,background:'#ffffff'}}).png().toBuffer()
    const frame = await firstSpriteFrame({workspacePath:'/tmp', resource:{file_paths:[]} as any, member:'idle', bytes,
      node:{id:'player',components:[{id:'sprite',type:'sprite-renderer',data:{member:'idle',frameSize:[48,48]}}]}})
    expect(await sharp(frame).metadata()).toMatchObject({width:48,height:48})
  })
  it('inherits parent rotation, scale and translation exactly once', () => {
    const parent: Node = {id:'p',transform:{position:[100,50,0],rotation:[0,0,Math.PI/2],scale:[2,1,1]}}
    const child: Node = {id:'c',parentId:'p',transform:{position:[10,20,0]}}
    const matrix = worldPose(child,new Map([['p',parent],['c',child]]))
    expect(point2d(matrix,0,0)[0]).toBeCloseTo(80)
    expect(point2d(matrix,0,0)[1]).toBeCloseTo(70)
  })
  it('resolves rect anchors and adds Transform.position only once', () => {
    const parent: Node = {id:'p', transform:{position:[100,50,0]}, components:[{id:'pr',type:'rect-transform',data:{anchorMin:[0,0],anchorMax:[0,0],pivot:[.5,.5],anchoredPosition:[0,0],sizeDelta:[200,100]}}]}
    const child: Node = {id:'c',parentId:'p',transform:{position:[5,7,0]},components:[{id:'cr',type:'rect-transform',data:{anchorMin:[1,0],anchorMax:[1,0],pivot:[0,0],anchoredPosition:[-10,20],sizeDelta:[40,10]}}]}
    const nodes = new Map([['p',parent],['c',child]])
    expect(sceneRect(child,nodes)).toEqual({size:[40,10],position:[90,-30]})
    expect(point2d(worldPose(child,nodes),0,0)).toEqual([195,27])
  })
  it('rasterizes clockwise rotation with the correct bounding box', async () => {
    const bytes = await sharp({create:{width:20,height:10,channels:4,background:'#ff0000'}}).png().toBuffer()
    const overlay = await transformedOverlay(bytes,affine2d(30,20,Math.PI/2),{width:20,height:10},{x:0,y:0},{width:100,height:100})
    expect(overlay).toMatchObject({left:20,top:20})
    const meta = await sharp(overlay!.input as Buffer).metadata()
    expect(meta.height).toBe(20)
    // Floating-point cos(pi/2) may leave a single transparent padding column.
    expect(meta.width).toBeLessThanOrEqual(11)
    const {data,info} = await sharp(overlay!.input as Buffer).raw().toBuffer({resolveWithObject:true})
    const pixel = (5*info.width+5)*info.channels
    expect([...data.subarray(pixel,pixel+4)]).toEqual([255,0,0,255])
  })
  it('preserves negative scale instead of taking its absolute value', async () => {
    const bytes = await sharp(Buffer.from([255,0,0,255, 0,0,255,255]),{raw:{width:2,height:1,channels:4}}).png().toBuffer()
    const overlay = await transformedOverlay(bytes,affine2d(20,20,0,-10,10),{width:2,height:1},{x:0,y:0},{width:100,height:100})
    expect(overlay).toMatchObject({left:0,top:20})
    const {data,info} = await sharp(overlay!.input as Buffer).raw().toBuffer({resolveWithObject:true})
    const left = (5*info.width+2)*info.channels, right = (5*info.width+17)*info.channels
    expect(data[left+2]).toBeGreaterThan(data[left])
    expect(data[right]).toBeGreaterThan(data[right+2])
  })
  it('clips off-canvas graphics and omits zero-area transforms', async () => {
    const bytes = await sharp({create:{width:20,height:10,channels:4,background:'#ffffff'}}).png().toBuffer()
    const overlay = await transformedOverlay(bytes,affine2d(-10,-5),{width:20,height:10},{x:0,y:0},{width:100,height:100})
    expect(overlay).toMatchObject({left:0,top:0})
    expect(await sharp(overlay!.input as Buffer).metadata()).toMatchObject({width:10,height:5})
    expect(await transformedOverlay(bytes,affine2d(0,0,0,0,1),{width:20,height:10},{x:0,y:0},{width:100,height:100})).toBeUndefined()
  })
})
