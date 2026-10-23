import { expect, test } from 'bun:test'
import { mkdtemp, realpath, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { openAgentTools } from './workflow-v3/agent-tools'
import { openPreviewTestAccess } from './preview-test-access'
import { sharedContentChecker } from './content-checker-runtime'
import { sharedPlaywright } from './shared-playwright'
import { projectPreviewCapabilityPath } from './project-preview-capability'

// Independent, local-only fixture. No model, game project or personal browser.
test.skipIf(process.env.BGS_KEYBOARD_SAMPLE_BROWSER !== '1')('fixed keyboard sample dispatches input, waits host time and retains failures without retries', async () => {
  const root=await realpath(await mkdtemp(join(tmpdir(),'bgs-keyboard-sample-')))
  let scenario='normal', starts=0, navigations=0
  const events:any[]=[]
  const game=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request) {
    const path=new URL(request.url).pathname
    if(path==='/event'){events.push(JSON.parse(await request.text()));return new Response(null,{status:204})}
    if(path==='/favicon.ico')return new Response(null,{status:204})
    navigations++
    return new Response(`<!doctype html><style>body{background:#183044;color:white}#dot{width:30px;height:30px;background:orange}</style>
      <button id="start">Start</button><div id="ready" hidden>Ready</div><div id="dot"></div><script>
      const scenario=${JSON.stringify(scenario)};let ticks=0,x=0,held=false;
      // A fake internal clock must not shorten the host observation window.
      window.elapsed=60000;Date.now=()=>999999999;
      window.fastForward=()=>{throw Error('Test driver called an internal game hook')};
      const send=(type,event)=>navigator.sendBeacon('/event',JSON.stringify({scenario,type,trusted:event.isTrusted,ticks,x}));
      function frame(){ticks++;if(held)x++;document.querySelector('#dot').style.transform='translateX('+x+'px)';requestAnimationFrame(frame)}requestAnimationFrame(frame);
      document.querySelector('#start').onclick=e=>{document.querySelector('#ready').hidden=false;send('start',e)};
      window.addEventListener('keydown',e=>{held=scenario!=='ignore';send('keydown',e);if(scenario==='error')throw Error('Synthetic input failure')});
      window.addEventListener('keyup',e=>{held=false;send('keyup',e)});
      </script>`,{headers:{'Content-Type':'text/html'}})
  }})
  const preview=openPreviewTestAccess({start:async mode=>{starts++;expect(mode).toBe('production');return {status:'running',mode,url:game.url.origin}},
    status:()=>({status:'running',mode:'production',url:game.url.origin}),stop(){}})
  const tools=await openAgentTools({workspacePath:root,sessionId:'keyboard-test',getAuthToken:()=>undefined,openPreview:()=>preview})
  try {
    await writeFile(join(root,'source-sentinel.txt'),'unchanged original fixture')
    const runtime=await sharedContentChecker()
    const run=async (readySelector='#ready')=>{
      const options={startSelector:'#start',readySelector,key:'ArrowRight',holdMs:250,observeMs:350,viewport:{width:640,height:360}}
      const child=Bun.spawn(['node',join(root,tools.directory,'preview.mjs'),'--keyboard-sample',JSON.stringify(options)],{cwd:root,
        env:{...process.env,BEEGAME_CONTENT_CHECKER_MODULE:runtime.moduleUrl,
          BEEGAME_PREVIEW_TEST_MODULE:new URL('./preview-test-client.mjs',runtime.moduleUrl).href,
          BEEGAME_PLAYWRIGHT_MODULE:sharedPlaywright().moduleUrl,
          BEEGAME_PREVIEW_CAPABILITY_FILE:projectPreviewCapabilityPath(root,'keyboard-test')},stdout:'pipe',stderr:'pipe'})
      const [out,err,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited])
      expect(out,err).not.toBe('')
      const report=JSON.parse(out)
      expect(JSON.parse(await readFile(join(root,report.reportPath),'utf8'))).toEqual(report)
      expect(report.quality).toBe('unverified')
      expect(report.driver).toBe('host-fixed-desktop-keyboard')
      expect(report.scope).toContain('Not proof of input effect')
      return {report,code}
    }
    const normal=await run()
    expect(normal.code,JSON.stringify(normal.report)).toBe(0)
    expect(normal.report.status).toBe('observed')
    const sample=normal.report.observations
    expect(sample.actions.map((a:any)=>[a.type,a.status])).toEqual([['click','sent'],['keydown','sent'],['keyup','sent']])
    expect(sample.holdElapsedMs).toBeGreaterThanOrEqual(250)
    expect(sample.observationElapsedMs).toBeGreaterThanOrEqual(350)
    expect(sample.before).toEqual({visible:true,focused:true})
    expect(sample.after).toEqual({visible:true,focused:true})
    expect(normal.report.frames).toHaveLength(3)
    expect((await readFile(join(root,normal.report.video))).length).toBeGreaterThan(1000)
    for(const frame of normal.report.frames)
      expect((await readFile(join(root,frame.path))).subarray(0,8).toString('hex')).toBe('89504e470d0a1a0a')
    const normalEvents=events.filter(e=>e.scenario==='normal')
    expect(normalEvents.map(e=>[e.type,e.trusted])).toEqual([['start',true],['keydown',true],['keyup',true]])
    expect(normalEvents[2].ticks).toBeGreaterThan(normalEvents[1].ticks)
    expect(normalEvents[2].x).toBeGreaterThan(normalEvents[1].x)

    // Dispatch evidence must not claim that a game actually responds to input.
    scenario='ignore'
    const ignored=await run()
    expect(ignored.report.status).toBe('observed')
    expect(ignored.report.quality).toBe('unverified')
    expect(events.filter(e=>e.scenario==='ignore').every(e=>e.x===0)).toBe(true)

    scenario='error'
    const failed=await run()
    expect(failed.code).toBe(1)
    expect(failed.report.status).toBe('incomplete')
    expect(failed.report.runtimeErrors.pageErrors).toBeGreaterThan(0)
    expect(failed.report.runtimeErrorDetails.pageErrors[0].message).toContain('Synthetic input failure')
    expect(failed.report.observations.actions.at(-1)).toMatchObject({type:'keyup',status:'sent'})
    expect(failed.report.frames.length).toBeGreaterThan(0)
    expect((await readFile(join(root,failed.report.video))).length).toBeGreaterThan(0)

    scenario='missing'
    const missing=await run('#absent')
    expect(missing.code).toBe(1)
    expect(missing.report.status).toBe('incomplete')
    expect(missing.report.observations.actions.map((a:any)=>a.type)).toEqual(['click'])
    expect(events.filter(e=>e.scenario==='missing').map(e=>e.type)).toEqual(['start'])
    expect(starts).toBe(4)
    expect(navigations).toBe(4)
    expect(new Set([normal.report.directory,ignored.report.directory,failed.report.directory,missing.report.directory]).size).toBe(4)
    expect(await readFile(join(root,'source-sentinel.txt'),'utf8')).toBe('unchanged original fixture')
    expect((await readdir(root)).sort()).toEqual(['.beegame','source-sentinel.txt'])
  } finally {await tools.close();game.stop(true);await rm(root,{recursive:true,force:true})}
},60000)
