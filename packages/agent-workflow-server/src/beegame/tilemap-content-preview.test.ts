import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from './asset-contracts'
import { renderSceneContentPreviews } from './scene-content-preview'
import { tilemapContentOverlay } from './tilemap-content-preview'
import { affine2d } from '../../../scene-editor/src/content-coordinates'
import type { TilemapData } from '../../../scene-editor/src/tilemap-data'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive:true,force:true}) })
async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'tilemap-preview-'));roots.push(root)
  for(const path of ['assets/runtime','content/scenes','.beegame/workflow']) await mkdir(join(root,path),{recursive:true})
  const save=(path:string,value:unknown)=>writeFile(join(root,path),JSON.stringify(value))
  const manifest:BeeGameAssetManifest={
    version:9,requirements:[],project_target:{asset_format_capabilities:['png','json'],runtime_asset_root:'assets/runtime',generated_asset_root:'assets/generated'},
    resources:[['TILES',['assets/runtime/tiles.json']],['ART',['assets/runtime/colors.png','assets/runtime/frames.json']]].map(([id,paths])=>({
      id:id as string,root_path:(paths as string[])[0],file_paths:paths as string[],fulfills:[],
      status:'verified' as const,source:{type:'agent-authored' as const,created_at:'2026-09-21',reason:'offline fixture'},
      provisional:false,selected_at:'2026-09-21',selection_reason:['offline fixture'],dimension:'agnostic' as const,asset_kind:'data',
    })),
  }
  await writeBeeGameAssetManifest(root,manifest)
  const pixels=Buffer.alloc(16*8*4)
  for(let y=0;y<8;y++)for(let x=0;x<16;x++){const i=(y*16+x)*4;pixels[i]=x<8?255:0;pixels[i+1]=x<8?0:255;pixels[i+3]=255}
  await writeFile(join(root,'assets/runtime/colors.png'),await sharp(pixels,{raw:{width:16,height:8,channels:4}}).png().toBuffer())
  const tile=(frame:string,size:[number,number]=[8,8])=>({sprite:{assetRef:'ART',member:'assets/runtime/colors.png',atlasMember:'assets/runtime/frames.json',frame},size})
  await save('assets/runtime/tiles.json',{schema:'beegame-tileset.v1',tiles:{red:tile('red'),green:tile('green'),tall:{...tile('green',[8,16]),pivot:[.5,1]}}})
  await save('assets/runtime/frames.json',{frames:{red:{frame:{x:0,y:0,w:8,h:8}},green:{frame:{x:8,y:0,w:8,h:8}}}})
  const hash='a'.repeat(64)
  await save('.beegame/workflow/run.json',{revision:{document:hash,resource:hash}})
  await save('content/index.json',{schema:'beegame-content-package.v2',id:'test',dimension:'2d',documentRevision:hash,assetManifestRevision:hash,entryScene:'scene',files:['scenes/scene.json'],sceneModel:'game-object-v2'})
  const grid={schema:'grid.v1' as const,cellSize:[8,8] as [number,number]}
  const map:TilemapData={schema:'tilemap.v1',gridNodeId:'grid',cells:[{x:0,y:0,tileId:'red'},{x:1,y:0,tileId:'green'}]}
  const document={schema:'beegame-content.v1',id:'scene',kind:'scene-2d',assetRefs:['TILES'],data:{
    settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:64,height:64,pixelsPerUnit:8}},
    nodes:[
      {id:'grid',transform:{position:[16,16,0],rotation:[0,0,0],scale:[1,1,1]},components:[{id:'g',type:'grid',data:grid}]},
      {id:'map',parentId:'grid',components:[{id:'m',type:'tilemap',assetRef:'TILES',data:map},{id:'r',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1',sortingOrder:0}}]},
    ],
  }}
  const render=async()=>{
    await save('content/scenes/scene.json',document)
    const [path]=await renderSceneContentPreviews(root)
    const {data,info}=await sharp(await readFile(path)).ensureAlpha().raw().toBuffer({resolveWithObject:true})
    return (x:number,y:number)=>[...data.subarray((y*info.width+x)*4,(y*info.width+x)*4+4)]
  }
  return {root,save,manifest,document,grid,map,render}
}
test('PNG preview resolves real atlas frames, negative cells, tall tiles and empty maps',async()=>{
  const f=await fixture()
  f.map.cells=[{x:-1,y:0,tileId:'red'},{x:0,y:0,tileId:'tall'}]
  let pixel=await f.render()
  expect(pixel(12,20)).toEqual([255,0,0,255])
  expect(pixel(20,8)).toEqual([0,255,0,255])
  expect(pixel(20,24)).toEqual([24,26,32,255])
  f.map.cells=[];pixel=await f.render()
  expect(pixel(12,20)).toEqual([24,26,32,255])
})
test('PNG preview inherits rotation and scale once and clips offscreen cells',async()=>{
  const f=await fixture()
  f.document.data.nodes[0].transform={position:[32,16,0],rotation:[0,0,Math.PI/2],scale:[2,1,1]}
  f.map.cells.push({x:9999,y:9999,tileId:'red'})
  const pixel=await f.render()
  expect(pixel(28,20)).toEqual([255,0,0,255])
  expect(pixel(28,36)).toEqual([0,255,0,255])
  expect(pixel(36,20)).toEqual([24,26,32,255])
})
test('PNG preview respects renderer order, disabled renderer and disabled ancestors',async()=>{
  const f=await fixture()
  const front=structuredClone(f.document.data.nodes[1]) as any
  front.id='front';front.components[0].id='fm';front.components[1].id='fr'
  front.components[0].data.cells=[{x:0,y:0,tileId:'green'}]
  front.components[1].data.sortingOrder=10
  f.document.data.nodes.splice(1,0,front)
  let pixel=await f.render()
  expect(pixel(20,20)).toEqual([0,255,0,255])
  front.components[1].data.enabled=false;pixel=await f.render()
  expect(pixel(20,20)).toEqual([255,0,0,255])
  ;(f.document.data.nodes[0] as any).enabled=false;pixel=await f.render()
  expect(pixel(20,20)).toEqual([24,26,32,255])
})
test('invalid image bytes fail instead of emitting a successful partial preview',async()=>{
  const f=await fixture()
  await writeFile(join(f.root,'assets/runtime/colors.png'),'not an image')
  await expect(f.render()).rejects.toThrow('Scene preview failed')
})
test('10,000 cells produce one layer image with shared tile definitions',async()=>{
  const f=await fixture()
  const start=performance.now(),rss=process.memoryUsage().rss
  const result=await tilemapContentOverlay({workspacePath:f.root,manifest:f.manifest,assetRef:'TILES',grid:f.grid,
    map:{...f.map,cells:Array.from({length:10000},(_,i)=>({x:i%100,y:Math.floor(i/100),tileId:i%2?'red':'green'}))},
    pose:affine2d(0,0),canvas:{width:800,height:800}})
  expect(result?.left).toBe(0)
  expect(await sharp(result!.input as Buffer).metadata()).toMatchObject({width:800,height:800})
  console.log(JSON.stringify({tilemapPngCells:10000,ms:Math.round(performance.now()-start),rssDeltaMiB:Math.round((process.memoryUsage().rss-rss)/1048576)}))
})
