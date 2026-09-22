import { afterEach,expect,test } from 'bun:test'
import { mkdtempSync,mkdirSync,writeFileSync,rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { TILEMAP_AUTHORING_CONTRACT } from './tilemap-authoring-contract'
import { readTileSetResource } from './tilemap-contract'
import { parseTileSet } from '../../../scene-editor/src/tilemap-data'
import { auditBeeGameContentPackage } from './game-content-package'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from './asset-contracts'
import { auditAssetContract } from './asset-contract-audit'

const roots:string[]=[]
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true})})
test('resource/content acceptance resolves TileSets, exact atlas members and versioned cells',async()=>{
  const root=mkdtempSync(join(tmpdir(),'bgs-tile-contract-')); roots.push(root)
  mkdirSync(join(root,'assets/runtime'),{recursive:true});mkdirSync(join(root,'content/scenes'),{recursive:true})
  const hash='a'.repeat(64), example=TILEMAP_AUTHORING_CONTRACT.examples
  const manifest:BeeGameAssetManifest={
    version:9,project_target:{asset_format_capabilities:['json','png'],runtime_asset_root:'assets/runtime',generated_asset_root:'assets/generated'},requirements:[],
    resources:[['RES-TILES',['assets/runtime/tiles.json']],['RES-ATLAS',['assets/runtime/terrain.png','assets/runtime/terrain.json']]].map(([id,files])=>({
      id:id as string,fulfills:[],root_path:(files as string[])[0],file_paths:files as string[],source:{type:'agent-authored' as const,created_at:'2026-09-21T00:00:00Z',reason:'system test'},provisional:false,status:'verified' as const,selected_at:'2026-09-21T00:00:00Z',selection_reason:['system test'],dimension:'agnostic' as const,asset_kind:'data',
    })),
  }
  await writeBeeGameAssetManifest(root,manifest)
  const save=(path:string,value:unknown)=>writeFileSync(join(root,path),JSON.stringify(value))
  save('assets/runtime/tiles.json',example.tileSet)
  save('assets/runtime/terrain.json',{frames:{ground:{frame:{x:0,y:0,w:32,h:32}}}})
  writeFileSync(join(root,'assets/runtime/terrain.png'),await sharp({create:{width:32,height:32,channels:4,background:'#ffffff'}}).png().toBuffer())
  expect(readTileSetResource(root,manifest,'RES-TILES')).toEqual(parseTileSet(example.tileSet))
  expect(auditAssetContract(root).issues).toEqual([])
  save('content/index.json',{schema:'beegame-content-package.v2',id:'test',dimension:'2d',documentRevision:hash,assetManifestRevision:hash,entryScene:'scene',files:['scenes/scene.json'],sceneModel:'game-object-v2'})
  const document={schema:'beegame-content.v1',id:'scene',kind:'scene-2d',assetRefs:['RES-TILES'],data:{
    settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:320,height:180,pixelsPerUnit:32}},
    nodes:[{id:'grid-node',components:[example.grid]},{id:'ground',parentId:'grid-node',components:[structuredClone(example.tilemap),example.renderer]}],
  }}
  save('content/scenes/scene.json',document)
  const audit=()=>auditBeeGameContentPackage(root,{documentRevision:hash,assetManifestRevision:hash,manifest})
  expect(audit().issues).toEqual([])
  const broken=structuredClone(document) as any
  broken.data.nodes[1].components[0].data.cells[0].tileId='missing'
  save('content/scenes/scene.json',broken);expect(audit().issues.join(' ')).toContain('missing')
  save('content/scenes/scene.json',document)
  save('assets/runtime/terrain.json',{frames:{ground:{frame:{x:16,y:0,w:32,h:32}}}})
  expect(()=>readTileSetResource(root,manifest,'RES-TILES')).toThrow('outside image')
  expect(auditAssetContract(root).issues.join(' ')).toContain('outside image')
  save('assets/runtime/terrain.json',{frames:{other:{frame:{x:0,y:0,w:32,h:32}}}})
  expect(()=>readTileSetResource(root,manifest,'RES-TILES')).toThrow('Missing named atlas frame')
  const bad=structuredClone(example.tileSet) as any
  bad.tiles.ground.sprite.member='assets/runtime/not-registered.png'
  save('assets/runtime/tiles.json',bad)
  expect(()=>readTileSetResource(root,manifest,'RES-TILES')).toThrow('unregistered')
})
