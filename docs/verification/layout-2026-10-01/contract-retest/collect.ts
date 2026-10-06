// Read-only evidence capture. Does not alter the tested project or its receipts.
import { mkdir, cp, copyFile, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkDesignLayouts } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/design-layout-check'
import { parseBeeGameContentDocument } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/game-content-schema'
import { readUiLayoutCamera } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/agent-workflow-server/src/beegame/ui-layout-audit'
import { inspectUiLayout, summarizeUiLayoutInspection } from '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/packages/scene-editor/src/ui-layout-inspection'
const root = import.meta.dir
const workspace = join(root, 'projects/users/spatial-test/contract-retest-breakout-20261001')
const destination = '/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration/docs/verification/layout-2026-10-01/contract-retest'
const summary = await Bun.file(join(root, 'summary.json')).json()
const observer = Bun.spawn(['bun', join(root, 'inspect.ts')], { stdout: 'pipe', stderr: 'pipe' })
const observation = JSON.parse(await new Response(observer.stdout).text())
if (await observer.exited) throw Error('Observer failed')
const before = await Bun.file(join(root, 'source-before.json')).json()
const after = await Bun.file(join(root, 'source-after.json')).json()
const hashes = new Map(after.map((row: any) => [row.path, row.sha256]))
const sourceChanges = before.filter((row: any) => hashes.get(row.path) !== row.sha256).map((row: any) => row.path)
const partialExists = await Bun.file(join(destination,'inputs.json')).exists()
if (partialExists && (await Bun.file(join(destination,'inputs.json')).json()).projectId !== 'contract-retest-breakout-20261001') throw Error('Evidence destination belongs to another run')
if (await Bun.file(join(destination,'test-record.json')).exists()) throw Error('Completed evidence must not be overwritten')
if (!partialExists) {
await mkdir(destination)
for (const name of ['inputs.json','usage.json','stages.json','summary.json','source-before.json','source-after.json','run.ts','inspect.ts','snapshot.ts','collect.ts'])
  await copyFile(join(root, name), join(destination, name))
await cp(join(workspace, 'docs'), join(destination, 'final/docs'), { recursive: true, force: false, errorOnExist: true })
for (const [source,target] of [['content','final/content'],['.beegame/tmp','drafts'],...['after-author-1','after-author-2','after-author-3','after-author-4','after-author-5','after-review','before-review','before-review-ui'].map(x=>[x,x])]) {
  const from = source.startsWith('content') || source.startsWith('.beegame') ? join(workspace,source) : join(root,source)
  try { await cp(from,join(destination,target),{recursive:true,force:false,errorOnExist:true}) }
  catch(error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
}
}
const hostGeometry = checkDesignLayouts(workspace,{orientation:'Landscape',dimension:'2D'})
const geometry:any[] = []
for (const file of new Bun.Glob('content/ui/**/*.json').scanSync({cwd:workspace})) {
  try {
    const document = parseBeeGameContentDocument(await Bun.file(join(workspace,file)).json())
    if (document.kind !== 'ui-screen' && document.kind !== 'ui-hud') continue
    const metadata = document.data.nodes.find(n=>n.id===document.data.rootId)!.data!
    const pairs = [metadata.referenceResolution ?? document.data.nodes.find(n=>n.id===document.data.rootId)!.layout?.size,...(metadata.targetViewports as any[] ?? [])]
    const viewports = [...new Map(pairs.filter(Array.isArray).map(pair=>[pair.join('x'),pair])).values()] as [number,number][]
    for(const [width,height] of viewports) {
      const nodes=inspectUiLayout(document.data.nodes,document.data.rootId,{width,height},readUiLayoutCamera(workspace,document))
      geometry.push({file,viewport:[width,height],declaredRegions:document.data.nodes.filter(n=>n.data?.layoutOcclusion).map(n=>({id:n.id,kind:n.data!.layoutOcclusion})),summary:summarizeUiLayoutInspection(nodes),nodes})
    }
  } catch(error) { geometry.push({file,error:error instanceof Error?error.message:String(error)}) }
}
await writeFile(join(destination,'independent-geometry.json'),JSON.stringify({hostGeometry,runtimeVerified:false,fontMeasured:false,geometry},null,2))
const allRows:any[]=[]
for(const file of new Bun.Glob('.beegame/config/projects/**/*.jsonl').scanSync({cwd:workspace,dot:true}))
  for(const line of (await readFile(join(workspace,file),'utf8')).split('\n')) {try {allRows.push({file,...JSON.parse(line)})}catch{}}
const actions=allRows.flatMap(row=>(Array.isArray(row.message?.content)?row.message.content:[]).filter((b:any)=>b.type==='tool_use').map((b:any)=>({actor:row.file,timestamp:row.timestamp,id:b.id,name:b.name,input:b.input})))
// Tool actions/results, not raw model requests or credentials. Remain local evidence.
await writeFile(join(destination,'tool-evidence.json'),JSON.stringify(actions,null,2),{mode:0o600})
await copyFile(join(root,'collect.ts'),join(destination,'collect.ts'))
await writeFile(join(destination,'test-record.json'),JSON.stringify({...observation,model:summary.model,elapsedSeconds:summary.elapsedSeconds,requestCount:summary.requestCount,failure:summary.failure??null,stopped:summary.stopped,hostGeometry,sourceChangesDuringRun:sourceChanges,resourceTurnDispatched:false,runtimeVerified:false,rawEvidenceRoot:root,billing:'Provider token observations only; incomplete usage is not zero or settled wallet Credits.'},null,2))
console.log(JSON.stringify({destination,state:observation.state,hostGeometry,sourceChangesDuringRun:sourceChanges,elapsedSeconds:summary.elapsedSeconds},null,2))
