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
const assets:Record<string,SceneAsset>={
  TILES:{id:'TILES',name:'TileSet',path:'tiles.json',mimeType:'application/json',tileSet:tiles},
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
const digest='a'.repeat(64)
const doc=sceneContentToEditorDocument({document:source,documentRevision:digest,foundationDocumentRevision:digest,assetManifestRevision:digest,assets})
;(window as any).sceneCameraFixture={source,tiles,before:JSON.stringify(source),editorBefore:JSON.stringify(doc),doc}
createRoot(document.getElementById('root')!).render(<div style={{width:'100vw',height:'100vh'}}>
  <SceneEditor initialDocument={doc} initialView={{position:[0,0,10],target:[0,0,0],showGizmos:true}} />
</div>)
