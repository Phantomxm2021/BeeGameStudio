import {createInterface} from 'node:readline'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const mode=process.argv[2]??'normal'
createInterface({input:process.stdin}).on('line',async(line)=>{
 assert.ok(line.includes('requirements.md')&&line.includes('Review all eight documents'))
 assert.equal(process.env.BEEGAME_STRUCTURED_OUTPUT_IS_TERMINAL,undefined)
 await readFile(join(process.cwd(),'requirements.md'),'utf8')
 const fileChecks=JSON.parse(await readFile(join(process.cwd(),'review-context/file-checks.json'),'utf8'))
 assert.equal(fileChecks.files.length,9)
 assert.equal(fileChecks.files.find((file:any)=>file.role==='host_evidence').path,'requirements.md')
 const paths=['docs/GDD.md','docs/LEVEL_SCENE_DESIGN.md','docs/BALANCE_DESIGN.md','docs/TECHNICAL_DESIGN.md','docs/ART_DIRECTION.md','docs/UI_UX_SPEC.md','docs/AUDIO_DESIGN.md','docs/ASSET_PLAN.md']
 const document=await readFile(join(process.cwd(),'docs/GDD.md'),'utf8')
 if(mode.startsWith('repair-flow')){
  for(const path of paths){
   const content=await readFile(join(process.cwd(),path),'utf8')
   if(content!=='# incomplete'&&!content.includes('REPAIR_REQUIRED'))continue
   await writeFile(join(process.cwd(),path),content.replace('REPAIR_REQUIRED','Repair completed'))
  }
}else if(document!=='# Original copied document')throw new Error('wrong source')
const send=(x:unknown)=>process.stdout.write(JSON.stringify(x)+'\n')
send({type:'stream_event',event:{type:'message_start',message:{id:'fixture',usage:{input_tokens:20}}}})
 if(mode==='wait')return
if(mode==='missing-summary')send({type:'result',subtype:'success',modelUsage:{fixture:{inputTokens:20,outputTokens:10}}})
else send({type:'result',subtype:'success',result:'Audited and corrected game documents.',modelUsage:{fixture:{inputTokens:20,outputTokens:10}}})
})
setInterval(()=>{},1000)
