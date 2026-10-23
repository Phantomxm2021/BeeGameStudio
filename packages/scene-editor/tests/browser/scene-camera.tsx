// Isolated platform fixture, not a generated game or a user project.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { SceneEditor } from '../../src/editor'
import { sceneContentToEditorDocument } from '../../../../apps/frontend/src/components/Workspace/sceneContentAdapter'
import type { BeeGameSceneContentDocument } from '../../../../apps/frontend/src/services/beeGameAdapter'
import type { SceneAsset } from '../../src/model'
import '../../src/styles.css'

const image=document.createElement('canvas');image.width=64;image.height=32
const ctx=image.getContext('2d')!;ctx.fillStyle='#ff0000';ctx.fillRect(0,0,32,32);ctx.fillStyle='#00ff00';ctx.fillRect(32,0,32,32)
const tiles={schema:'beegame-tileset.v1' as const,tiles:{
  red:{sprite:{assetRef:'ATLAS',member:'atlas.png',atlasMember:'atlas.json',frame:'red'},size:[32,32] as [number,number]},
  green:{sprite:{assetRef:'ATLAS',member:'atlas.png',atlasMember:'atlas.json',frame:'green'},size:[32,32] as [number,number]},
}}
const tall = { ...tiles.tiles.green, size: [32,64] as [number,number], pivot: [.5,1] as [number,number] }
const tileSet = { ...tiles, tiles: { ...tiles.tiles, tall } }
const assets:Record<string,SceneAsset>={
  TILES:{id:'TILES',name:'TileSet',path:'tiles.json',mimeType:'application/json',tileSet},
  image:{id:'image',resourceId:'ATLAS',name:'atlas.png',path:'atlas.png',mimeType:'image/png',bytes:image.toDataURL()},
  atlas:{id:'atlas',resourceId:'ATLAS',name:'atlas.json',path:'atlas.json',mimeType:'application/json',spriteSheet:{frames:{red:{x:0,y:0,width:32,height:32},green:{x:32,y:0,width:32,height:32}}}},
}
const source:BeeGameSceneContentDocument={schema:'beegame-content.v1',id:'camera-fixture',kind:'scene-2d',assetRefs:['TILES','ATLAS'],data:{
  cameraNodeId:'camera',settings:{coordinateSystem:{origin:'top-left',units:'logical-pixels',width:320,height:180,pixelsPerUnit:100}},nodes:[
    {id:'camera',name:'Game Camera',transform:{position:[160,90,1000]},components:[{id:'cam',type:'camera',data:{orthographic:true,orthographicSize:.9,coordinateSpace:'logical-pixels',viewport:{width:320,height:180},framing:'expand'}}]},
    {id:'grid',transform:{position:[112,58,0]},components:[{id:'grid-data',type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}]},
    {id:'map',name:'Map',parentId:'grid',components:[
      {id:'map-data',type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'grid',cells:[{x:0,y:0,tileId:'red'},{x:1,y:0,tileId:'green'},{x:2,y:0,tileId:'red'},{x:0,y:1,tileId:'green'},{x:1,y:1,tileId:'red'},{x:2,y:1,tileId:'green'}]}},
      {id:'renderer',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1'}},
    ]},
  ]}}
// Known-pixel cases migrated from the retired offline PNG preview.
const baseMap = source.data.nodes.find(node => node.id === 'map')!
const baseCells = (baseMap.components![0].data as any).cells
baseCells.push({x:9999,y:9999,tileId:'red'})
source.data.nodes.push(
  {id:'negative-grid',transform:{position:[200,140,0]},components:[{id:'ng',type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}]},
  {id:'negative-map',parentId:'negative-grid',components:[
    {id:'nm',type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'negative-grid',cells:[{x:-2,y:0,tileId:'red'},{x:-1,y:0,tileId:'tall'}]}},
    {id:'nr',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1'}}]},
  {id:'rotated-grid',transform:{position:[208,40,0],rotation:[0,0,Math.PI/2],scale:[2,1,1]},components:[{id:'rg',type:'grid',data:{schema:'grid.v1',cellSize:[32,32]}}]},
  {id:'rotated-map',parentId:'rotated-grid',components:[
    {id:'rm',type:'tilemap',assetRef:'TILES',data:{schema:'tilemap.v1',gridNodeId:'rotated-grid',cells:[{x:0,y:0,tileId:'red'}]}},
    {id:'rr',type:'tilemap-renderer',data:{schema:'tilemap-renderer.v1'}}]},
)
for (const [id, disabled, parentDisabled] of [['disabled-renderer',true,false],['disabled-parent',false,true],['ordered-front',false,false]] as const) {
  const node = structuredClone(baseMap)
  node.id=id
  node.components![0].id=id+'-data'
  node.components![1].id=id+'-renderer'
  ;(node.components![0].data as any).cells=[{x:1,y:0,tileId:'red'}]
  ;(node.components![1].data as any).sortingOrder=10
  ;(node.components![1].data as any).enabled=!disabled
  if (parentDisabled) {
    source.data.nodes.push({id:'hidden-parent',parentId:'grid',enabled:false,components:[]})
    node.parentId='hidden-parent'
  }
  if(id==='ordered-front') (node.components![0].data as any).cells=[{x:2,y:1,tileId:'red'}]
  source.data.nodes.splice(1,0,node)
}
const digest='a'.repeat(64)
const doc=sceneContentToEditorDocument({document:source,documentRevision:digest,foundationDocumentRevision:digest,assetManifestRevision:digest,assets})
;(window as any).sceneCameraFixture={source,tiles:tileSet,before:JSON.stringify(source),editorBefore:JSON.stringify(doc),doc}
createRoot(document.getElementById('root')!).render(<div style={{width:'100vw',height:'100vh'}}>
  <SceneEditor initialDocument={doc} initialView={{position:[0,0,10],target:[0,0,0],showGizmos:true}} />
</div>)
