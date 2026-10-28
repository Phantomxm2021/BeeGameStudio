import { test, expect } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { normalizeMcpHeaders } from '../mcp-http-headers'
import { upsertMcpServer, exportMcpServersSnapshot } from '../mcp-servers-store'
import { SupabaseDashboardStore } from '../supabase-dashboard-store'
import { createAgentWorkflowApp } from '../app'
import { prepareNativeMcpConfig, NATIVE_MCP_CONFIG_ENV } from '../beegame/native-mcp-config'

const input = { name: 'Remote', enabled: true, autoStart: true, transport: 'http' as const, scope: 'beegame' as const,
  url: 'https://mcp.invalid/mcp', headers: [{ key: 'Authorization', value: 'Bearer fixture-private-key' }] }

test('header validation rejects injection, duplicate casing and transport overrides', () => {
  for (const headers of [null, {}, [{key:'Host',value:'private'}], [{key:'X-BGS-MCP-Token',value:'private'}],
    [{key:'X-Key',value:'private\r\nHost: evil'}], [{key:'Authorization',value:'one'},{key:'authorization',value:'two'}]]) {
    expect(() => normalizeMcpHeaders(headers)).toThrow('MCP header')
  }
  expect(normalizeMcpHeaders([{key:'AUTHORIZATION',value:''}], [{key:'authorization',value:'Bearer saved'}]))
    .toEqual([{key:'authorization',value:'Bearer saved'}])
})

test('local and Supabase persistence encrypt, redact, retain, replace and delete HTTP credentials', async () => {
  const root=await mkdtemp('/private/tmp/bgs-mcp-headers-'), previous=process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=Buffer.alloc(32,77).toString('base64')
  let row:any
  const db=new SupabaseDashboardStore({url:'https://database.invalid',anonKey:'fixture',fetchImpl:async(_url,init)=>{
    if(init?.method==='POST')row=JSON.parse(String(init.body))
    return Response.json(row?[row]:[])
  }})
  try {
    for(const storage of [
      {save:(v:any)=>upsertMcpServer(v,{dataDir:root}),read:()=>exportMcpServersSnapshot({dataDir:root}),raw:()=>readFile(join(root,'mcp-servers.json'),'utf8')},
      {save:(v:any)=>db.upsertMcpServer('owner',v),read:()=>db.runtimeMcpServers('owner'),raw:async()=>JSON.stringify(row)},
    ]) {
      const saved=await storage.save(input)
      expect(saved.headers).toEqual([{key:'authorization',valuePreview:'••••'}])
      expect(await storage.raw()).not.toContain('fixture-private-key')
      expect((await storage.read())[0]!.headers).toEqual([{key:'authorization',value:'Bearer fixture-private-key'}])
      await storage.save({...input,id:saved.id,headers:[{key:'AUTHORIZATION',value:''}]})
      expect((await storage.read())[0]!.headers![0]!.value).toBe('Bearer fixture-private-key')
      await storage.save({...input,id:saved.id,headers:[{key:'Authorization',value:'Bearer replacement'}]})
      expect((await storage.read())[0]!.headers![0]!.value).toBe('Bearer replacement')
      await storage.save({...input,id:saved.id,headers:[]})
      expect((await storage.read())[0]!.headers).toEqual([])
    }
  } finally { if(previous===undefined)delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY;else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=previous;await rm(root,{recursive:true,force:true}) }
})

test('owned saved connection test and native MCP relay use stored headers without exposing or redirecting them', async () => {
  const root=await mkdtemp('/private/tmp/bgs-mcp-header-route-'), previous=process.env.BEEGAME_CONFIG_ENCRYPTION_KEY
  process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=Buffer.alloc(32,78).toString('base64')
  let requests=0
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){
    requests++
    expect(request.headers.get('authorization')).toBe('Bearer fixture-private-key')
    expect(request.headers.has('x-bgs-mcp-token')).toBe(false)
    const body=await request.json() as any
    return Response.json({jsonrpc:'2.0',id:body.id,result:{protocolVersion:'2024-11-05',serverInfo:{name:'local',version:'1'},capabilities:{}}})
  }})
  const resolveOutboundTarget=async(value:string)=>{
    if(new URL(value).hostname!=='mcp.invalid')throw Error('Unexpected target')
    return {url:new URL(value),addresses:['127.0.0.1'],lookup:(_h:any,_o:any,cb:any)=>cb(null,'127.0.0.1',4)}
  }
  const cleanups:Array<()=>void|Promise<void>>=[]
  const makeApp=(id:string)=>createAgentWorkflowApp({dashboardDataRoot:root,modelConfigStore:false,skillsConfig:false,
    currentUser:{id,role:'viewer'},outboundTargetResolver:resolveOutboundTarget,registerCleanup:c=>cleanups.push(c)})
  const alice=makeApp('alice'),bob=makeApp('bob')
  const post=(app:typeof alice,path:string,body:unknown)=>app.request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
  let prepared:Awaited<ReturnType<typeof prepareNativeMcpConfig>>|undefined
  try {
    const server={...input,url:`http://mcp.invalid:${upstream.port}/mcp`}
    const savedResponse=await post(alice,'/api/mcp-servers',server)
    expect(savedResponse.status).toBe(200)
    const saved=await savedResponse.json() as any
    expect(JSON.stringify(saved)).not.toContain('fixture-private-key')
    expect((await post(bob,'/api/mcp-servers/test',{...saved})).status).toBe(404)
    const result=await post(alice,'/api/mcp-servers/test',{...saved,url:'https://must-not-receive-secret.invalid/'})
    expect(result.status).toBe(200)
    expect(await result.json()).toMatchObject({ok:true})
    expect(requests).toBe(1)
    prepared=await prepareNativeMcpConfig({[NATIVE_MCP_CONFIG_ENV]:JSON.stringify([{...server,id:'remote'}])},root,undefined,undefined,{resolveOutboundTarget})
    expect(JSON.stringify(prepared.config)).not.toContain('fixture-private-key')
    const config=(prepared.config.mcp_servers as any)['bgs-remote']
    const response=await fetch(config.url,{method:'POST',headers:{...config.http_headers,'content-type':'application/json',authorization:'Bearer spoof'},body:JSON.stringify({id:2,method:'initialize'})})
    expect(response.status).toBe(200)
    await response.text()
    expect(requests).toBe(2)
    for(const headers of [[{key:'Host',value:'bad'}],[{key:'X-Key',value:'private\r\nattack'}]]) {
      const rejected=await post(alice,'/api/mcp-servers',{...server,headers})
      expect(rejected.status).toBe(400)
      expect(await rejected.text()).not.toContain('private')
    }
  } finally {
    await prepared?.close();upstream.stop(true);for(const cleanup of cleanups)await cleanup()
    if(previous===undefined)delete process.env.BEEGAME_CONFIG_ENCRYPTION_KEY;else process.env.BEEGAME_CONFIG_ENCRYPTION_KEY=previous
    await rm(root,{recursive:true,force:true})
  }
})
