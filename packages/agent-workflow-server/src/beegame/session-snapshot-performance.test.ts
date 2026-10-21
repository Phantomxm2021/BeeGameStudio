import {expect,test} from 'bun:test'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {BeeGameSessionManager,type BeeGameEvent} from './session-manager'

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'bgs-snapshot-replay-'))
  const manager=new BeeGameSessionManager({async start(){throw Error('No native or paid runner in snapshot fixture')}},root)
  const session=manager.start({workspacePath:join(root,'workspace'),userId:'fixture'})
  const record=(manager as any).sessions.get(session.id) as {events:BeeGameEvent[]}
  const event=(type:BeeGameEvent['type'],turnId?:string):BeeGameEvent=>({id:0,sessionId:session.id,type,text:'synthetic',
    ...(turnId?{turnId}:{}),createdAt:new Date(0)})
  return {manager,session,record,event,async close(){await manager.dispose();await rm(root,{recursive:true,force:true})}}
}

test('snapshot phase work is linear in history, not history multiplied by prior turns',async()=>{
  const f=await fixture()
  try {
    let fieldReads=0
    const events=[f.event('session.started')]
    for(let i=0;i<100;i++)events.push(f.event('turn.started','turn-'+i),f.event('turn.completed','turn-'+i))
    events.push(f.event('turn.started','active'))
    for(let i=0;i<1000;i++)events.push(f.event('assistant.partial','active'))
    for(const event of events) {
      const type=event.type,turnId=event.turnId
      Object.defineProperty(event,'type',{get(){fieldReads++;return type}})
      Object.defineProperty(event,'turnId',{get(){fieldReads++;return turnId}})
    }
    f.record.events=events
    const snapshot=f.manager.runtimeSnapshot(f.session.id)
    expect(snapshot.phaseName).toBe('running');expect(snapshot.phaseStatus).toBe('running')
    // Operation count, not a timing threshold or Agent/history limit.
    expect(fieldReads).toBeLessThan(events.length*50)
  }finally{await f.close()}
})

test('phase preserves terminal-before-start, absent ids, pending permission and recovery semantics',async()=>{
  const f=await fixture()
  try {
    const {event:e}=f
    for(const [events,name,status] of [
      [[e('session.started')],'starting','starting'],
      [[e('session.started'),e('turn.started')],'idle','idle'],
      [[e('turn.completed','old'),e('turn.started','old')],'idle','idle'],
      [[e('turn.started','old'),e('turn.failed','old')],'idle','failed'],
      [[e('turn.started','active'),e('permission.requested','active')],'running','waiting_approval'],
      [[e('turn.started','active'),e('permission.requested','active'),e('permission.resolved','active')],'running','running'],
      [[e('turn.started','active'),e('session.stopped','active')],'idle','idle'],
    ] as const) {
      f.record.events=[...events]
      const snapshot=f.manager.runtimeSnapshot(f.session.id)
      expect(snapshot.phaseName).toBe(name);expect(snapshot.phaseStatus).toBe(status)
    }
  }finally{await f.close()}
})

test('a text stream does not rescan prior text for each snapshot; raw history remains intact',async()=>{
  const f=await fixture()
  try {
    let reads=0
    const events=[f.event('session.started'),f.event('turn.started','active')]
    for(let i=0;i<10000;i++) {
      const event=f.event('assistant.partial','active')
      Object.defineProperty(event,'type',{get(){reads++;return 'assistant.partial'}})
      events.push(event)
    }
    f.record.events=events
    f.manager.runtimeSnapshot(f.session.id) // Initial restore is allowed one complete scan.
    reads=0
    for(let i=0;i<100;i++) {
      events.push(f.event('assistant.partial','active'))
      expect(f.manager.runtimeSnapshot(f.session.id).phaseName).toBe('running')
    }
    expect(reads).toBeLessThan(10000)
    expect(f.record.events).toBe(events);expect(events).toHaveLength(10102)
  }finally{await f.close()}
})

test('indexed snapshots equal full-event calculation after mixed lifecycle, usage and text events',async()=>{
  const f=await fixture()
  try {
    const host=f.manager as any
    f.record.events=[]
    const types:BeeGameEvent['type'][]=['turn.started','assistant.partial','assistant.thinking','tool.progress','usage','tool.started',
      'permission.requested','permission.resolved','system.status','tool.failed','result','assistant.message','turn.completed','session.failed']
    for(let i=0;i<140;i++) {
      const e=f.event(types[i%types.length]!,i%9===0?undefined:'turn-'+Math.floor(i/14))
      if(e.type==='usage')e.payload={type:'usage',subtype:'native_accounting',nativeAccountingEpoch:'process-'+Math.floor(i/28),
        usage:{prompt_tokens:i*100,completion_tokens:i,cache_read_tokens:i*1000}}
      if(e.type==='result')e.payload={type:'result',modelUsage:{fixture:{inputTokens:i*100,outputTokens:i,cacheReadInputTokens:i*1000}}}
      if(e.type==='tool.started')e.payload={type:'tool.started',toolName:i%2?'Agent':'Skill',toolUseID:'call-'+i,
        input:{subagent_type:'verification'}}
      if(e.type==='system.status')e.payload={type:'system',subtype:'task_progress',task_id:'task',tool_use_id:'call-5',usage:{total_tokens:i*10}}
      e.id=i+1;e.createdAt=new Date(i*1000);f.record.events.push(e)
      const indexed=f.manager.runtimeSnapshot(f.session.id)
      const inputs=host.runtimeSnapshotInputs
      let full
      try {host.runtimeSnapshotInputs=(record:{events:BeeGameEvent[]})=>record.events;full=f.manager.runtimeSnapshot(f.session.id)}
      finally {if(inputs)host.runtimeSnapshotInputs=inputs;else delete host.runtimeSnapshotInputs}
      expect(indexed).toEqual(full)
    }
  }finally{await f.close()}
})
