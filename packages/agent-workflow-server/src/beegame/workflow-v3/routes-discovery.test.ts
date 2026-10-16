import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'
import { createRun } from './state'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('read-only mode discovery distinguishes legacy, persisted V3 unavailable and missing owned project without starting a runtime',async()=>{
  let starts=0, mode='legacy'
  const sessions=new BeeGameSessionManager({async start(){starts++;throw Error('No native runtime permitted')}},'/tmp/synthetic-v3-discovery',async()=>({}),{},true)
  const app=new Hono()
  registerV3Routes(app,{sessions,getUser:()=>({id:'owner',role:'owner'}),getProject:async()=>{
    if(mode==='missing')return undefined
    return {id:'project',name:'Synthetic',root_path:'/tmp/synthetic-v3-discovery',created_at:0,
      runtime_snapshot:mode==='v3'?{workflow_protocol:'bgs.workflow.v3'}:undefined} as any
  },getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:async r=>r.json()})
  try{
    const legacy=await app.request('/api/projects/project/workflow-v3')
    expect(legacy.status).toBe(200);expect(await legacy.json()).toEqual({run:null,writerLiveness:'none'})
    mode='v3'
    expect((await app.request('/api/projects/project/workflow-v3')).status).toBe(503)
    expect((await app.request('/api/projects/project/workflow-v3/stop',{method:'POST'})).status).toBe(503)
    mode='missing';expect((await app.request('/api/projects/project/workflow-v3')).status).toBe(404)
    for (const [path, method] of [['runs', 'POST'], ['plan', 'PUT'], ['requirements', 'POST'], ['tasks/game/execute', 'POST'],
      ['preview-issues', 'POST'], ['preview-issues/observation/review-plan', 'POST'], ['preview-issues/attempt/repair-plan', 'POST']] as const)
      expect((await app.request('/api/projects/project/workflow-v3/' + path, { method })).status).toBe(404)
    expect(starts).toBe(0)
  }finally{await sessions.dispose()}
})
test('a configured store with a missing persisted V3 Run does not silently expose legacy Chat mode',async()=>{
  const sessions=new BeeGameSessionManager({async start(){throw Error('No native runtime permitted')}},'/private/tmp',async()=>({}),{},true)
  const app=new Hono()
  registerV3Routes(app,{store:{read:async()=>undefined,commit:async()=>{throw Error('No mutation permitted')}},
    sessions,getUser:()=>({id:'owner',role:'owner'}),
    getProject:async()=>({id:'project',name:'Synthetic',root_path:'/private/tmp',created_at:0,runtime_snapshot:{workflow_protocol:'bgs.workflow.v3'}} as any),
    getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:async r=>r.json()})
  try{
    const response=await app.request('/api/projects/project/workflow-v3')
    expect(response.status).toBe(503);expect((await response.json()).code).toBe('run-unavailable')
  }finally{await sessions.dispose()}
})
test('persisted Task Run is rejected by status, reads and controls without dispatch or mutation',async()=>{
  const root='/private/tmp',run=createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
    requestKey:'old',text:'Legacy task',constraints:{},ids:['goal']})
  delete run.agentTurns
  let starts=0,commits=0
  const sessions=new BeeGameSessionManager({async start(){starts++;throw Error('No native runtime permitted')}},root,async()=>({}),{},true)
  const app=new Hono()
  registerV3Routes(app,{store:{read:async()=>run,commit:async()=>{commits++;throw Error('No mutation permitted')}},
    sessions,getUser:()=>({id:'owner',role:'owner'}),
    getProject:async()=>({id:'project',name:'Synthetic',root_path:root,created_at:0,runtime_snapshot:{workflow_protocol:'bgs.workflow.v3'}} as any),
    getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:async r=>r.json()})
  try {
    for (const [path,method] of [['','GET'],['/events','GET'],['/questions','GET'],['/stop','POST'],['/resume','POST']] as const) {
      const response=await app.request('/api/projects/project/workflow-v3'+path,{method,headers:{'content-type':'application/json'},body:method==='POST'?'{}':undefined})
      expect(response.status).toBe(409)
      expect((await response.json()).code).toBe('task-mode-retired')
    }
    expect(starts).toBe(0);expect(commits).toBe(0)
  } finally {await sessions.dispose()}
})

test('ordinary Preview needs no measurement and never dispatches a model or delivery build', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-preview-diagnostic-')))
  const run = createRun({projectId:'project',ownerId:'owner',workspacePath:root,chatSessionId:'chat',
    requestKey:'create',text:'Synthetic game',constraints:{},ids:['goal']})
  let starts = 0, role: 'owner' | 'viewer' = 'owner'
  const operations: string[] = []
  let open = false
  const candidate = {id:'synthetic',runId:run.id,artifact:{path:'dist',sha256:'a'.repeat(64)},url:'http://synthetic.localhost',limitations:['Candidate only']}
  const before = structuredClone(run)
  const sessions = new BeeGameSessionManager({async start(){starts++;throw Error('No native runtime permitted')}},root,async()=>({}),{},true)
  const app = new Hono()
  registerV3Routes(app,{store:{read:async()=>run,commit:async()=>{throw Error('No mutation permitted')}},sessions,
    preview:{candidateStatus:async()=>({preview:open?candidate:null}),openCandidate:async(current:typeof run)=>{
      expect(current).toEqual(run);operations.push('open');open=true;return candidate
    },closeCandidate:()=>{operations.push('stop');open=false}} as any,
    getUser:()=>({id:'owner',role}),getProject:async()=>({id:'project',name:'Synthetic',root_path:root,created_at:0} as any),
    getAuthToken:()=>undefined,getValidAuthToken:()=>undefined,assertNoLegacyRun:async()=>{},persistMode:async()=>{},readBody:async r=>r.json()})
  try {
    const response = await app.request('/api/projects/project/preview',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
    expect(response.status).toBe(200)
    const result = await response.json()
    expect(result).toMatchObject({status:'running',mode:'production'})
    expect((await app.request('/api/projects/project/preview')).status).toBe(200)
    expect((await app.request('/api/projects/project/preview/restart',{method:'POST',body:'{}'})).status).toBe(200)
    expect((await app.request('/api/projects/project/preview',{method:'DELETE'})).status).toBe(200)
    expect(operations).toEqual(['open','open','stop'])
    role='viewer'
    expect((await app.request('/api/projects/project/preview',{method:'POST',body:'{}'})).status).toBe(403)
    expect((await app.request('/api/projects/project/preview',{method:'DELETE'})).status).toBe(403)
    role='owner'
    run.writer={attemptId:'busy',workerId:'worker',fence:1}
    expect((await app.request('/api/projects/project/preview',{method:'POST',body:'{}'})).status).toBe(409)
    delete run.writer
    expect(run).toEqual(before)
    expect(operations).toHaveLength(3)
    expect(starts).toBe(0)
  } finally { await sessions.dispose(); await rm(root,{recursive:true,force:true}) }
})
