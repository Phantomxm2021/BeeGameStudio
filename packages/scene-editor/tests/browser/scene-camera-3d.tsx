// Local GLB fixture: uses the existing model loader, never a game project or remote asset.
import React from 'react'
import { createRoot } from 'react-dom/client'
import { BoxGeometry, Euler, Mesh, MeshBasicMaterial, Quaternion, Scene, Vector3, Matrix4, PerspectiveCamera, OrthographicCamera } from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { SceneEditor } from '../../src/editor'
import { makeFixture, type CameraComponent } from '../../src/model'
import { resolveSceneCameraView, type SceneFraming } from '../../src/scene-camera'
import '../../src/styles.css'

async function mount() {
  const geometry=new BoxGeometry(1,1,1), material=new MeshBasicMaterial({color:'#ff0000'})
  const model=new Scene();model.add(new Mesh(geometry,material))
  const glb=await new GLTFExporter().parseAsync(model,{binary:true}) as ArrayBuffer
  geometry.dispose();material.dispose()
  const doc=makeFixture();doc.dimension='3d';doc.cameraNodeId='camera'
  for (const id of ['hive','flower','sun']) delete doc.nodes[id]
  const root=doc.nodes.root
  root.children=['camera','box'];root.transform.position=[2,1,3]
  root.transform.quaternion=new Quaternion().setFromEuler(new Euler(.12,.35,-.08)).toArray()
  doc.nodes.camera.transform.position=[0,0,6]
  const component=doc.nodes.camera.components[0] as CameraComponent
  component.orthographic=false;component.orthographicSize=3;component.nearClip=.1;component.farClip=100
  component.properties={viewport:{width:1280,height:720},fieldOfView:60,framing:'expand'}
  doc.nodes.box={...structuredClone(doc.nodes.camera),id:'box',name:'Red box',children:[],transform:{position:[.6,.2,0],rotation:[0,0,0],scale:[1,1,1]},components:[
    {id:'mesh',type:'mesh-filter',enabled:true,assetId:'GLB',properties:{}},
    {id:'material',type:'mesh-renderer',enabled:true,properties:{},material:{mode:'unlit',color:'#ff0000',metalness:0,roughness:1,opacity:1,alphaMode:'opaque'}},
  ]}
  doc.settings={background:'#000000',showGrid:false,ambientColor:'#ffffff',ambientIntensity:0,exposure:1,fogEnabled:false,fogColor:'#000000',fogNear:10,fogFar:60}
  let binary='';for(const byte of new Uint8Array(glb))binary+=String.fromCharCode(byte)
  doc.assets={GLB:{id:'GLB',name:'box.glb',path:'box.glb',mimeType:'model/gltf-binary',bytes:btoa(binary)}}
  const before=JSON.stringify(doc)
  // Independent native projection of GLB vertices, used to check real raster bounds.
  const expected=(orthographic:boolean,framing:SceneFraming,host:{width:number;height:number})=>{
    const view=resolveSceneCameraView({viewport:{width:1280,height:720},fieldOfView:60,framing,orthographic,orthographicSize:3},host)
    const native=orthographic
      ? new OrthographicCamera(-view.halfWidth!,view.halfWidth!,view.halfHeight!,-view.halfHeight!,.1,100)
      : new PerspectiveCamera(view.verticalFieldOfView,view.aspect,.1,100)
    const parent=new Matrix4().compose(new Vector3(2,1,3),new Quaternion(...root.transform.quaternion!),new Vector3(1,1,1))
    const cameraWorld=parent.clone().multiply(new Matrix4().makeTranslation(0,0,6))
    cameraWorld.decompose(native.position,native.quaternion,native.scale);native.updateMatrixWorld(true)
    const points=[]
    for(const x of [-.5,.5])for(const y of [-.5,.5])for(const z of [-.5,.5])
      points.push(new Vector3(x+.6,y+.2,z).applyMatrix4(parent).project(native))
    return {view,bounds:{left:Math.min(...points.map(p=>(p.x+1)*view.rect.width/2)),right:Math.max(...points.map(p=>(p.x+1)*view.rect.width/2)),
      top:Math.min(...points.map(p=>(1-p.y)*view.rect.height/2)),bottom:Math.max(...points.map(p=>(1-p.y)*view.rect.height/2))}}
  }
  ;(window as any).sceneCamera3dFixture={doc,before,expected}
  createRoot(document.getElementById('root')!).render(<div style={{width:'100vw',height:'100vh'}}>
    <SceneEditor initialDocument={doc} initialView={{position:[7,5,9],target:[2,1,3],showGizmos:false}} />
  </div>)
}
void mount()
