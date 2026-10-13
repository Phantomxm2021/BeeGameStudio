import { readFile } from 'node:fs/promises'
import { resolve, basename, extname } from 'node:path'
import sharp from 'sharp'
import { contentIndexSchema, contentDocumentSchema, type BeeGameContentDocument } from '../game-content-schema'
import { readBeeGameAssetManifestSync, readBeeGameAssetManifestModulePathsSync, type BeeGameAssetManifest } from '../asset-contracts'
import { readRegisteredResourceFile, readTileSetResource } from '../tilemap-contract'
import { parseSpriteSheet, spriteSheetSelection, validateSpriteSheetBounds } from '../../../../scene-editor/src/sprite-sheet'
import { inspectSceneLayout2d, sceneWorldTransforms2d } from '../../../../scene-editor/src/scene-layout-inspection'
import { compose2d, point2d } from '../../../../scene-editor/src/content-coordinates'
import { parseGridData, parseTilemapData, tileRect, type TileSetData } from '../../../../scene-editor/src/tilemap-data'
import { inspectUiLayout } from '../../../../scene-editor/src/ui-layout-inspection'
import { runContentCheck } from './content-checks'
import { readVersion } from './checks'
import type { CheckResult, TaskSpec } from './state'
import type { PreparedUiProbe } from './ui-consumption'

type ImageBinding = { nodeId: string; componentId?: string; assetRef: string; member?: string; atlasMember?: string; frame?: string;
  tilemap?: { tileId: string; path: string; tiles: TileSetData } }
type Bounds = PreparedUiProbe['before']
export type PreparedPixelProbe = Omit<PreparedUiProbe,'variants'|'checkTextFit'|'unobservedProperties'> & { mode: 'pixels';
  resource: { path: string; sha256: string }; markers: { body: string; color: number[] }[];
  regions?: Bounds[]; tileId?: string;
  variants: { property: string; replacement: string; expected: Bounds; path?: string; regions?: Bounds[] }[] }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function registeredMember(resource: BeeGameAssetManifest['resources'][number], name?: string) {
  if(!name)return resource.root_path
  if(resource.file_paths.includes(name))return name
  const candidates=resource.file_paths.filter(path=>basename(path,extname(path))===name)
  if(candidates.length!==1)throw Error('Ambiguous registered image member: '+name)
  return candidates[0]!
}

function bindings(doc: BeeGameContentDocument, loadTiles?: (id: string, member?: string) => { path: string; tiles: TileSetData }): ImageBinding[] {
  if (doc.kind === 'scene-2d' || doc.kind === 'scene-3d') return doc.data.nodes.flatMap(node=>(node.components ?? []).flatMap(c=>{
    if (!c.assetRef || c.data?.enabled===false) return []
    if (['sprite-renderer','image'].includes(c.type)) return [{ ...record(c.data),nodeId:node.id,componentId:c.id,assetRef:c.assetRef } as ImageBinding]
    if (c.type!=='tilemap' || !loadTiles) return []
    const map=parseTilemapData(c.data), source=loadTiles(c.assetRef,map.member)
    if(!map.cells.length)throw Error('Empty Tilemap has no observable tile pixels')
    if(!node.components?.some(v=>v.type==='tilemap-renderer' && v.data?.enabled!==false))throw Error('Active TilemapRenderer required')
    return [...new Set(map.cells.map(cell=>cell.tileId))].map(tileId=>{
      const tile=source.tiles.tiles[tileId]
      if(!tile)throw Error('Unknown TileSet tile: '+tileId)
      return { ...tile.sprite,nodeId:node.id,componentId:c.id,tilemap:{tileId,...source} }
    })
  }))
  if ('rootId' in doc.data) return doc.data.nodes.flatMap(node=>{
    const image=record(node.data?.image)
    return typeof image.assetRef==='string' ? [{...image,nodeId:node.id} as ImageBinding] : []
  })
  return []
}

