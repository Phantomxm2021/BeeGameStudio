import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
const usage=JSON.parse(await readFile(join(import.meta.dir,'usage.json'),'utf8'))
const groups:any={}
for(const r of usage){
  const g=groups[r.stage]??={requests:0,inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0,non200:0}
  g.requests++;g.inputTokens+=r.usage?.input_tokens??0;g.outputTokens+=r.usage?.output_tokens??0
  g.cacheReadTokens+=r.usage?.cache_read_input_tokens??0;g.cacheWriteTokens+=r.usage?.cache_creation_input_tokens??0
  if(r.status!==200)g.non200++
}
console.log(JSON.stringify({groups,longestCompletedRequests:usage.filter((r:any)=>r.status===200).sort((a:any,b:any)=>b.elapsedSeconds-a.elapsedSeconds).slice(0,5).map((r:any)=>({id:r.id,stage:r.stage,elapsedSeconds:r.elapsedSeconds,outputTokens:r.usage?.output_tokens,inputTokens:r.usage?.input_tokens,cacheReadTokens:r.usage?.cache_read_input_tokens}))},null,2))
