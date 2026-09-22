/** Scene Editor preview only. Generated games do not import this module. */
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { componentOf, type SceneAsset, type SceneDocument, type SceneNode } from './model'
import { parseGridData, parseTilemapData, tileRect, type GridData, type TilemapData, type TileDefinition } from './tilemap-data'
import { atlasFrameName } from './sprite-sheet'
import { useTilemapBrush,type TileBrush } from './tilemap-brush'

export function tileSprite(assets: Record<string, SceneAsset>, tile: TileDefinition) {
  const find = (path: string) => {
    const asset = Object.values(assets).find(a => a.resourceId === tile.sprite.assetRef && a.path === path)
    if (!asset) throw Error(`Missing Tile sprite member ${tile.sprite.assetRef}:${path}`)
    return asset
  }
  const image = find(tile.sprite.member)
  const atlas = tile.sprite.atlasMember ? find(tile.sprite.atlasMember).spriteSheet : undefined
  const frame = atlas && 'frames' in atlas ? atlas.frames[atlasFrameName(tile.sprite.frame!)] : undefined
  if (tile.sprite.atlasMember && !frame) throw Error(`Missing Tile atlas frame ${tile.sprite.frame}`)
  return { image, frame }
}

/** Consecutive texture runs preserve painter order, including overlapping tall tiles.
 * Bounded batches keep geometry cullable; cells are not React objects. */
export function tileBatches(grid: GridData, map: TilemapData, tiles: Record<string, TileDefinition>, assets: Record<string, SceneAsset>, textures: Map<string, THREE.Texture>, ppu: number) {
  const batches: { imageId: string; geometry: THREE.BufferGeometry; positions: number[]; uvs: number[]; indices: number[] }[] = []
  const resolved = new Map(Object.entries(tiles).map(([id, tile]) => [id, tileSprite(assets, tile)]))
  for (const cell of [...map.cells].sort((a,b) => a.y-b.y || a.x-b.x)) {
    if (!Object.hasOwn(tiles, cell.tileId)) throw Error(`Missing tile ${cell.tileId}`)
    const tile = tiles[cell.tileId], sprite = resolved.get(cell.tileId)!, texture = textures.get(sprite.image.id)
    if (!texture) throw Error(`Tile texture not loaded: ${sprite.image.path}`)
    const size = texture.image as { width: number; height: number }
    const frame = sprite.frame ?? { x: 0, y: 0, width: size.width, height: size.height }
    if (frame.x + frame.width > size.width || frame.y + frame.height > size.height) throw Error(`Tile frame outside image: ${cell.tileId}`)
    let batch = batches.at(-1)
    if (!batch || batch.imageId !== sprite.image.id || batch.positions.length >= 1024*12) {
      batch = { imageId: sprite.image.id, geometry: new THREE.BufferGeometry(), positions: [], uvs: [], indices: [] }
      batches.push(batch)
    }
    const rect = tileRect(grid,map,cell,tile), x=rect.x/ppu, y=-rect.y/ppu, w=rect.width/ppu, h=rect.height/ppu
    const i=batch.positions.length/3
    batch.positions.push(x,y,0, x,y-h,0, x+w,y-h,0, x+w,y,0)
    const u=frame.x/size.width, v=1-frame.y/size.height, du=frame.width/size.width, dv=frame.height/size.height
    batch.uvs.push(u,v, u,v-dv, u+du,v-dv, u+du,v)
    batch.indices.push(i,i+1,i+2, i,i+2,i+3)
  }
  for (const batch of batches) {
    batch.geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions,3))
    batch.geometry.setAttribute('uv', new THREE.Float32BufferAttribute(batch.uvs,2))
    batch.geometry.setIndex(batch.indices)
    batch.geometry.computeBoundingSphere()
  }
  return batches
}