const combinedBounds = (regions: Bounds[]): Bounds => ({
  left: Math.min(...regions.map(r=>r.left)), top: Math.min(...regions.map(r=>r.top)),
  right: Math.max(...regions.map(r=>r.right)), bottom: Math.max(...regions.map(r=>r.bottom)),
})

// Use the existing authored Grid/TileSet and camera/hierarchy projection. This
// only derives expected rectangles; the actual game's Canvas draws the pixels.
function tileRegions(doc: BeeGameContentDocument, binding: ImageBinding, viewport: {width:number;height:number}, tiles: TileSetData): Bounds[] {
  if(doc.kind!=='scene-2d' || !binding.tilemap)throw Error('Static 2D Tilemap required')
  const node=doc.data.nodes.find(n=>n.id===binding.nodeId)!, component=node.components!.find(c=>c.id===binding.componentId)!
  if(node.components!.some(c=>['sprite-renderer','image','text','rect-transform'].includes(c.type)))
    throw Error('Tilemap probe requires a separate, non-RectTransform visual node')
  const map=parseTilemapData(component.data), gridNode=doc.data.nodes.find(n=>n.id===map.gridNodeId)!
  const grid=parseGridData(gridNode.components!.find(c=>c.type==='grid')!.data)
  const inspected=inspectSceneLayout2d(doc.data,viewport,(id,member)=>id===component.assetRef && member===map.member ? tiles : undefined)
  const measured=inspected.nodes.find(n=>n.id===node.id)
  if(!measured?.enabled || measured.geometryUnavailable || measured.fullyInside!==true)throw Error('Tilemap geometry inactive, unavailable or outside viewport')
  const transform=compose2d(inspected.worldToScreen,sceneWorldTransforms2d(doc.data.nodes).poses.get(node.id)!)
  if(Math.abs(transform[1])>1e-6 || Math.abs(transform[2])>1e-6)throw Error('Rotated/sheared Tilemap pixels need a different target-runtime observation')
  const rectangles=map.cells.map(cell=>{
    const rect=tileRect(grid,map,cell,tiles.tiles[cell.tileId]!)
    const [a,b]=[point2d(transform,rect.x,rect.y),point2d(transform,rect.x+rect.width,rect.y+rect.height)]
    return {cell,bounds:{left:Math.min(a[0],b[0]),top:Math.min(a[1],b[1]),right:Math.max(a[0],b[0]),bottom:Math.max(a[1],b[1])}}
  })
  if(rectangles.some(({bounds:r})=>r.right-r.left<=4 || r.bottom-r.top<=4))throw Error('Tile pixels too small to isolate with the current tolerance')
  for(let i=0;i<rectangles.length;i++)for(let j=i+1;j<rectangles.length;j++){
    const a=rectangles[i]!.bounds,b=rectangles[j]!.bounds
    if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>1e-6 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1e-6)
      throw Error('Overlapping Tilemap visuals cannot be isolated by this pixel driver')
  }
  return rectangles.filter(r=>r.cell.tileId===binding.tilemap!.tileId).map(r=>r.bounds)
}

/** Actual registered source + existing geometry + registered image selection.
 * No expected positions, resources or PASS supplied by an author. Unsupported
 * cases remain unverified rather than becoming a second runtime renderer. */
