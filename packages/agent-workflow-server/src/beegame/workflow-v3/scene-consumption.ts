import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentDocumentSchema, contentIndexSchema } from '../game-content-schema'
import { readVersion } from './checks'
import type { CheckResult, TaskSpec } from './state'
import { inspectSceneLayout2d, sceneWorldTransforms2d } from '../../../../scene-editor/src/scene-layout-inspection'
import { compose2d, point2d } from '../../../../scene-editor/src/content-coordinates'

type Scene = Extract<ReturnType<typeof contentDocumentSchema.parse>, {kind:'scene-2d'}>
const MARKER = [17,231,113] as const

function spritePolygon(doc: Scene, nodeId: string, componentId: string, viewport: [number,number]) {
  const node=doc.data.nodes.find(node=>node.id===nodeId)!, component=node.components!.find(c=>c.id===componentId)!
  const world=sceneWorldTransforms2d(doc.data.nodes), inspected=inspectSceneLayout2d(doc.data,{width:viewport[0],height:viewport[1]})
  if(!inspected.nodes.find(node=>node.id===nodeId)?.enabled)throw Error('Selected Sprite is not active through its saved parents')
  const visual=component.data ?? {}, rect=node.components?.find(c=>c.type==='rect-transform')?.data
  const size=world.rects.get(nodeId)?.size ?? visual.size, pivot=rect?.pivot ?? visual.anchor ?? [.5,.5]
  if(!Array.isArray(size)||size.length!==2||!size.every(n=>typeof n==='number'&&Number.isFinite(n)&&n>0)||
    !Array.isArray(pivot)||pivot.length!==2||!pivot.every(n=>typeof n==='number'&&Number.isFinite(n)))
    throw Error('Sprite transform observation needs explicit positive size and a finite pivot')
  const matrix=compose2d(inspected.worldToScreen,world.poses.get(nodeId)!),x=-pivot[0]*size[0],y=-pivot[1]*size[1]
  return [[x,y],[x+size[0],y],[x+size[0],y+size[1]],[x,y+size[1]]].map(([x,y])=>point2d(matrix,x,y))
}

export type PreparedSceneProbe = NonNullable<TaskSpec['sceneProbes']>[number] & {
  mode: 'scene'
  originalSha256: string
  marker: readonly number[]
  transformUnverified?: string
  variants: Array<{ property: string; replacement: string; polygon?: [number,number][] }>
}

/** Isolate one registered Scene node in the served build, without changing
 * project files or assuming that the game uses a particular renderer. */
export async function prepareSceneProbes(root: string, task: Pick<TaskSpec, 'sceneProbes'|'runtimeArtifact'>,
  result: CheckResult): Promise<PreparedSceneProbe[]> {
  if (!task.sceneProbes?.length || !task.runtimeArtifact) throw Error('Declare actual Scene node probes and a static build')
  const registry = await readVersion(root, 'content/index.json')
  const packedRegistry = await readVersion(root, task.runtimeArtifact+'/content/index.json')
  result.inputs.push(registry, packedRegistry)
  if (registry.sha256 !== packedRegistry.sha256) throw Error('Packed content registry differs from registered source')
  const index = contentIndexSchema.parse(JSON.parse(await readFile(resolve(root, 'content/index.json'), 'utf8')))
  const prepared: PreparedSceneProbe[] = []
  for (const probe of task.sceneProbes) {
    const entry = index.documents?.find(item => 'content/'+item.path === probe.document)
    if (!entry || entry.kind !== 'scene-2d' || !index.files.includes(entry.path))
      throw Error('Scene probe must select a registered 2D Scene: '+probe.document)
    const source = await readVersion(root, probe.document)
    const packed = await readVersion(root, task.runtimeArtifact+'/'+probe.document)
    result.inputs.push(source, packed)
    if (source.sha256 !== packed.sha256) throw Error('Packed Scene differs from registered source: '+probe.document)
    const doc = contentDocumentSchema.parse(JSON.parse(await readFile(resolve(root, probe.document), 'utf8')))
    if (doc.kind !== 'scene-2d' || doc.id !== entry.id) throw Error('Registered Scene identity differs: '+probe.document)
    const node = doc.data.nodes.find(item => item.id === probe.nodeId)
    if (!node || node.enabled === false) throw Error('Scene probe must select an enabled saved node: '+probe.nodeId)
    const changed = structuredClone(doc)
    changed.data.nodes.find(item => item.id === probe.nodeId)!.enabled = false
    const preparedProbe: PreparedSceneProbe={...probe,mode:'scene',originalSha256:packed.sha256,marker:MARKER,
      variants:[{property:'enabled',replacement:JSON.stringify(changed)}]}
    // An enabled-only screenshot cannot establish transforms. The finite
    // geometry driver supports an actual color-only Sprite, not every custom
    // material, asset, Tilemap or 3D renderer. Unsupported stays unverified.
    const visuals=node.components?.filter(c=>['sprite-renderer','image','text','tilemap-renderer'].includes(c.type)&&c.data?.enabled!==false) ?? []
    const sprite=visuals.length===1 && visuals[0]!.type==='sprite-renderer' && !visuals[0]!.assetRef &&
      typeof visuals[0]!.data?.color==='string' ? visuals[0] : undefined
    if(!sprite)preparedProbe.transformUnverified='Transform geometry requires a single color-only 2D Sprite on the selected node; enabled causality alone is not transform evidence'
    else try {
      const base=structuredClone(doc) as Scene
      base.data.nodes.find(n=>n.id===node.id)!.components!.find(c=>c.id===sprite.id)!.data!.color='rgb('+MARKER.join(',')+')'
      const add=(property:string,source:Scene)=>preparedProbe.variants.push({property,replacement:JSON.stringify(source),polygon:spritePolygon(source,node.id,sprite.id,probe.viewport)})
      add('baseline-geometry',base)
      for(const property of ['position','rotation','scale'] as const) {
        const variant=structuredClone(base),target=variant.data.nodes.find(n=>n.id===node.id)!
        target.transform ??= {position:[0,0,0]}
        const value=target.transform[property] ?? (property==='scale'?[1,1,1]:[0,0,0])
        target.transform[property]=property==='position'?[value[0]+17,value[1]+11,value[2]]:
          property==='rotation'?[value[0],value[1],value[2]+.27]:[value[0]*1.2,value[1]*.8,value[2]]
        add('local-'+property,variant)
      }
      let parentId='bgs-probe-parent'
      while(base.data.nodes.some(n=>n.id===parentId))parentId+='-'
      for(const property of ['position','rotation','scale'] as const) {
        const variant=structuredClone(base),target=variant.data.nodes.find(n=>n.id===node.id)!
        const parent: Scene['data']['nodes'][number]={id:parentId,...(target.parentId?{parentId:target.parentId}:{}),transform:{
          position:property==='position'?[17,11,0]:[0,0,0],rotation:property==='rotation'?[0,0,.23]:[0,0,0],scale:property==='scale'?[1.2,.8,1]:[1,1,1]}}
        target.parentId=parentId;variant.data.nodes.push(parent)
        add('parent-'+property,variant)
      }
    }catch(error){preparedProbe.transformUnverified=error instanceof Error?error.message:'Unsupported transform geometry'}
    prepared.push(preparedProbe)
  }
  return prepared
}