export function TilemapPreview({ node, document, diagnose, showGizmos,brush }: { node: SceneNode; document: SceneDocument; diagnose: (message: string) => void; showGizmos: boolean;brush?:TileBrush }) {
  const mapComponent=componentOf(node,'tilemap')!, renderer=componentOf(node,'tilemap-renderer')
  const base=useMemo(()=>parseTilemapData(mapComponent.properties),[mapComponent.properties])
  const gridNode=document.nodes[base.gridNodeId], gridComponent=gridNode && componentOf(gridNode,'grid')
  const grid=useMemo(()=>parseGridData(gridComponent?.properties),[gridComponent?.properties])
  const set=document.assets[mapComponent.assetId]?.tileSet
  const ppu=document.pixelsPerUnit ?? 100
  const group=useRef<THREE.Group>(null)
  const {map,hover}=useTilemapBrush(group,grid,base,ppu,mapComponent.enabled&&renderer?.enabled&&gridComponent?.enabled?brush:undefined,diagnose)
  // History clones documents. Compare the actual image sources, not asset-object
  // identity, so moving a node or editing a cell does not decode images again.
  const sources=useMemo(()=>{
    try {
      if(!set) throw Error('Tilemap requires a registered TileSet JSON resource')
      const images=new Map(Object.values(set.tiles).map(t=> {const a=tileSprite(document.assets,t).image;return [a.id,a]}))
      const entries=[...images].map(([id,a])=>{
        const uri=a.bytes?.startsWith('data:') ? a.bytes : a.uri
        if(!uri) throw Error(`Tile image unavailable: ${a.path}`)
        return [id,uri]
      })
      return {json:JSON.stringify(entries),error:''}
    } catch(error){return {json:'[]',error:String(error)}}
  },[set,document.assets])
  useEffect(()=>{if(sources.error) diagnose(sources.error)},[sources.error,diagnose])
  const [loaded,setLoaded]=useState({source:'',textures:new Map<string,THREE.Texture>()})
  const textures=loaded.textures
  useEffect(()=>{
    let cancelled=false
    const owned: THREE.Texture[]=[]
    setLoaded({source:sources.json,textures:new Map()})
    void (async()=>{
      const entries=await Promise.all((JSON.parse(sources.json) as [string,string][]).map(async([id,uri])=>{
        const texture=await new THREE.TextureLoader().loadAsync(uri)
        if(cancelled) { texture.dispose(); return [id,texture] as const }
        owned.push(texture); texture.colorSpace=THREE.SRGBColorSpace
        texture.magFilter=THREE.NearestFilter; texture.minFilter=THREE.NearestFilter
        return [id,texture] as const
      }))
      if(!cancelled) setLoaded({source:sources.json,textures:new Map(entries)})
    })().catch(error=>{ if(!cancelled) diagnose(String(error)) })
    return ()=>{cancelled=true; owned.forEach(t=>t.dispose())}
  },[sources.json,diagnose])
  const result=useMemo(()=>{
    if(!set || loaded.source !== sources.json || !textures.size) return { batches: [], error: '' }
    try { return {batches:tileBatches(grid,map,set.tiles,document.assets,textures,ppu),error:''} }
    catch(error){return {batches:[],error:String(error)}}
  },[grid,map,set,document.assets,textures,ppu,loaded.source,sources.json])
  useEffect(()=>{if(result.error) diagnose(result.error)},[result.error,diagnose])
  useEffect(()=>()=>result.batches.forEach(b=>b.geometry.dispose()),[result])
  const collision=useMemo(()=>{
    const positions:number[]=[]
    if(showGizmos && map.collisionEnabled && set) for(const cell of map.cells) {
      const tile=set.tiles[cell.tileId]
      if(!tile?.collision) continue
      const p=tileRect(grid,map,cell,tile).pivotPosition, points=tile.collision.points
      for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];positions.push((p[0]+a[0])/ppu,-(p[1]+a[1])/ppu,0,(p[0]+b[0])/ppu,-(p[1]+b[1])/ppu,0)}
    }
    const geometry=new THREE.BufferGeometry()
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3))
    return geometry
  },[showGizmos,map,grid,set,ppu])
  useEffect(()=>()=>collision.dispose(),[collision])
  if(!mapComponent.enabled || !renderer?.enabled || !gridComponent?.enabled) return null
  return <group ref={group}>
    {result.batches.map((batch,i)=><mesh key={i} geometry={batch.geometry} renderOrder={Number(renderer.properties.sortingOrder ?? node.order ?? 0)}>
      <meshBasicMaterial map={textures.get(batch.imageId)} transparent depthWrite={false} depthTest={false} side={THREE.DoubleSide} toneMapped={false}/>
    </mesh>)}
    {showGizmos && map.collisionEnabled && <lineSegments geometry={collision} renderOrder={1000000} raycast={()=>{}}><lineBasicMaterial color="#6ee7b7" depthTest={false}/></lineSegments>}
    {brush && hover && <mesh userData={{editorHelper:true}} raycast={()=>{}} renderOrder={1000001}
      position={[(hover.x*(grid.cellSize[0]+(grid.cellGap?.[0]??0))+grid.cellSize[0]/2)/ppu,-(hover.y*(grid.cellSize[1]+(grid.cellGap?.[1]??0))+grid.cellSize[1]/2)/ppu,.001]}>
      <planeGeometry args={[grid.cellSize[0]/ppu,grid.cellSize[1]/ppu]}/>
      <meshBasicMaterial color={brush.tool==='erase'?'#fb7185':'#ffffff'} opacity={.3} transparent depthTest={false} depthWrite={false} side={THREE.DoubleSide}/>
    </mesh>}
  </group>
}
