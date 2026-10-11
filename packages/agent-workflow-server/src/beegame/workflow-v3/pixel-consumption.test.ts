import { test, expect } from 'bun:test'
import { mkdtemp, mkdir, writeFile, rm, cp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { runChecks, checkIsCurrent } from './checks'
import { sceneLayoutFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { assetManifestAuthoringExamples } from '../asset-manifest-authoring-contract'
import { writeBeeGameAssetManifest } from '../asset-contracts'
import type { TaskSpec } from './state'

for(const mode of ['consume','parent','camera','ignore-parent','ignore-camera','ignore-position','ignore-size','wrong-position','ignore-image','hidden','no-fetch','stale-copy','missing-probe','atlas','wrong-frame','ui','missing-viewport','shared','3d'] as const){
  test('actual Canvas source and image consumption: '+mode,async()=>{
    const root=await mkdtemp(join(tmpdir(),'bgs-v3-pixels-'))
    try{
      const manifest=assetManifestAuthoringExamples().canonical, resource=manifest.resources[0]!
      manifest.project_target!.asset_format_capabilities=['json','png']
      resource.root_path='assets/runtime/example/image.png';resource.file_paths=[resource.root_path]
      const atlas=mode==='atlas'||mode==='wrong-frame'
      if(atlas)resource.file_paths.push('assets/runtime/example/image.json')
      await mkdir(join(root,'assets/runtime/example'),{recursive:true})
      await writeFile(join(root,resource.root_path),await sharp({create:{width:80,height:40,channels:4,background:'#327bb8'}}).png().toBuffer())
      if(atlas)await writeFile(join(root,'assets/runtime/example/image.json'),JSON.stringify({frames:{
        left:{frame:{x:0,y:0,w:40,h:40}},right:{frame:{x:40,y:0,w:40,h:40}},
      }}))
      await writeBeeGameAssetManifest(root,manifest)
      const scene=sceneLayoutFixture() as any
      scene.assetRefs=[resource.id];scene.data.nodes[1].transform={position:[-100,-50,0]}
      scene.data.nodes[1].components=[{id:'sprite',type:'sprite-renderer',assetRef:resource.id,data:{size:[80,40],...(atlas?{frame:'left'}:{})}}]
      if(mode==='parent'||mode==='ignore-parent'){
        scene.data.nodes[1].parentId='group'
        scene.data.nodes.push({id:'group',transform:{position:[12,8,0],scale:[1.5,1.25,1]}})
      }
      if(mode==='camera'||mode==='ignore-camera')scene.data.nodes[0].transform={position:[25,15,0]}
      if(mode==='shared'){
        const other={...structuredClone(scene.data.nodes[1]),id:'other',transform:{position:[50,50,0]}}
        other.components[0].id='sprite-other';scene.data.nodes.push(other)
      }
      if(mode==='3d')scene.kind='scene-3d'
      const ui=uiLayoutFixture() as any
      ui.assetRefs=[resource.id];ui.data.nodes[0].data.targetViewports=[[960,540]];ui.data.nodes[1].data={image:{assetRef:resource.id}}
      const isUi=mode==='ui'||mode==='missing-viewport'
      if(isUi){scene.assetRefs=[];scene.data.nodes[1].components=[]}
      if(mode==='missing-viewport')ui.data.nodes[0].data.targetViewports.push([600,360])
      await mkdir(join(root,'content/scenes'),{recursive:true});await mkdir(join(root,'content/ui'),{recursive:true})
      const path=isUi?'content/ui/menu.json':'content/scenes/level.json',body=JSON.stringify(isUi?ui:scene)
      await writeFile(join(root,'content/scenes/level.json'),JSON.stringify(scene))
      if(isUi)await writeFile(join(root,path),body)
      await writeFile(join(root,'content/index.json'),JSON.stringify({schema:'beegame-content-package.v2',id:'fixture',sceneModel:'game-object-v2',
        documentRevision:'0'.repeat(64),assetManifestRevision:'0'.repeat(64),dimension:mode==='3d'?'3d':'2d',entryScene:'level',
        files:['scenes/level.json',...(isUi?['ui/menu.json']:[])],documents:[
          {id:'level',kind:scene.kind,path:'scenes/level.json',loadPhase:'startup'},
          ...(isUi?[{id:'menu',kind:'ui-screen',path:'ui/menu.json',loadPhase:'startup'}]:[]),
        ]}))
      await mkdir(join(root,'dist'));await cp(join(root,'content'),join(root,'dist/content'),{recursive:true});await cp(join(root,'assets'),join(root,'dist/assets'),{recursive:true})
      if(mode==='stale-copy')await writeFile(join(root,'dist',path),JSON.stringify(sceneLayoutFixture()))
      // Independent target game renderer. Never uses BGS preview or returns PASS.
      const script=mode==='no-fetch'?'':`const d=await fetch("/${path}").then(r=>r.json()),n=d.data.nodes.find(n=>n.id==="${isUi?'play':'board'}"),im=new Image();
        im.src="/${resource.root_path}";await im.decode();const c=document.querySelector("canvas"),ctx=c.getContext("2d");
        const s=${isUi?'n.layout.size':'n.components[0].data.size'},p=${isUi?'n.layout.position||[0,0]':mode==='ignore-position'?'[-100,-50]':'[...n.transform.position]'};
        const scale=${isUi?'[1,1]':mode==='ignore-size'?'[1,1]':'[...(n.transform.scale||[1,1])]'};
        ${mode==='parent'?'const parent=d.data.nodes.find(x=>x.id===n.parentId);for(let i=0;i<2;i++){p[i]=parent.transform.position[i]+p[i]*parent.transform.scale[i];scale[i]*=parent.transform.scale[i]}':''}
        ${mode==='camera'?'const camera=d.data.nodes.find(x=>x.id===d.data.cameraNodeId);for(let i=0;i<2;i++)p[i]-=camera.transform.position[i];':''}
        const w=s[0]*scale[0],h=s[1]*scale[1];
        ${mode==='ignore-image'?'ctx.fillStyle="#abc";ctx.fillRect(380-w/2,220-h/2,w,h);':
          atlas?`ctx.drawImage(im,${mode==='wrong-frame'?'40':'0'},0,40,40,480+p[0]-w/2,270+p[1]-h/2,w,h);`:
          `ctx.drawImage(im,480+p[0]${mode==='wrong-position'?'*2':''}-w/2,270+p[1]-h/2,w,h);`}
      `
      await writeFile(join(root,'dist/index.html'),'<style>body{margin:0}canvas{'+(mode==='hidden'?'display:none':'')+'}</style><canvas width="960" height="540"></canvas><script type="module">'+script+'</script>')
      const task:TaskSpec={id:'pixels',kind:'game.verify',goal:'Observe actual source/image use',dependsOn:[],requirementIds:['req.loop'],inputs:[],
        writablePaths:[],expectedOutputs:['dist/index.html'],runtimeArtifact:'dist',checks:['pixel-data-consumption'],
        pixelProbes:[{document:path,nodeId:isUi?'play':'board',...(isUi?{}:{componentId:'sprite'}),selector:'canvas',viewport:[960,540]}]}
      if(mode==='missing-probe')task.pixelProbes![0]!.nodeId='missing'
      if(mode==='shared')task.pixelProbes!.push({...task.pixelProbes![0]!,nodeId:'other',componentId:'sprite-other'})
      const result=(await runChecks(root,task,[])).checks[0]!
      const expected=['consume','atlas','ui','parent','camera'].includes(mode)?'passed':['ignore-position','ignore-size','wrong-position','ignore-parent','ignore-camera'].includes(mode)?'failed':'unverified'
      expect(result.status,result.observation).toBe(expected)
      if(mode==='shared')expect(result.observation).toContain('Shared identical image/frame')
      expect(await Bun.file(join(root,path)).text()).toBe(body)
      const originalImage=await Bun.file(join(root,resource.root_path)).arrayBuffer(),packedImage=await Bun.file(join(root,'dist',resource.root_path)).arrayBuffer()
      expect(originalImage).toEqual(packedImage)
      if(result.status==='passed'){
        const observed=JSON.parse(result.observation).probes[0]
        expect(observed.baseline.sha256).toBe(observed.restored.sha256)
        expect(observed.before.sha256).not.toBe(observed.resourceChanged.sha256)
        expect(observed.changed).toHaveLength(2)
        expect(await checkIsCurrent(root,result)).toBe(true)
        await writeFile(join(root,resource.root_path),'changed')
        expect(await checkIsCurrent(root,result)).toBe(false)
      }
    }finally{await rm(root,{recursive:true,force:true})}
  },30000)
}
