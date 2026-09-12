import {createInterface} from 'node:readline'
createInterface({input:process.stdin}).once('line',()=>{
 process.stdout.write([
  {type:'stream_event',event:{type:'message_start',message:{id:'one',usage:{input_tokens:10}}}},
  {type:'result',subtype:'success',structured_output:{ok:true},modelUsage:{fixture:{inputTokens:10,outputTokens:5}}},
  {type:'stream_event',event:{type:'message_start',message:{id:'late',usage:{input_tokens:3}}}},
 ].map(x=>JSON.stringify(x)).join('\n')+'\n')
 setInterval(()=>{},1000)
})
