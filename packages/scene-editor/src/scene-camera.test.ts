import { describe, expect, it } from 'vitest'
import { Matrix4, OrthographicCamera, PerspectiveCamera, Quaternion, Euler, Vector3 } from 'three'
import { resolveSceneCameraView, sceneCameraAspectRange, SCENE_FRAMING_OPTIONS } from './scene-camera'
import { inspectSceneLayout2d, sceneWorldTransforms2d, type SceneSpatialData, type SceneSpatialNode } from './scene-layout-inspection'
import { resolveGameCameraPreview } from './game-camera-preview'
import { makeFixture } from './model'
import { readFileSync } from 'node:fs'

const camera = { orthographic: true, orthographicSize: 3.6, viewport: { width: 1280, height: 720 } }
const sizes = [{ width: 1280, height: 720 }, { width: 390, height: 844 }, { width: 667, height: 375 }, { width: 480, height: 240 }]
function scene(): SceneSpatialData & { nodes: SceneSpatialNode[] } {
  return { cameraNodeId: 'camera', settings: { coordinateSystem: { width: 1280, height: 720, pixelsPerUnit: 100 } }, nodes: [
    { id: 'camera', transform: { position: [640, 360, 1000] }, components: [{ type: 'camera', data: camera }] },
    { id: 'group', transform: { position: [640, 360, 0], rotation: [0, 0, .4], scale: [-1, 2, 1] } },
    { id: 'sprite', parentId: 'group', transform: { position: [80, 40, 0] }, components: [{ type: 'sprite-renderer', data: { size: [40, 20], anchor: [.5, 1] } }] },
  ] }
}
describe('scene camera projection', () => {
  it('preserves the selected span without resizing source data', () => {
    const before = JSON.stringify(camera)
    for (const host of sizes) {
      expect(resolveSceneCameraView(camera, host).halfHeight).toBeCloseTo(3.6)
      expect(resolveSceneCameraView({ ...camera, framing: 'keep-width' }, host).halfWidth).toBeCloseTo(6.4)
      const expanded = resolveSceneCameraView({ ...camera, framing: 'expand' }, host)
      expect(expanded.halfWidth).toBeGreaterThanOrEqual(6.4 - 1e-8)
      expect(expanded.halfHeight).toBeGreaterThanOrEqual(3.6 - 1e-8)
      const boxed = resolveSceneCameraView({ ...camera, framing: 'letterbox' }, host)
      expect(boxed.rect.width / boxed.rect.height).toBeCloseTo(1280 / 720)
      expect(boxed.halfHeight).toBeCloseTo(3.6)
      expect(boxed.rect.x * 2 + boxed.rect.width).toBeCloseTo(host.width)
      expect(boxed.rect.y * 2 + boxed.rect.height).toBeCloseTo(host.height)
    }
    expect(JSON.stringify(camera)).toBe(before)
  })
  it('agrees with actual Three.js orthographic projections including parent transforms', () => {
    for (const framing of SCENE_FRAMING_OPTIONS) for (const host of sizes) {
      const source = scene()
      source.nodes[0].components![0].data = { ...camera, framing }
      const inspected = inspectSceneLayout2d(source, host)
      const { view } = inspected
      const native = new OrthographicCamera(-view.halfWidth, view.halfWidth, view.halfHeight, -view.halfHeight, .01, 100)
      native.position.set(0, 0, 10); native.updateMatrixWorld(true)
      const parent = new Matrix4().compose(new Vector3(0,0,0), new Quaternion().setFromEuler(new Euler(0,0,-.4)), new Vector3(-1,2,1))
      const points=[[.6,-.2],[1,-.2],[.6,-.4],[1,-.4]].map(([x,y]) => new Vector3(x,y,0).applyMatrix4(parent).project(native))
      const projected = inspected.nodes.find(n => n.id === 'sprite')!.screenBounds!
      const x=points.map(p=>view.rect.x+(p.x+1)*view.rect.width/2)
      const y=points.map(p=>view.rect.y+(1-p.y)*view.rect.height/2)
      expect(projected.left).toBeCloseTo(Math.min(...x))
      expect(projected.right).toBeCloseTo(Math.max(...x))
      expect(projected.top).toBeCloseTo(Math.min(...y))
      expect(projected.bottom).toBeCloseTo(Math.max(...y))
    }
  })
  it('adapts perspective FOV, not object geometry', () => {
    for (const framing of SCENE_FRAMING_OPTIONS) for (const host of sizes) {
      const input = { ...camera, orthographic: false, fieldOfView: 60, framing }
      const view = resolveSceneCameraView(input, host)
      const native = new PerspectiveCamera(view.verticalFieldOfView, view.aspect, .1, 100)
      const verticalSpan = 2 / native.projectionMatrix.elements[5]
      const horizontalSpan = 2 / native.projectionMatrix.elements[0]
      if (framing === 'keep-height') expect(verticalSpan).toBeCloseTo(2 * Math.tan(Math.PI / 6))
      if (framing === 'keep-width') expect(horizontalSpan).toBeCloseTo(2 * Math.tan(Math.PI / 6) * 1280 / 720)
      if (framing === 'expand') expect(verticalSpan).toBeGreaterThanOrEqual(2 * Math.tan(Math.PI / 6) - 1e-8)
    }
  })
  it('honors translated and rotated authored Cameras rather than centering the map', () => {
    const source = scene()
    source.nodes[0].transform = { position: [400, 250, 1000], rotation: [0,0,Math.PI/2] }
    source.nodes.push({ id: 'at-camera', transform: { position: [400,250,0] }, components: [{ type:'sprite-renderer',data:{size:[20,20]} }] })
    const result = inspectSceneLayout2d(source, sizes[0])
    const b = result.nodes.find(n=>n.id==='at-camera')!.screenBounds!
    expect((b.left+b.right)/2).toBeCloseTo(640)
    expect((b.top+b.bottom)/2).toBeCloseTo(360)
  })
  it('uses actual TileSet sizes, offsets and pivots, never guessed grid-cell bounds', () => {
    const source = scene()
    source.nodes.push({ id:'grid',components:[{type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}] },
      {id:'map',parentId:'grid',components:[{type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'grid',cells:[{x:1,y:2,tileId:'tree'}]}}]})
    const before=JSON.stringify(source)
    const result=inspectSceneLayout2d(source,sizes[0],()=>({schema:'beegame-tileset.v1',tiles:{tree:{sprite:{assetRef:'IMG',member:'tree.png'},size:[40,80],pivot:[.5,1],offset:[3,4]}}}))
    expect(result.nodes.find(n=>n.id==='map')!.worldBounds).toEqual({left:31,top:4,right:71,bottom:84})
    expect(inspectSceneLayout2d(source,sizes[0]).nodes.find(n=>n.id==='map')!.geometryUnavailable).toContain('TileSet required')
    expect(JSON.stringify(source)).toBe(before)
  })
  it('reports disabled hierarchy, unknown geometry and offscreen bounds without changing data', () => {
    const source=scene();source.nodes[1].enabled=false
    source.nodes.push({id:'unknown',components:[{type:'sprite-renderer',data:{}}]},
      {id:'far',transform:{position:[5000,5000,0]},components:[{type:'image',data:{size:[40,40]}}]})
    const result=inspectSceneLayout2d(source,sizes[0])
    expect(result.nodes.find(n=>n.id==='sprite')!.enabled).toBe(false)
    expect(result.nodes.find(n=>n.id==='unknown')!.geometryUnavailable).toContain('Explicit')
    expect(result.nodes.find(n=>n.id==='far')!.fullyInside).toBe(false)
  })
  it('rejects invalid dimensions, hierarchy and unsupported projections explicitly', () => {
    expect(()=>resolveSceneCameraView(camera,{width:0,height:1})).toThrow('positive')
    expect(()=>resolveSceneCameraView({...camera,framing:'invented' as any},sizes[0])).toThrow('Unknown')
    expect(()=>resolveSceneCameraView({...camera,orthographic:false,fieldOfView:180},sizes[0])).toThrow('less than')
    expect(()=>sceneWorldTransforms2d([{id:'a',parentId:'b'},{id:'b',parentId:'a'}])).toThrow('cycle')
    expect(()=>sceneWorldTransforms2d([{id:'a',parentId:'b'}])).toThrow('Unknown')
    const source=scene();source.nodes[0].transform!.scale=[2,1,1]
    expect(()=>inspectSceneLayout2d(source,sizes[0])).toThrow('rigid')
  })
  it('derives fixed required-geometry aspect limits independently of viewport samples', () => {
    const bounds = { left: -4.96, right: 4.96, top: -3.12, bottom: 3.28 }
    const range = sceneCameraAspectRange(camera, bounds)!
    expect(range.min).toBeCloseTo(9.92 / 7.2)
    expect(range.max).toBeNull()
    for (const aspect of [1.01, 4/3, 1.4, 16/9, 2.4]) {
      const view = resolveSceneCameraView(camera, { width: aspect * 720, height: 720 })
      expect(view.halfWidth! >= bounds.right).toBe(aspect >= range.min)
    }
    const widthRange = sceneCameraAspectRange({ ...camera, framing: 'keep-width' }, bounds)!
    expect(widthRange.min).toBe(0)
    expect(widthRange.max).toBeCloseTo(6.4 / 3.28)
    for (const framing of ['expand', 'letterbox'] as const)
      expect(sceneCameraAspectRange({ ...camera, framing }, bounds)).toEqual({ min: 0, max: null })
    expect(sceneCameraAspectRange(camera, { ...bounds, bottom: 4 })).toBeNull()
    expect(sceneCameraAspectRange({ ...camera, framing: 'expand' }, { ...bounds, right: 8, bottom: 4 })).toBeNull()
    expect(sceneCameraAspectRange({ ...camera, framing: 'expand' }, { ...bounds, right: 8 })).toEqual({ min: 8/3.6, max: null })
    expect(sceneCameraAspectRange({ ...camera, framing: 'expand' }, { ...bounds, bottom: 4 })?.max).toBeCloseTo(6.4/4)
  })
  it('checks only explicitly required geometry, including selected groups and camera-local transforms', () => {
    const source = scene()
    source.settings!.requiredVisibleNodeIds = ['group']
    const before = JSON.stringify(source)
    expect(inspectSceneLayout2d(source, { width: 960, height: 900 }).requiredVisibility?.status).toBe('passed')
    expect(JSON.stringify(source)).toBe(before)
    source.nodes[1].transform = { position: [1090, 360, 0], rotation: [0,0,0] }
    const narrow = inspectSceneLayout2d(source, { width: 960, height: 900 })
    expect(narrow.requiredVisibility?.status).toBe('failed')
    expect(narrow.requiredVisibility?.outside).toEqual(['sprite'])
    expect(narrow.requiredVisibility?.supportedAspect?.min).toBeCloseTo((450+80+20)/360)
    source.nodes[0].components![0].data = { ...camera, framing: 'letterbox' }
    expect(inspectSceneLayout2d(source, { width: 960, height: 900 }).requiredVisibility?.status).toBe('passed')
    source.nodes.push({ id:'optional', transform:{position:[5000,5000,0]}, components:[{type:'image',data:{size:[40,40]}}] })
    expect(inspectSceneLayout2d(source, sizes[0]).requiredVisibility?.status).toBe('passed')
    source.nodes[1].enabled = false
    expect(inspectSceneLayout2d(source, sizes[0]).requiredVisibility?.status).toBe('unverified')
    source.settings!.requiredVisibleNodeIds = ['missing']
    expect(() => inspectSceneLayout2d(source, sizes[0])).toThrow('Unknown required-visible')
  })
  it('never reports full containment when some visual geometry is unavailable', () => {
    const source = scene()
    source.nodes.push({ id:'grid',components:[{type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}] },
      {id:'mixed',parentId:'grid',transform:{position:[640,360,0]},components:[{type:'sprite-renderer',data:{size:[20,20]}},
        {type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'grid',cells:[{x:1,y:2,tileId:'tree'}]}}]})
    source.settings!.requiredVisibleNodeIds = ['mixed']
    const before = JSON.stringify(source)
    const result = inspectSceneLayout2d(source, sizes[0])
    expect(result.nodes.find(n => n.id === 'mixed')?.fullyInside).toBeUndefined()
    expect(result.requiredVisibility?.status).toBe('unverified')
    expect(result.requiredVisibility?.supportedAspect).toBeUndefined()
    expect(JSON.stringify(source)).toBe(before)
    source.nodes.push({ id: 'malformed', components: [{ type: 'sprite-renderer', data: { size: [] } }] })
    const malformed = inspectSceneLayout2d(source, sizes[0]).nodes.find(n => n.id === 'malformed')!
    expect(malformed.geometryUnavailable).toContain('Explicit visual size')
    expect(malformed.screenBounds).toBeUndefined() // Never emit NaN/null numeric bounds.
    source.nodes.find(n => n.id === 'mixed')!.components![0].data = { size: [] }
    const knownTiles = inspectSceneLayout2d(source, sizes[0], () => ({ schema: 'beegame-tileset.v1',
      tiles: { tree: { sprite: { assetRef: 'SPRITE', member: 'tree.png' }, size: [20,20] } } }))
    expect(knownTiles.nodes.find(n => n.id === 'mixed')?.geometryUnavailable).toContain('Explicit visual size')
    expect(knownTiles.nodes.find(n => n.id === 'mixed')?.fullyInside).toBeUndefined()
    expect(knownTiles.requiredVisibility?.status).toBe('unverified')
    source.nodes.find(n => n.id === 'mixed')!.components![0].data = { size: [20,20] }
    source.nodes.find(n => n.id === 'mixed')!.transform = { position: [0,0,0] }
    const outside = inspectSceneLayout2d(source, sizes[0])
    expect(outside.nodes.find(n => n.id === 'mixed')?.fullyInside).toBe(false) // Known clipping is still a failure.
    expect(outside.requiredVisibility?.status).toBe('failed')
  })
  it('reproduces frozen native Scene clipping read-only and checks framing alternatives in memory', () => {
    const path = new URL('../../../docs/verification/layout-2026-10-01/design-tools-retest/after-review/content/scenes/breakout_level.json', import.meta.url)
    const original = readFileSync(path, 'utf8')
    const source = JSON.parse(original).data as SceneSpatialData
    // The case's level specification requires the complete fixed playfield.
    // This is an inspection selection, not a rewritten project or a default for other games.
    source.settings!.requiredVisibleNodeIds = source.nodes.filter(n => n.components?.some(c => c.type === 'sprite-renderer')).map(n => n.id)
    const camera = source.nodes.find(n => n.id === 'main-camera')!.components!.find(c => c.type === 'camera')!.data!
    const before = JSON.stringify(source)
    for (const size of [[1280,720], [1024,576], [960,540]])
      expect(inspectSceneLayout2d(source, { width: size[0], height: size[1] }).requiredVisibility?.status).toBe('passed')
    for (const size of [[960,720], [960,900]]) {
      const result = inspectSceneLayout2d(source, { width: size[0], height: size[1] })
      expect(result.requiredVisibility?.status).toBe('failed')
      expect(result.requiredVisibility?.supportedAspect?.min).toBeCloseTo(992/720)
    }
    expect(JSON.stringify(source)).toBe(before)
    for (const framing of ['expand', 'letterbox']) {
      const variant = structuredClone(source)
      variant.nodes.find(n => n.id === 'main-camera')!.components!.find(c => c.type === 'camera')!.data = { ...camera, framing }
      for (const size of [[960,720], [960,900]])
        expect(inspectSceneLayout2d(variant, { width: size[0], height: size[1] }).requiredVisibility?.status).toBe('passed')
    }
    expect(readFileSync(path, 'utf8')).toBe(original)
  })
  it('editor game-camera projection preserves camera identity and does not mutate authored data', () => {
    const doc=makeFixture();doc.cameraNodeId='camera'
    const component=doc.nodes.camera.components[0] as any
    component.orthographicSize=3.6;component.properties={viewport:{width:1280,height:720},framing:'expand'}
    const before=JSON.stringify(doc)
    expect(resolveGameCameraPreview(doc,sizes[1]).view.halfWidth).toBeCloseTo(6.4)
    expect(resolveGameCameraPreview(doc,sizes[1]).position).toEqual([0,0,-10])
    expect(JSON.stringify(doc)).toBe(before)
    doc.nodes.camera.active=false
    expect(()=>resolveGameCameraPreview(doc,sizes[0])).toThrow('active Camera')
  })
  it('resolves tilted 3D cameras through rotated parents for both native projections', () => {
    const doc=makeFixture();doc.dimension='3d';doc.cameraNodeId='camera'
    doc.nodes.root.transform.position=[2,1,3]
    const parentRotation=new Quaternion().setFromEuler(new Euler(.2,.4,-.1))
    doc.nodes.root.transform.quaternion=parentRotation.toArray()
    doc.nodes.camera.transform.position=[0,0,6]
    doc.nodes.camera.transform.rotation=[.1,-.2,0]
    const component=doc.nodes.camera.components[0] as any
    component.properties={viewport:{width:1280,height:720},fieldOfView:60,framing:'expand'}
    component.orthographicSize=3
    for (const orthographic of [true,false]) {
      component.orthographic=orthographic
      const before=JSON.stringify(doc)
      const preview=resolveGameCameraPreview(doc,sizes[1])
      const world=new Matrix4().compose(new Vector3(2,1,3),parentRotation,new Vector3(1,1,1))
        .multiply(new Matrix4().compose(new Vector3(0,0,6),new Quaternion().setFromEuler(new Euler(.1,-.2,0)),new Vector3(1,1,1)))
      const expectedPosition=new Vector3(),expectedRotation=new Quaternion(),scale=new Vector3()
      world.decompose(expectedPosition,expectedRotation,scale)
      expect(preview.position).toEqual(expectedPosition.toArray())
      expect(new Quaternion(...preview.quaternion).angleTo(expectedRotation)).toBeLessThan(1e-7)
      expect(preview.view.projection).toBe(orthographic?'orthographic':'perspective')
      expect(JSON.stringify(doc)).toBe(before)
    }
    doc.dimension='2d'
    component.orthographic=true
    expect(()=>resolveGameCameraPreview(doc,sizes[0])).toThrow('Tilted 2D')
  })
})
