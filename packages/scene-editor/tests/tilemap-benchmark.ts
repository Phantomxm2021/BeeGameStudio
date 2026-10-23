// Opt-in, no model/network/project writes: bun run packages/scene-editor/tests/tilemap-benchmark.ts
import { Texture } from 'three'
import { makeFixture, type TilemapComponent } from '../src/model'
import { SceneHistory } from '../src/history'
import { operations } from '../src/commands'
import { exportPackage,importPackage } from '../src/persistence'
import { tileBatches } from '../src/tilemap-preview'
import { parseTilemapData,type GridData,type TileSetData } from '../src/tilemap-data'
import { paintCells,cellLine } from '../src/tilemap-paint'

const grid:GridData={schema:'grid.v1',cellSize:[32,32]}
const set:TileSetData={schema:'beegame-tileset.v1',tiles:{ground:{sprite:{assetRef:'ART',member:'tile.png'},size:[32,32]}}}
const doc=makeFixture();doc.dimension='2d';doc.pixelsPerUnit=32
doc.assets={tiles:{id:'tiles',name:'tiles',path:'tiles.json',mimeType:'application/json',tileSet:set},
  image:{id:'image',resourceId:'ART',name:'tile',path:'tile.png',mimeType:'image/png'}}
const component:TilemapComponent={id:'m',type:'tilemap',enabled:true,assetId:'tiles',properties:{schema:'tilemap.v1',gridNodeId:'hive',cells:Array.from({length:10000},(_,i)=>({x:i%100,y:Math.floor(i/100),tileId:'ground'}))}}
doc.nodes={hive:{...doc.nodes.hive,children:[],parentId:null,components:[
  {id:'g',type:'grid',enabled:true,properties:{...grid}},component,
  {id:'r',type:'tilemap-renderer',enabled:true,properties:{schema:'tilemap-renderer.v1',sortingOrder:0}},
]}};doc.rootIds=['hive']
const tex=new Texture();tex.image={width:32,height:32}
const textures=new Map([['image',tex]]),history=new SceneHistory(doc)
const samples:Record<string,number[]>={}
const measure=<T>(name:string,work:()=>T):T=>{
  const start=performance.now();const value=work();(samples[name]??=[]).push(performance.now()-start);return value
}
const current=()=>history.document.nodes.hive.components.find(c=>c.type==='tilemap') as TilemapComponent
const heap=process.memoryUsage().heapUsed
for(let i=0;i<20;i++){
  const base=current(),map=parseTilemapData(base.properties)
  const cells=measure('strokeDraftMs',()=>paintCells(map.cells,cellLine({x:0,y:100+i},{x:19,y:100+i}),'ground'))
  measure('commitMs',()=>history.commit([operations.tileCells('hive',base.id,map.cells,cells)],'Paint tiles'))
  measure('geometryMs',()=>{
    const batches=tileBatches(grid,parseTilemapData(current().properties),set.tiles,history.document.assets,textures,32)
    if(batches.length!==Math.ceil(cells.length/1024))throw Error('Unexpected tile batch count')
    for(const batch of batches)batch.geometry.dispose()
  })
}
for(let i=0;i<20;i++)measure('undoMs',()=>history.undo())
if(parseTilemapData(current().properties).cells.length!==10000)throw Error('Undo lost cells')
for(let i=0;i<20;i++)measure('redoMs',()=>history.redo())
const count=parseTilemapData(current().properties).cells.length
const reopened=measure('saveReopenMs',()=>importPackage(exportPackage(history.document)))
if(JSON.stringify(reopened.nodes)!==JSON.stringify(history.document.nodes))throw Error('Reopen changed authored data')
tex.dispose()
console.log(JSON.stringify({cells:10000,strokes:20,cellsAfterRedo:count,heapGrowthMiB:Math.round((process.memoryUsage().heapUsed-heap)/1048576),
  historyJsonBytes:JSON.stringify(history.committedOperations).length,
  note:'CPU only; heap includes retained undo history and uncollected temporaries, not a leak measurement.',
  timings:Object.fromEntries(Object.entries(samples).map(([key,values])=>{values.sort((a,b)=>a-b);return[key,{median:Math.round(values[Math.floor(values.length/2)]*10)/10,p95:Math.round(values[Math.min(values.length-1,Math.ceil(values.length*.95)-1)]*10)/10}]}))},null,2))
