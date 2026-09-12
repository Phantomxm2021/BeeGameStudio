import {createInterface} from 'node:readline'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
import {applyPatch} from 'diff'
const mode=process.argv[2]??'normal'
createInterface({input:process.stdin}).once('line',async(line)=>{
 if(mode==='comparison'){
  assert.ok(line.includes('review-context/manifest.json'))
  assert.ok(line.includes('Audit the documentation in docs/'))
  assert.ok(!process.argv.includes('--tools'))
  const manifest=JSON.parse(await readFile(join(process.cwd(),'review-context/manifest.json'),'utf8'))
  assert.equal(manifest.documents.length,8)
  for(const entry of manifest.documents){
   const before=await readFile(join(process.cwd(),entry.basePath),'utf8')
   const after=await readFile(join(process.cwd(),entry.path),'utf8')
   if(entry.diffStatus==='available')assert.equal(applyPatch(before,await readFile(join(process.cwd(),entry.diffPath),'utf8')),after)
   else if(entry.diffStatus==='unchanged')assert.equal(before,after)
  }
 }
 const paths=['docs/GDD.md','docs/LEVEL_SCENE_DESIGN.md','docs/BALANCE_DESIGN.md','docs/TECHNICAL_DESIGN.md','docs/ART_DIRECTION.md','docs/UI_UX_SPEC.md','docs/AUDIO_DESIGN.md','docs/ASSET_PLAN.md']
 const report:any={status:'completed',summary:'Audited game',findings:[]}
 const document=await readFile(join(process.cwd(),'docs/GDD.md'),'utf8')
 if(mode.startsWith('repair-flow')){
  for(const path of paths){
   const content=await readFile(join(process.cwd(),path),'utf8')
   if(content!=='# incomplete'&&!content.includes('REPAIR_REQUIRED'))continue
   report.findings.push({severity:'HIGH',title:'Incomplete document',actual:'Missing design',expected:'Complete design',documentPath:path})
   if(mode==='repair-flow-one-at-a-time')break
  }
 }else if(document!=='# Original copied document')throw new Error('wrong source')
 if(mode==='duplicates'){
  const finding={documentPath:'docs/GDD.md',severity:'HIGH',title:'Duplicate defect',actual:'Observed defect',expected:'Resolve the defect'}
  report.findings=[finding,{...finding}]
 }
 const send=(x:unknown)=>process.stdout.write(JSON.stringify(x)+'\n')
 send({type:'stream_event',event:{type:'message_start',message:{id:'fixture',usage:{input_tokens:20}}}})
 if(mode==='wait'){setInterval(()=>{},1000);return}
 if(mode==='invalid')report.status='blocked'
 if(mode==='extra-field')report.unexpected='Not part of the minimal report'
 send({type:'result',subtype:'success',structured_output:report,modelUsage:{fixture:{inputTokens:20,outputTokens:10}}})
 setInterval(()=>{},1000)
})
