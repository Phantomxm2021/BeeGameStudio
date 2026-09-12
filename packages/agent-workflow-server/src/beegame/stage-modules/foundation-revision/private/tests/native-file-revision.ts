import {createInterface} from 'node:readline'
import {readFile,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import assert from 'node:assert/strict'
const mode=process.argv[2]??'valid',body=Buffer.from(process.argv[3]??'','base64').toString('utf8')
createInterface({input:process.stdin}).once('line',async()=>{
 const report=JSON.parse(await readFile(join(process.cwd(),'review.json'),'utf8'))
 const send=(x:unknown)=>process.stdout.write(JSON.stringify(x)+'\n')
 send({type:'stream_event',event:{type:'message_start',message:{id:'fixture',usage:{input_tokens:12}}}})
 if(mode==='wait'){
  if(process.argv[4])await writeFile(process.argv[4],'ready')
  setInterval(()=>{},1000);return
 }
 let unresolved:any,documents:Record<string,string>|undefined
 try{const p=JSON.parse(body);if(p.status==='unresolved')unresolved=p;documents=p.documents}catch{}
 if(documents)for(const [path,content] of Object.entries(documents))await writeFile(join(process.cwd(),path),content)
 for(const issue of report.findings){
  assert.deepEqual(Object.keys(issue).sort(),['actual','documentPath','expected','severity','title'])
  const path=issue.documentPath
  if(!unresolved&&!documents)await writeFile(join(process.cwd(),path),mode==='repair-marker'?(await readFile(join(process.cwd(),path),'utf8')).replace('REPAIR_REQUIRED','Repair completed'):body)
 }
 send({type:'result',subtype:'success',structured_output:{summary:unresolved?.reason??'Applied supported fixture edits'},modelUsage:{fixture:{inputTokens:12,outputTokens:4}}})
 setInterval(()=>{},1000)
})
