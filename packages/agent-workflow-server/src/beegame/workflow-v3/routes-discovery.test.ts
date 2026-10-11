import { test, expect } from 'bun:test'
import { Hono } from 'hono'
import { registerV3Routes } from './routes'
import { BeeGameSessionManager } from '../session-manager'

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
