import { describe,it,expect } from 'vitest'
import * as THREE from 'three'
import { parseTileSet, parseGridData, parseTilemapData, parseTilemapRendererData, setTileCell, tileRect, validateTilemapGrid } from '../src/tilemap-data'
import { tileBatches } from '../src/tilemap-preview'
import { TILEMAP_AUTHORING_CONTRACT } from '../../agent-workflow-server/src/beegame/tilemap-authoring-contract'
import { makeFixture, type TilemapComponent } from '../src/model'
import { SceneHistory } from '../src/history'
import { operations, applyPatch, patchFor } from '../src/commands'
import { cloneSubtreeForDuplicate } from '../src/editor'
import { exportPackage,importPackage } from '../src/persistence'

const examples=TILEMAP_AUTHORING_CONTRACT.examples
const grid=parseGridData(examples.grid.data), map=parseTilemapData({...examples.tilemap.data,gridNodeId:'hive'})
const set=parseTileSet(examples.tileSet)
const assets={
  image:{id:'image',resourceId:'RES-ATLAS',path:'assets/runtime/terrain.png',name:'terrain',mimeType:'image/png'},
  atlas:{id:'atlas',resourceId:'RES-ATLAS',path:'assets/runtime/terrain.json',name:'atlas',mimeType:'application/json',spriteSheet:{frames:{ground:{x:32,y:0,width:32,height:32}}}},
}
function texture(){const t=new THREE.Texture();t.image={width:64,height:32};return t}
describe('versioned rectangular Tilemap data and editor',()=>{
  it('validates the actual authoring examples, empty maps and rejects ambiguous/unknown data',()=>{
    expect(()=>parseTilemapRendererData(examples.renderer.data)).not.toThrow()
    expect(parseTilemapData({...map,cells:[]} ).cells).toEqual([])
    expect(()=>parseGridData({cellSize:[32,32]})).toThrow('schema')
    expect(()=>parseTilemapData({...map,cells:[map.cells[0],map.cells[0]]})).toThrow('duplicate')
    expect(()=>parseTilemapData({...map,cells:[{x:.2,y:0,tileId:'ground'}]})).toThrow('integers')
    expect(()=>parseTilemapData({...map,tiles:[]})).toThrow('unknown')
    expect(()=>setTileCell(map,NaN,0,null)).toThrow('integers')
    expect(()=>parseTileSet({schema:'beegame-tileset.v1',tiles:{bad:{sprite:{assetRef:'x',member:'../x.png'},size:[32,32]}}})).toThrow('relative')
    expect(()=>parseTileSet({schema:'beegame-tileset.v1',tiles:{bad:{...set.tiles.ground,collision:{points:[[0,0],[1,0],[0,1]],mode:'one-way'}}}})).toThrow('normal')
  })
  it('computes independently known geometry with negative cells, tall tiles, anchor and gap',()=>{
    const rect=tileRect({...grid,cellGap:[2,0]},map,{x:-1,y:2,tileId:'tree'},{sprite:{assetRef:'x',member:'tree.png'},size:[48,80],pivot:[.5,1],offset:[0,16]})
    expect(rect).toEqual({x:-42,y:16,width:48,height:80,pivotPosition:[-18,96]})
    expect(()=>validateTilemapGrid([{id:'other'}],{id:'child',parentId:'other'},map)).toThrow('ancestor')
  })
  it('uses exact atlas UVs and y-down to editor y-up once; batches 10,000 cells',()=>{
    const t=texture(), textures=new Map([['image',t]])
    const batches=tileBatches(grid,map,set.tiles,assets,textures,32)
    expect(batches).toHaveLength(1)
    expect(Array.from(batches[0].geometry.getAttribute('position').array).slice(0,6)).toEqual([-1,-0,0,-1,-1,0])
    expect(Array.from(batches[0].geometry.getAttribute('uv').array).slice(0,4)).toEqual([.5,1,.5,0])
    batches.forEach(b=>b.geometry.dispose())
    const many={...map,cells:Array.from({length:10000},(_,i)=>({x:i%100,y:Math.floor(i/100),tileId:'ground'}))}
    const large=tileBatches(grid,many,set.tiles,assets,textures,32)
    expect(large).toHaveLength(10)
    expect(large.reduce((sum,b)=>sum+b.geometry.getAttribute('position').count,0)).toBe(40000)
    large.forEach(b=>b.geometry.dispose()); t.dispose()
  })
  it('edits cells through existing history and saves/reopens without data loss',()=>{
    const doc=makeFixture(); doc.dimension='2d'
    doc.assets.tiles={id:'tiles',name:'Tiles',path:'tiles.json',mimeType:'application/json',tileSet:set}
    const component:TilemapComponent={id:'tilemap',type:'tilemap',enabled:true,assetId:'tiles',properties:{...map}}
    doc.nodes.hive.components.push(
      {id:'grid',type:'grid',enabled:true,properties:{...grid}},
      component,
      {id:'tile-renderer',type:'tilemap-renderer',enabled:true,properties:{...examples.renderer.data}},
    )
    const history=new SceneHistory(doc), next={...component,properties:{...setTileCell(map,2,-3,'ground')}}
    history.commit([operations.component('hive',next,component)],'Set tile')
    const get=()=>history.document.nodes.hive.components.find(c=>c.id==='tilemap') as TilemapComponent
    expect(parseTilemapData(get().properties).cells).toHaveLength(3)
    history.undo();expect(parseTilemapData(get().properties).cells).toHaveLength(2)
    history.redo();expect(parseTilemapData(get().properties).cells).toHaveLength(3)
    const reopened=importPackage(exportPackage(history.document))
    expect(reopened.nodes.hive.components).toEqual(history.document.nodes.hive.components)
    expect(()=>history.commit([operations.component('hive',{...next,properties:{...setTileCell(map,0,0,'missing')}},next)],'Invalid')).toThrow('missing tile')
    const copy=cloneSubtreeForDuplicate(history.document,'hive')
    const copiedMap=copy.nodes[0].components.find(c=>c.type==='tilemap') as TilemapComponent
    expect(copiedMap.properties.gridNodeId).toBe(copy.rootId)
    history.commit(copy.nodes.map(node=>({type:'scene.addGameObject' as const,node})),'Duplicate Grid')
    expect(history.document.nodes[copy.rootId]).toBeDefined()
  })
  it('preserves painter order across multiple images and rejects out-of-bounds frames',()=>{
    const t=texture(), textures=new Map([['image',t],['second',t]])
    const mixed={...assets,second:{...assets.image,id:'second',resourceId:'OTHER'}}
    const tiles={...set.tiles,other:{sprite:{assetRef:'OTHER',member:assets.image.path},size:[32,32] as [number,number]}}
    const cells=[{x:0,y:0,tileId:'ground'},{x:1,y:0,tileId:'other'},{x:2,y:0,tileId:'ground'}]
    const result=tileBatches(grid,{...map,cells},tiles,mixed,textures,32)
    expect(result.map(b=>b.imageId)).toEqual(['image','second','image'])
    result.forEach(b=>b.geometry.dispose())
    const invalid={...assets,atlas:{...assets.atlas,spriteSheet:{frames:{ground:{x:60,y:0,width:32,height:32}}}}}
    expect(()=>tileBatches(grid,map,set.tiles,invalid,textures,32)).toThrow('outside image')
    t.dispose()
  })
  it('stores only changed cells and restores exact array order on erase/undo',()=>{
    const doc=makeFixture();doc.dimension='2d'
    doc.assets.tiles={id:'tiles',name:'Tiles',path:'tiles.json',mimeType:'application/json',tileSet:set}
    const cells=[{x:9,y:0,tileId:'ground'},{x:-2,y:0,tileId:'ground'},{x:4,y:0,tileId:'ground'}]
    doc.nodes.hive.components.push({id:'g',type:'grid',enabled:true,properties:{...grid}},
      {id:'m',type:'tilemap',enabled:true,assetId:'tiles',properties:{...map,cells}},
      {id:'r',type:'tilemap-renderer',enabled:true,properties:{...examples.renderer.data}})
    const history=new SceneHistory(doc)
    const get=()=>parseTilemapData((history.document.nodes.hive.components.find(c=>c.id==='m') as TilemapComponent).properties).cells
    const next=[cells[1],{x:12,y:0,tileId:'ground'}]
    const delta=operations.tileCells('hive','m',cells,next)
    expect(JSON.stringify(delta).length).toBeLessThan(500)
    history.commit([delta],'Erase and paint')
    expect(get()).toEqual(next)
    history.undo();expect(get()).toEqual(cells)
    history.redo();expect(get()).toEqual(next)
    history.undo();expect(get()).toEqual(cells)
    const stale=operations.tileCells('hive','m',[{...cells[0],tileId:'wrong'}],[])
    expect(()=>history.commit([stale],'Stale')).toThrow('stale')
    expect(get()).toEqual(cells)
    const invalid=operations.tileCells('hive','m',cells,[...cells,{x:1,y:1,tileId:'missing'}])
    expect(()=>history.commit([invalid],'Invalid')).toThrow('missing tile')
    expect(get()).toEqual(cells)
    if(delta.type!=='scene.setTileCells')throw Error('Wrong operation')
    expect(applyPatch(history.document,patchFor(history.document,[{...delta,changes:[delta.changes[0],delta.changes[0]]}],'Duplicate')).applied).toBe(false)
    expect(applyPatch(history.document,patchFor(history.document,[{...delta,changes:[{...delta.changes[0],x:.5}]}],'Fractional')).applied).toBe(false)
  })
})
