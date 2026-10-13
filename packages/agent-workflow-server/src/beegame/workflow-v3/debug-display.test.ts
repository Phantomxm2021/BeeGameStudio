import {test,expect} from 'bun:test'
import {Hono} from 'hono'
import {fileURLToPath} from 'node:url'
import {registerV3DebugPage} from './debug-page'
import {auditEventPage} from './event-page'
import {createRun} from './state'
import {createPreviewTestBrowser} from '../preview-test-browser'
import {sharedPlaywright} from '../shared-playwright'

for(const delayedFulfillment of [false,true])test('independent debug pages events and pauses with '+
  (delayedFulfillment?'a late completed read':'an aborted stalled read'),async()=>{
  const app=new Hono(),browser=createPreviewTestBrowser()
  let child:ReturnType<typeof Bun.spawn>|undefined,release!:()=>void,reads=0,stops=0
  const stalled=new Promise<void>(resolve=>{release=resolve})
  const run=createRun({projectId:'p',ownerId:'owner',workspacePath:'/private/tmp/synthetic-debug-only',
    chatSessionId:'chat',requestKey:'fixture',text:'Synthetic UI transport test, no game/model',constraints:{},ids:['fixture']})
  run.agentTurns=[{measurements:[
    {id:'older-success',runtimeArtifact:'dist',finishedAt:'2026-10-12T01:00:00Z',checks:[{id:'build',status:'passed'}]},
    {id:'latest-failure',runtimeArtifact:'dist',startedAt:'2026-10-12T02:00:00Z',error:'Synthetic latest failure',checks:[]},
  ]}] as any
  run.writer={attemptId:'synthetic-active',workerId:'synthetic',fence:1}
  const events=Array.from({length:90000},(_,id)=>({id,type:'assistant.message' as const,turnId:'turn',text:'event '+id,createdAt:new Date(0)}))
  registerV3DebugPage(app,true)
  app.use('/api/*',async(c,next)=>{
    if(c.req.header('Authorization')!=='Bearer synthetic-owner')return c.json({error:'Unauthorized'},401)
    await next()
  })
  app.get('/api/projects/p/workflow-v3',async c=>{
    const snapshot=structuredClone(run)
    if(++reads===2 && !delayedFulfillment)await stalled
    return c.json({run:snapshot,writerLiveness:'none'})
  })
  app.post('/api/projects/p/workflow-v3/stop',c=>{
    stops++;run.version++;run.paused={at:new Date().toISOString()}
    return c.json({run})
  })
  app.get('/api/projects/p/workflow-v3/events',c=>c.json({runId:run.id,attemptId:'attempt',historyUnavailable:[],
    ...auditEventPage(events,{turnId:'turn',limit:100,beforeId:c.req.query('beforeId')?Number(c.req.query('beforeId')):undefined})}))
  app.get('/api/projects/p/workflow-v3/questions',c=>c.json({runId:run.id,requirementsRevision:run.requirements.revision,
    questions:[{toolUseID:'synthetic-question',attemptId:'synthetic-active',canAnswer:true,
      input:{questions:[{question:'Synthetic only?',options:[],multiSelect:false}]}}]}))
  app.post('/fixture/release',c=>{release();return c.json({released:true})})
  const server=Bun.serve({hostname:'127.0.0.1',port:0,idleTimeout:0,fetch:app.fetch})
  try {
    const {endpoint}=await browser.start(),node=Bun.which('node')!
    const driver=Bun.spawn([node,fileURLToPath(new URL('./debug-display-browser.mjs',import.meta.url))],
      {env:{PATH:process.env.PATH,BGS_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl},stdin:'pipe',stdout:'pipe',stderr:'pipe'})
    child=driver
    driver.stdin.write(JSON.stringify({endpoint,origin:server.url.origin,delayedFulfillment}));driver.stdin.end()
    const timeout=setTimeout(()=>child?.kill(),40000)
    const [output,error,exit]=await Promise.all([new Response(driver.stdout).text(),new Response(driver.stderr).text(),driver.exited])
    clearTimeout(timeout)
    expect(exit,error).toBe(0)
    expect(JSON.parse(output)).toMatchObject({passed:true,finalVersion:2,paused:true})
    expect(stops).toBe(1);expect(reads).toBe(3);expect(events).toHaveLength(90000)
  }finally{release();if(child?.exitCode===null){child.kill();await child.exited}server.stop(true);await browser.close()}
},45000)
