import { test, expect } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import sharp from 'sharp'
import { writeBeeGameAssetManifest, type BeeGameAssetManifest } from '../asset-contracts'
import { auditAssetContract } from '../asset-contract-audit'
import { sceneLayoutFixture, uiLayoutFixture } from '../fixtures/layout-fixture'
import { runContentCheck } from './content-checks'
import { measurementSummary } from './agent-measurement'
import { checkIsCurrent } from './checks'
import { CHECK_VERSIONS } from './check-versions'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(),'bgs-resource-structure-'))
  await mkdir(join(root,'assets/runtime'),{recursive:true})
  const path = 'assets/runtime/surface.png'
  await writeFile(join(root,path),await sharp({create:{width:12,height:2,channels:4,background:'#fff'}}).png().toBuffer())
  const manifest: BeeGameAssetManifest = {version:9,requirements:[
    {id:'surface',required:true,acquisition_profile:{dimensions:['3D'],asset_kinds:['texture'],styles:[]}},
  ],resources:[{id:'surface-art',fulfills:['surface'],source:{type:'agent-authored',created_at:new Date().toISOString(),reason:'fixture'},
    root_path:path,file_paths:[path],provisional:false,status:'verified',selected_at:new Date().toISOString(),
    selection_reason:['fixture'],dimension:'2D',asset_kind:'texture'}]}
  return {root,path,manifest,save:()=>writeBeeGameAssetManifest(root,manifest),
    close:()=>rm(root,{recursive:true,force:true})}
}

test('shared UI capability gaps are visible in existing coverage without rejecting valid custom consumers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-ui-compatibility-'))
  try {
    const ui: any = uiLayoutFixture()
    ui.data.nodes[1].role = 'slider'
    ui.data.nodes[1].bindings = { interactable: 'canAdjust' }
    await mkdir(join(root, 'content/ui'), { recursive: true })
    await writeFile(join(root, 'content/ui/menu.json'), JSON.stringify(ui))
    const result = await runContentCheck(root, 'content-resources', { expectedOutputs: ['content/ui/menu.json'] }, [], {})
    expect(result.status, result.observation).toBe('passed')
    expect(result.coverage?.uiSurfaceCompatibility).toMatchObject([{ document: 'content/ui/menu.json', supported: false,
      issues: expect.arrayContaining([expect.objectContaining({ nodeId: 'play', property: 'role' }),
        expect.objectContaining({ nodeId: 'play', property: 'bindings.interactable' })]) }])
    expect(result.coverage?.limitations.join(' ')).toContain('advisory, not a content failure')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('static PNG texture can serve 3D without mandatory animation; all registered needs are checked without Scene refs', async () => {
  const f=await fixture()
  try {
    await f.save()
    const valid=await runContentCheck(f.root,'content-resources',{expectedOutputs:[]},[],{})
    expect(valid.status).toBe('passed')
    expect(valid.coverage?.assetContract?.requirements[0]?.structure?.status).toBe('passed')
    expect(valid.coverage?.assetContract?.resources[0]?.fileEvidence[0]?.sha256).toMatch(/^[a-f0-9]{64}$/)
    f.manifest.requirements.push({id:'unbound-rig',required:true,acquisition_profile:{dimensions:['3D'],asset_kinds:['rig'],styles:[]}})
    await f.save()
    const missing=await runContentCheck(f.root,'content-resources',{expectedOutputs:[]},[],{})
    expect(missing.status).toBe('failed')
    expect(missing.observation).toContain('unbound-rig')
    expect(missing.coverage?.assetContract?.requirements.map(row=>row.id)).toEqual(['surface','unbound-rig'])
  }finally{await f.close()}
})

test('atlas structure reaches resource diagnostics with both file identities, but does not certify animation or old receipts',async()=>{
  const f=await fixture()
  try {
    const profile=f.manifest.requirements[0]!.acquisition_profile,resource=f.manifest.resources[0]!
    profile.asset_kinds=['image'];profile.capabilities=['atlas']
    resource.asset_kind='image';resource.capabilities=['atlas']
    const metadata='assets/runtime/surface.json'
    resource.file_paths.push(metadata)
    await writeFile(join(f.root,metadata),JSON.stringify({frames:{region:{frame:{x:0,y:0,w:2,h:2}}}}))
    const hashes=Object.fromEntries(await Promise.all(resource.file_paths.map(async path=>
      [path,createHash('sha256').update(await readFile(join(f.root,path))).digest('hex')])))
    resource.local_file_hashes=hashes
    await f.save()
    const check=await runContentCheck(f.root,'content-resources',{expectedOutputs:[]},[],{})
    expect(check.status,check.observation).toBe('passed')
    expect(check.version).toBe(CHECK_VERSIONS['content-resources'])
    for(const path of resource.file_paths)
      expect(check.inputs.find(input=>input.path===path)?.sha256).toBe(hashes[path])
    expect(check.coverage?.assetContract?.requirements[0]?.structure?.observations.join(' '))
      .toContain('1 named sprite frames verified')
    expect(check.observation).toContain('Not runtime or whole-game semantic coverage')
    expect(await checkIsCurrent(f.root,check)).toBe(true)
    const previous={...check,version:'v3-content.4'},saved=JSON.stringify(previous)
    expect(await checkIsCurrent(f.root,previous)).toBe(false)
    expect(JSON.stringify(previous)).toBe(saved)

    profile.capabilities=['atlas','frame-sequence'];resource.capabilities=['atlas','frame-sequence']
    await f.save()
    const unknown=await runContentCheck(f.root,'content-resources',{expectedOutputs:[]},[],{})
    expect(unknown.status).toBe('unverified')
    const observation=unknown.coverage?.assetContract?.requirements[0]?.structure?.observations.join(' ')
    expect(observation).toContain('1 named sprite frames verified')
    expect(observation).toContain('unverified capabilities/components [frame-sequence]')
  }finally{await f.close()}
})

test('six atlas regions and self-reported frame-sequence do not prove animation',async()=>{
  const f=await fixture()
  try {
    const requirement=f.manifest.requirements[0]!
    requirement.acquisition_profile.asset_kinds=['sprite-atlas']
    requirement.acquisition_profile.capabilities=['frame-sequence']
    const resource=f.manifest.resources[0]!
    resource.asset_kind='sprite-atlas';resource.capabilities=['frame-sequence']
    resource.technical_facts={animationCount:6}
    resource.file_paths.push('assets/runtime/surface.json')
    await writeFile(join(f.root,'assets/runtime/surface.json'),JSON.stringify({frames:Object.fromEntries(
      Array.from({length:6},(_,i)=>['region'+i,{frame:{x:i*2,y:0,w:2,h:2}}]))}))
    await f.save()
    const check=await runContentCheck(f.root,'content-resources',{expectedOutputs:[]},[],{})
    expect(check.status).toBe('unverified')
    expect(check.coverage?.assetContract?.requirements[0]?.structure?.status).toBe('unverified')
  }finally{await f.close()}
})

test('actual GLB counts override authored animation claims; one model can contain multiple required components',async()=>{
  const f=await fixture()
  try {
    const requirement=f.manifest.requirements[0]!
    requirement.acquisition_profile.asset_kinds=['model']
    requirement.acquisition_profile.coverage=[{asset_kinds:['model'],capabilities:['rigged','contains-animations'],
      embedded_kinds:['skeleton','animation-clip']}]
    const resource=f.manifest.resources[0]!
    resource.asset_kind='model';resource.dimension='3D';resource.capabilities=['rigged','contains-animations']
    resource.embedded_kinds=['skeleton','animation-clip'];resource.technical_facts={animationCount:99}
    resource.root_path='assets/runtime/actor.glb';resource.file_paths=[resource.root_path]
    const saveModel=async(animations:unknown[])=>{
      const text=JSON.stringify({asset:{version:'2.0'},meshes:[{primitives:[]}],skins:[{joints:[0]}],animations})
      const json=Buffer.from(text.padEnd(Math.ceil(text.length/4)*4,' '))
      const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4)
      header.writeUInt32LE(20+json.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16)
      await writeFile(join(f.root,resource.root_path),Buffer.concat([header,json]))
    }
    await saveModel([]);await f.save()
    const failed=auditAssetContract(f.root)
    expect(failed.requirements[0]?.structure?.status).toBe('failed')
    expect(failed.resources[0]?.fileEvidence[0]?.facts.animationCount).toBe(0)
    await saveModel([{channels:[],samplers:[]}])
    const structural=auditAssetContract(f.root)
    expect(structural.requirements[0]?.structure?.status).toBe('passed')
    expect(structural.requirements[0]?.structure?.observations.join(' ')).toContain('runtime use/quality unverified')
  }finally{await f.close()}
})

