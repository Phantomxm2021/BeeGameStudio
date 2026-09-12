import {expect,test} from 'bun:test'
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {executeRevisionNativeProcess} from '../native-process'
import {captureRevisionUsageEvent,getLatestRevisionRuntimeUsage,type RevisionUsageEvent} from '../native-usage'
for(const mode of ['normal','observer-error','stop'] as const)test('native Revision metering and closure: '+mode,async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'revision-meter-')))
 const cwd=join(root,'workspace');await mkdir(cwd)
 const events:RevisionUsageEvent[]=[];const abort=new AbortController();let first=true
 const run=()=>executeRevisionNativeProcess({configuration:{command:[process.execPath,join(import.meta.dir,'native-metering-fixture.ts')],env:{}},
 cwd,prompt:'offline',writablePaths:[],logPath:join(root,'events.jsonl'),outputSchema:{type:'object'},signal:abort.signal,
 onMessage:message=>{
  const event=captureRevisionUsageEvent(message);if(event)events.push(event)
  message.structured_output={wrong:true}
  if(first){first=false;if(mode==='stop')abort.abort();if(mode==='observer-error')throw new Error('private failure')}
 }})
 try{
  if(mode==='normal'){const result=await run();expect(result.submission).toEqual({assessments:[]});expect(result.completion.stdoutDrained).toBe(true)}
  else await expect(run()).rejects.toMatchObject({code:mode==='stop'?'revision_native_aborted':'revision_native_observer_failed',completion:{scope:'direct-child',stdoutDrained:true}})
  expect(getLatestRevisionRuntimeUsage(events).total_tokens).toBe(18)
 }finally{await rm(root,{recursive:true,force:true})}
},5000)
