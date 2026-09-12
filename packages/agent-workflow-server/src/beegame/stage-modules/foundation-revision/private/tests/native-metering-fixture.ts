import {createInterface} from 'node:readline'
createInterface({input:process.stdin}).once('line',()=>{
 process.stdout.write([
  {type:'stream_event',event:{type:'message_start',message:{id:'one',usage:{input_tokens:12}}}},
  {type:'result',subtype:'success',structured_output:{assessments:[]},modelUsage:{fixture:{inputTokens:12,outputTokens:4}}},
  {type:'stream_event',event:{type:'message_start',message:{id:'late',usage:{input_tokens:2}}}},
 ].map(x=>JSON.stringify(x)).join('\n')+'\n')
 setInterval(()=>{},1000)
})
