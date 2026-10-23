// Local editor-only fixture: no generated project, API, model or game runtime.
import React, { useEffect, useState } from 'react'
import { gpuHandles } from './gpu-probe'
import { createRoot } from 'react-dom/client'
import { SceneEditor } from '../../src/editor'
import { makeFixture, type SceneDocument } from '../../src/model'
import { importPackage,exportPackage } from '../../src/persistence'
import '../../src/styles.css'

function fixture(count: number): SceneDocument {
  const doc=makeFixture();doc.id='tilemap-verification';doc.name='Tilemap verification';doc.dimension='2d';doc.pixelsPerUnit=32
  const image=document.createElement('canvas');image.width=64;image.height=32
  const c=image.getContext('2d')!;c.fillStyle='#25ad69';c.fillRect(0,0,32,32);c.fillStyle='#ffe080';c.fillRect(32,0,32,32)
  c.strokeStyle='#082f20';c.strokeRect(.5,.5,31,31);c.strokeRect(32.5,.5,31,31)
  const tiles={schema:'beegame-tileset.v1' as const,tiles:{
    ground:{sprite:{assetRef:'ATLAS',member:'terrain.png',atlasMember:'terrain.json',frame:'ground'},size:[32,32] as [number,number]},
    tree:{sprite:{assetRef:'ATLAS',member:'terrain.png',atlasMember:'terrain.json',frame:'tree'},size:[32,64] as [number,number],pivot:[.5,1] as [number,number],collision:{points:[[-8,-16],[8,-16],[8,0],[-8,0]] as [number,number][],mode:'solid' as const}},
  }}
  doc.assets={
    tiles:{id:'tiles',name:'TileSet',path:'tiles.json',mimeType:'application/json',tileSet:tiles},
    image:{id:'image',resourceId:'ATLAS',name:'terrain.png',path:'terrain.png',mimeType:'image/png',bytes:image.toDataURL()},
    atlas:{id:'atlas',resourceId:'ATLAS',name:'terrain.json',path:'terrain.json',mimeType:'application/json',spriteSheet:{frames:{ground:{x:0,y:0,width:32,height:32},tree:{x:32,y:0,width:32,height:32}}}},
  }
  const cells=Array.from({length:count},(_,i)=>({x:i%100-5,y:Math.floor(i/100),tileId:i%9===0?'tree':'ground'}))
  doc.nodes={grid:{id:'grid',name:'Grid',parentId:null,children:['map'],active:true,locked:false,tags:[],transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},components:[{id:'g',type:'grid',enabled:true,properties:{schema:'grid.v1',cellSize:[32,32]}}]},
    map:{id:'map',name:'Tilemap — select to edit cells',parentId:'grid',children:[],active:true,locked:false,tags:[],transform:{position:[0,0,0],rotation:[0,0,0],scale:[1,1,1]},components:[
      {id:'m',type:'tilemap',enabled:true,assetId:'tiles',properties:{schema:'tilemap.v1',gridNodeId:'grid',cells,collisionEnabled:true}},
      {id:'r',type:'tilemap-renderer',enabled:true,properties:{schema:'tilemap-renderer.v1',sortingOrder:0}},
    ]}}
  doc.nodes.grid.children.push('decoration')
  doc.nodes.decoration={...structuredClone(doc.nodes.map),id:'decoration',name:'Decoration (empty layer)',components:[
    {id:'dm',type:'tilemap',enabled:true,assetId:'tiles',properties:{schema:'tilemap.v1',gridNodeId:'grid',cells:[]}},
    {id:'dr',type:'tilemap-renderer',enabled:true,properties:{schema:'tilemap-renderer.v1',sortingOrder:1}},
  ]}
  doc.rootIds=['grid'];return doc
}
function App(){
  const [gpu,setGpu]=useState(gpuHandles)
  useEffect(()=>{const timer=setInterval(()=>setGpu(gpuHandles()),500);return()=>clearInterval(timer)},[])
  const [doc,setDoc]=useState(()=>fixture(30)),[key,setKey]=useState(0),[saved,setSaved]=useState<SceneDocument|null>(null),[status,setStatus]=useState('30 cells; green ground, tall yellow tiles; no paid calls')
  const open=(n:number)=>{const start=performance.now();setDoc(fixture(n));setKey(k=>k+1);requestAnimationFrame(()=>requestAnimationFrame(()=>setStatus(`${n} cells; UI commit ${Math.round(performance.now()-start)} ms (not GPU-ready timing)`)))}
  return <><div style={{position:'fixed',bottom:0,left:0,zIndex:100000,height:40,background:'#12151c',color:'white',font:'13px system-ui',display:'flex',alignItems:'center',gap:12}}>
    <button onClick={()=>open(30)}>Small map</button><button onClick={()=>open(10000)}>10,000 cells</button>
    <button disabled={!saved} onClick={()=>{setDoc(importPackage(exportPackage(saved!)));setKey(k=>k+1);setStatus('Reopened saved editor document')}}>Reopen saved</button>
    <output>{status}</output><output style={{position:'fixed',right:8,top:80,zIndex:100000,background:'#12151c',padding:6}}>Live GL: {gpu.buffers} buffers / {gpu.textures} textures</output>
  </div><div style={{height:'calc(100vh - 40px)'}}>
    <SceneEditor key={key} initialDocument={doc} storageKey="tilemap-verification-only" initialProjection="orthographic" initialExpanded={{grid:true}}
      initialView={{position:[10,0,45],target:[10,0,0],showGizmos:true}}
      onSave={value=>{setSaved(value);setStatus('Saved '+((value.nodes.map.components[0] as any).properties.cells.length)+' ground cells; '+((value.nodes.decoration.components[0] as any).properties.cells.length)+' decoration cells')}}/>
  </div></>
}
createRoot(document.getElementById('root')!).render(<App/>)