test.each(['2d','3d'] as const)('Scene hierarchy/component/behavior inventory survives without runtime probes; XR is not passed by file facts: %s',async dimension=>{
  const f=await fixture()
  try {
    await f.save()
    const scene:any=sceneLayoutFixture()
    scene.kind='scene-'+dimension
    scene.assetRefs=['surface-art']
    scene.data.nodes[1].parentId='camera'
    scene.data.nodes[1].components=[{id:'art-renderer',type:'sprite-renderer',assetRef:'surface-art',data:{member:f.path}}]
    scene.data.nodes[1].data={behaviors:[{id:'response',kind:'project-script',config:{source:'src/response.ts'}}]}
    const path='content/scenes/level.json'
    await mkdir(join(f.root,'content/scenes'),{recursive:true})
    const before=JSON.stringify(scene);await writeFile(join(f.root,path),before)
    const check=await runContentCheck(f.root,'content-resources',{expectedOutputs:[path]},[],{})
    expect(check.coverage?.sceneNodeBindings?.[1]).toMatchObject({nodeId:'board',parentId:'camera',dimension,
      components:[{id:'art-renderer',type:'sprite-renderer',bindings:[{assetRef:'surface-art'}]}],
      behaviors:[{id:'response',kind:'project-script'}]})
    const summary=measurementSummary({id:'fixture',requestKey:'fixture',runtimeArtifact:'dist',reports:[],reportPaths:[],
      requirementsRevision:'fixture',startedAt:new Date().toISOString(),checks:[check]},false)
    expect(summary.sceneBindingCoverage.nodes?.every(node=>node.observations.length===0)).toBe(true)
    expect(summary.sceneBindingCoverage.limitation).toContain('XR')
    expect(summary.quality).toBe('unverified')
    expect(await readFile(join(f.root,path),'utf8')).toBe(before)
  }finally{await f.close()}
})