export async function preparePixelProbes(root: string, task: Pick<TaskSpec, 'pixelProbes'|'runtimeArtifact'>, result: CheckResult): Promise<PreparedPixelProbe[]> {
  if (!task.pixelProbes?.length) throw Error('Declare actual Canvas pixelProbes')
  result.inputs.push(await readVersion(root,'content/index.json'))
  const index=contentIndexSchema.parse(JSON.parse(await readFile(resolve(root,'content/index.json'),'utf8')))
  if (!index.documents?.length) throw Error('Actual content registry required')
  const docs=new Map<string,BeeGameContentDocument>(), allBindings=new Map<string,ImageBinding[]>()
  for(const entry of index.documents){
    const path='content/'+entry.path, version=await readVersion(root,path)
    result.inputs.push(version)
    const doc=contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root,path),'utf8')))
    if(doc.id!==entry.id || doc.kind!==entry.kind)throw Error('Registered source identity changed: '+path)
    docs.set(path,doc)
  }
  const resourceCheck=await runContentCheck(root,'content-resources',{...task,expectedOutputs:[...docs.keys()]},[],{})
  result.inputs.push(...resourceCheck.inputs)
  if(resourceCheck.status!=='passed')throw Error('Saved resource bindings unverified: '+resourceCheck.observation)
  result.inputs.push(await readVersion(root,'assets/asset-manifest.json'))
  for(const path of readBeeGameAssetManifestModulePathsSync(root))result.inputs.push(await readVersion(root,path))
  const manifest=readBeeGameAssetManifestSync(root), prepared: PreparedPixelProbe[]=[]
  const tileSets=new Map<string,{path:string;tiles:TileSetData}>()
  const loadTiles=(id:string,member?:string)=>{
    const key=JSON.stringify([id,member]), cached=tileSets.get(key)
    if(cached)return cached
    const file=readRegisteredResourceFile(root,manifest,id,member)
    const value={path:file.path,tiles:readTileSetResource(root,manifest,id,member)}
    tileSets.set(key,value);return value
  }
  for(const [path,doc] of docs){
    const actual=bindings(doc,loadTiles);allBindings.set(path,actual)
    if(actual.length && !task.pixelProbes.some(probe=>probe.document===path))throw Error('pixelProbes omit registered Scene/image UI: '+path)
    for(const binding of actual)if(!task.pixelProbes.some(probe=>probe.document===path && probe.nodeId===binding.nodeId && probe.componentId===binding.componentId))
      throw Error('pixelProbes omit registered image binding: '+path+'#'+binding.nodeId)
  }
  for(const {path} of tileSets.values()){
    const source=await readVersion(root,path),packed=await readVersion(root,task.runtimeArtifact+'/'+path)
    result.inputs.push(source,packed)
    if(source.sha256!==packed.sha256)throw Error('Packed TileSet differs: '+path)
  }
  for(const probe of task.pixelProbes){
    const doc=docs.get(probe.document), selected=allBindings.get(probe.document)?.filter(b=>b.nodeId===probe.nodeId && b.componentId===probe.componentId)
    if(!doc || !selected?.length)throw Error('Pixel probe must select an actual registered image binding (Scene requires exact componentId)')
    for(const binding of selected){
    if(doc.kind==='scene-3d')throw Error('3D projection is not supported by this pixel driver')
    const source=await readVersion(root,probe.document), packed=await readVersion(root,task.runtimeArtifact+'/'+probe.document)
    result.inputs.push(source,packed)
    if(source.sha256!==packed.sha256)throw Error('Packed source differs: '+probe.document)
    const resource=manifest.resources.find(r=>r.id===binding.assetRef)
    if(!resource)throw Error('Registered image resource missing')
    const select=(name?:string)=>registeredMember(resource,name)
    const image=readRegisteredResourceFile(root,manifest,binding.assetRef,select(binding.member))
    if(!/\.(png|webp|jpe?g|avif)$/i.test(image.path))throw Error('Only decoded static raster images supported')
    const imageVersion=await readVersion(root,image.path), packedImage=await readVersion(root,task.runtimeArtifact+'/'+image.path)
    result.inputs.push(imageVersion,packedImage)
    if(imageVersion.sha256!==packedImage.sha256)throw Error('Packed image differs: '+image.path)
    const metadata=await sharp(image.bytes).metadata(), width=metadata.width!,height=metadata.height!
    if(!width || !height || (metadata.pages ?? 1)>1)throw Error('Static image dimensions required')
    let frame={x:0,y:0,width,height}
    const tablePath=binding.atlasMember ? select(binding.atlasMember) : resource.file_paths.find(path=>path===image.path.replace(/\.[^.]+$/,'.json'))
    if(tablePath){
      const table=readRegisteredResourceFile(root,manifest,binding.assetRef,tablePath), v=await readVersion(root,table.path), copy=await readVersion(root,task.runtimeArtifact+'/'+table.path)
      result.inputs.push(v,copy)
      if(v.sha256!==copy.sha256)throw Error('Packed atlas metadata differs')
      const sheet=parseSpriteSheet(JSON.parse(table.bytes.toString()))
      if(!sheet || !('frames' in sheet) || !binding.frame)throw Error('Explicit named non-animated atlas frame required')
      validateSpriteSheetBounds(sheet,width,height); frame=spriteSheetSelection(sheet,binding).frame!
    }else if(binding.frame || binding.atlasMember)throw Error('Selected atlas metadata missing')
    // Frame names/resource IDs are not pixel identity: aliases can select the
    // same physical image region. A response patch would then affect both.
    for(const other of [...allBindings.values()].flat()){
      if(other===binding)continue
      const r=manifest.resources.find(r=>r.id===other.assetRef)!
      if(registeredMember(r,other.member)!==image.path)continue
      let region={x:0,y:0,width,height}
      const tablePath=other.atlasMember ? registeredMember(r,other.atlasMember) : r.file_paths.find(p=>p===image.path.replace(/\.[^.]+$/,'.json'))
      if(tablePath){
        const sheet=parseSpriteSheet(JSON.parse(readRegisteredResourceFile(root,manifest,r.id,tablePath).bytes.toString()))
        if(!sheet || !('frames' in sheet) || !other.frame)throw Error('Shared image has an unresolved frame')
        validateSpriteSheetBounds(sheet,width,height);region=spriteSheetSelection(sheet,other).frame!
      }
      if(Math.min(frame.x+frame.width,region.x+region.width)>Math.max(frame.x,region.x) &&
          Math.min(frame.y+frame.height,region.y+region.height)>Math.max(frame.y,region.y))
        throw Error('Shared identical image/frame or overlapping atlas regions cannot isolate this binding; consumption remains unverified')
    }
    const viewport={width:probe.viewport[0],height:probe.viewport[1]}
    const measure=(value:BeeGameContentDocument):Bounds=>{
      if(value.kind==='scene-2d'){
        const inspected=inspectSceneLayout2d(value.data,viewport),node=inspected.nodes.find(n=>n.id===probe.nodeId)
        if(!node?.enabled || node.geometryUnavailable || !node.screenBounds || node.fullyInside!==true)throw Error('Scene geometry is inactive, unavailable or outside the target viewport')
        return node.screenBounds
      }
      if(!('rootId' in value.data))throw Error('Unsupported source projection')
      const data=value.data
      const required=data.nodes.find(n=>n.id===data.rootId)?.data?.targetViewports
      if(Array.isArray(required) && required.some(v=>!Array.isArray(v) || !task.pixelProbes!.some(p=>p.document===probe.document && p.nodeId===probe.nodeId && p.viewport[0]===v[0] && p.viewport[1]===v[1])))throw Error('Pixel probes omit authored UI target viewports')
      const node=inspectUiLayout(data.nodes,data.rootId,viewport).find(n=>n.id===probe.nodeId)
      if(!node?.active || node.outsideViewport)throw Error('UI projection inactive or outside target viewport')
      return node.bounds
    }
    const beforeRegions=binding.tilemap ? tileRegions(doc,binding,viewport,binding.tilemap.tiles) : undefined
    const before=beforeRegions ? combinedBounds(beforeRegions) : measure(doc),variants:PreparedPixelProbe['variants']=[]
    for(const property of binding.tilemap ? ['position','cell-position','grid-cell-size','tile-size'] as const : ['position','size'] as const){
      const changed=structuredClone(doc)
      let changedTiles=binding.tilemap?.tiles, replacementPath:string|undefined
      if(binding.tilemap && changed.kind==='scene-2d'){
        const node=changed.data.nodes.find(n=>n.id===probe.nodeId)!
        if(property==='position'){
          const p=node.transform?.position ?? [0,0,0];node.transform={...node.transform,position:[p[0]+23,p[1]+17,p[2]]}
        }else if(property==='cell-position'){
          const component=node.components!.find(c=>c.id===probe.componentId)!
          const map=parseTilemapData(component.data)
          component.data={...map,cells:map.cells.map(cell=>({...cell,x:cell.x+1}))}
        }else if(property==='grid-cell-size'){
          const map=parseTilemapData(node.components!.find(c=>c.id===probe.componentId)!.data)
          const grid=changed.data.nodes.find(n=>n.id===map.gridNodeId)!.components!.find(c=>c.type==='grid')!
          const size=parseGridData(grid.data).cellSize;grid.data={...grid.data,cellSize:[size[0]+12,size[1]+8]}
        }else{
          changedTiles=structuredClone(binding.tilemap.tiles)
          const tile=changedTiles.tiles[binding.tilemap.tileId]!
          tile.size=[tile.size[0]+16,tile.size[1]+12];replacementPath=binding.tilemap.path
        }
      }else if(changed.kind==='scene-2d'){
        const node=changed.data.nodes.find(n=>n.id===probe.nodeId)!
        if(node.components?.some(c=>c.type==='rect-transform') || node.components?.filter(c=>['sprite-renderer','image','text','tilemap'].includes(c.type)).length!==1)throw Error('Pixel Scene probe requires a single explicit visual, not RectTransform/Tilemap/combined bounds')
        if(property==='position'){
          const p=node.transform?.position ?? [0,0,0]; node.transform={...node.transform,position:[p[0]+23,p[1]+17,p[2]]}
        }else{
          const s=node.transform?.scale ?? [1,1,1];node.transform={...node.transform,position:node.transform?.position ?? [0,0,0],scale:[s[0]*1.25,s[1]*1.2,s[2]]}
        }
      }else if('rootId' in changed.data){
        const node=changed.data.nodes.find(n=>n.id===probe.nodeId)!
        if(!node.layout?.size)throw Error('Explicit UI image size required')
        if(property==='position'){const p=node.layout.position ?? [0,0];node.layout.position=[p[0]+23,p[1]+17]}
        else node.layout.size=[node.layout.size[0]+16,node.layout.size[1]+12]
      }
      const regions=binding.tilemap ? tileRegions(changed,binding,viewport,changedTiles!) : undefined
      const expected=regions ? combinedBounds(regions) : measure(changed)
      if(Math.max(...Object.keys(before).map(k=>Math.abs(before[k as keyof Bounds]-expected[k as keyof Bounds])))<=4)throw Error('Pixel change below measurable tolerance')
      variants.push({property,replacement:JSON.stringify(replacementPath ? changedTiles : changed),expected,
        ...(replacementPath ? {path:replacementPath} : {}),...(regions ? {regions} : {})})
    }
    const markers=[]
    for(const color of [[19,231,97],[233,29,211]]){
      const patch=await sharp({create:{width:frame.width,height:frame.height,channels:4,background:{r:color[0]!,g:color[1]!,b:color[2]!,alpha:1}}}).png().toBuffer()
      const marker=await sharp({create:{width,height,channels:4,background:'#00000000'}}).composite([{input:patch,left:frame.x,top:frame.y}]).png().toBuffer()
      markers.push({body:marker.toString('base64'),color})
    }
    prepared.push({...probe,mode:'pixels',originalSha256:source.sha256,before,variants,resource:imageVersion,markers,
      ...(beforeRegions ? {regions:beforeRegions,tileId:binding.tilemap!.tileId} : {})})
    }
  }
  return prepared
}
