// Freeze byte-identical evidence into a fresh audit directory; never rewrite products.
import { mkdir,cp,copyFile,readFile,writeFile,readdir,access } from 'node:fs/promises'
import { join,relative,basename } from 'node:path'
import { createHash } from 'node:crypto'
const root=import.meta.dir
const repo='/Users/nswell/Documents/PhantomsXR/Projects/InternalProjects/Others/BeeGameStudio/claude-code-main/.worktrees/ir-workflow-integration'
const out=join(repo,'docs/verification/layout-2026-10-01/design-tools-retest')
try{await access(out);throw Error('Evidence destination already exists; no overwrite')}catch(e:any){if(e.code!=='ENOENT')throw e}
const before=JSON.parse(await readFile(join(root,'source-before.json'),'utf8')),after=JSON.parse(await readFile(join(root,'source-after.json'),'utf8'))
const byPath=new Map(after.map((r:any)=>[r.path,r.sha256]))
const changed=before.filter((r:any)=>byPath.get(r.path)!==r.sha256).map((r:any)=>r.path)
const added=after.filter((r:any)=>!before.some((b:any)=>b.path===r.path)).map((r:any)=>r.path)
await mkdir(out,{recursive:true})
for(const name of ['inputs.json','stages.json','summary.json','usage.json','design-result.json','source-before.json','source-after.json','geometry-independent-audit.json','balance-independent-audit.json','concept-independent-audit.png'])
  await copyFile(join(root,name),join(out,name))
for(const name of ['after-author-1','after-author-2','after-author-3','after-author-4','after-author-5','after-review','before-review','before-review-ui'])
  await cp(join(root,name),join(out,name),{recursive:true,force:false,errorOnExist:true})
await mkdir(join(out,'harness'))
for(const name of ['build-cli.ts','preflight.ts','run.ts','snapshot.ts','progress.ts','inspect-actions.ts','inspect-prompts.ts','metrics.ts','capture-concept.ts','audit-geometry.ts','audit-balance.ts','freeze.ts'])
  await copyFile(join(root,name),join(out,'harness',name))
const workspace=join(root,'projects/users/spatial-test/design-tools-retest-breakout-20261001')
const native=join(workspace,'.beegame/config/projects'),actions:any[]=[]
for await(const path of new Bun.Glob('**/*.jsonl').scan({cwd:native,dot:true,onlyFiles:true})){
  if(path.includes('agent-acompact-'))continue // Synthetic compaction context is not another tool execution.
  for(const line of (await readFile(join(native,path),'utf8')).split('\n')){
    try{const row=JSON.parse(line);for(const b of row.message?.content??[]){
      if(b.type!=='tool_use')continue
      actions.push({time:row.timestamp,actor:basename(path),tool:b.name,
        ...(['Read','Write','Edit'].includes(b.name)?{file:b.input.file_path?.replace(workspace+'/', '')}:{}),
        ...(b.name==='Agent'?{description:b.input.description,resume:b.input.resume??null,prompt:b.input.prompt}:{}),
        ...(b.name==='Bash'?{description:b.input.description}:{}),
        ...(b.name==='Skill'?{skill:b.input.skill}:{})})
    }}catch{}
  }
}
await writeFile(join(out,'native-actions-derived.json'),JSON.stringify({note:'Derived action metadata; no hidden reasoning, credentials or shell request bodies. Original native transcripts remain read-only at test root.',actions:actions.sort((a,b)=>a.time.localeCompare(b.time))},null,2))
await writeFile(join(out,'source-comparison.json'),JSON.stringify({changed,added,unchanged:!changed.length&&!added.length},null,2))
const records:any[]=[]
async function collect(dir:string){for(const e of await readdir(dir,{withFileTypes:true})){
  const p=join(dir,e.name);if(e.isDirectory())await collect(p);else if(e.isFile())records.push({path:relative(out,p),sha256:createHash('sha256').update(await readFile(p)).digest('hex')})
}}
await collect(out)
await writeFile(join(out,'evidence-manifest.json'),JSON.stringify({originalTestRoot:root,projectProductsWereModifiedByCodex:false,sourceComparison:{changed,added},files:records.sort((a,b)=>a.path.localeCompare(b.path))},null,2))
console.log(JSON.stringify({out,files:records.length,sourceChanged:changed,sourceAdded:added}))
