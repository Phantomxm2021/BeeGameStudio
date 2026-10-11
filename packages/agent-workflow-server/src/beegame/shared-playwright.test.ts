import { expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { projectExecutionAccess } from './project-execution-access'
import { openPreviewTestAccess } from './preview-test-access'
import { createPreviewTestBrowser } from './preview-test-browser'
import { publishProjectPreviewCapability } from './project-preview-capability'

test('Preview helper rejects unsupported Bun execution before opening a browser', async () => {
  const module = new URL('./preview-test-client.mjs', import.meta.url).href
  const child = Bun.spawn([process.execPath, '--eval', `const {withPreviewPage}=await import(${JSON.stringify(module)}); await withPreviewPage({},()=>{});`],
    { stdout: 'pipe', stderr: 'pipe' })
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()])
  expect(code).not.toBe(0)
  expect(error).toContain('PREVIEW_NODE_REQUIRED')
})

test('numeric evidence keeps counterexamples across runs; absent observations cannot pass', async () => {
  const { checkNumericSamples } = await import('./preview-test-client.mjs')
  expect(checkNumericSamples([12, 18, 27, 16], { maximum: 25 })).toMatchObject({
    status: 'failed', count: 4, observedMaximum: 27, violations: [{ index: 2, value: 27 }] })
  expect(checkNumericSamples([2, 4], { minimum: 3 }).status).toBe('failed')
  expect(checkNumericSamples([3, 25], { minimum: 3, maximum: 25 }).status).toBe('passed')
  expect(checkNumericSamples([], { maximum: 25 }).status).toBe('unverified')
  for (const samples of [[NaN], [Infinity], ['PASS'], [undefined], new Array(2)])
    expect(() => checkNumericSamples(samples, { maximum: 25 })).toThrow('finite observed numbers')
  expect(() => checkNumericSamples([1], {})).toThrow('bound')
  expect(() => checkNumericSamples([1], { minimum: 10, maximum: 5 })).toThrow('bound')
})

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('beforeNavigate captures boot errors and overrides the first data request without editing sources', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-preview-startup-'))
  const saved = '{"fontSize":17,"cameraCenter":100}'
  let sourceRequests = 0
  const fixture = Bun.serve({hostname:'127.0.0.1',port:0,fetch:request => {
    if (new URL(request.url).pathname === '/data.json') {
      sourceRequests++
      return new Response(saved,{headers:{'content-type':'application/json','access-control-allow-origin':'*'}})
    }
    return new Response(`<span id="label">Score</span><script>console.error('BOOT_CONSOLE_FIXTURE');throw Error('BOOT_FIXTURE_ERROR')</script><script>
      fetch('./data.json').then(r=>r.json()).then(data=>{
        const el=document.querySelector('#label');el.style.fontSize=data.fontSize+'px';
        el.style.position='absolute';el.style.left=(300-data.cameraCenter)+'px';el.dataset.ready='true';
      });</script>`,{headers:{'content-type':'text/html'}})
  }})
  const capability = openPreviewTestAccess({start:async()=>({status:'running',url:fixture.url.href}),
    status:()=>({status:'running',url:fixture.url.href}),stop(){}})
  try {
    const access = await projectExecutionAccess({workspacePath:workspace,sessionId:'fixture',environment:{}})
    const script = `
      import assert from 'node:assert/strict';
      const {withPreviewPage}=await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
      const options={apiUrl:process.env.FIXTURE_API,mode:'production'};
      for(const override of [false,true]) {
        const errors=[];
        const observed=await withPreviewPage({...options,beforeNavigate:async({page,context})=>{
          page.on('pageerror',error=>errors.push(error.message));
          if(override)await context.route('**/data.json',route=>route.fulfill({status:200,contentType:'application/json',
            headers:{'access-control-allow-origin':'*'},body:JSON.stringify({fontSize:23,cameraCenter:140})}));
        }},async({gameFrame,runtimeErrors})=>{
          await gameFrame.locator('#label[data-ready="true"]').waitFor();
          assert.equal(runtimeErrors.pageErrors,1);
          assert.equal(runtimeErrors.consoleErrors,1);
          return gameFrame.evaluate(()=>{
            const style=getComputedStyle(document.querySelector('#label'));return [style.fontSize,style.left];
          });
        });
        assert.deepEqual(observed,override?['23px','160px']:['17px','200px']);
        assert.deepEqual(errors,['BOOT_FIXTURE_ERROR']);
      }
      // No beforeNavigate callback: the helper itself still observes errors
      // in the first game load, not just a later reload chosen by the author.
      await withPreviewPage(options,async({gameFrame,runtimeErrors})=>{
        await gameFrame.locator('#label[data-ready="true"]').waitFor();
        assert.equal(runtimeErrors.pageErrors,1);assert.equal(runtimeErrors.consoleErrors,1);
        await gameFrame.evaluate(()=>{console.error('LATE_CONSOLE_FIXTURE')});
        await new Promise(r=>setTimeout(r,50));
        assert.equal(runtimeErrors.consoleErrors,2);
      });
      // Even a callback that ignores all errors and returns PASS cannot claim
      // a clean initial load in fail mode. Observe mode remains diagnostic.
      await assert.rejects(withPreviewPage({...options,runtimeErrorPolicy:'fail'},async({gameFrame})=>{
        await gameFrame.locator('#label[data-ready="true"]').waitFor();return 'AUTHOR_PASS';
      }),/PREVIEW_RUNTIME_ERRORS.*"pageErrors":1/);
      await assert.rejects(withPreviewPage({...options,beforeNavigate:()=>{throw Error('setup failed')}},()=>{
        throw Error('inspect must not run');
      }),/setup failed/);
      const live=await (await fetch(options.apiUrl+'/browser',{method:'POST'})).json();
      const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);
      const browser=await chromium.connectOverCDP(live.endpoint);
      try{assert.equal(browser.contexts().flatMap(c=>c.pages()).filter(p=>p.url().includes('/host')).length,0);}
      finally{await browser.close();}
      console.log('STARTUP_OBSERVATION_PASS');
    `
    const child = Bun.spawn([Bun.which('node')!, '--input-type=module', '-e', script], {cwd:workspace,
      env:{...process.env,...access.environment,FIXTURE_API:capability.baseUrl},stdout:'pipe',stderr:'pipe'})
    const timer=setTimeout(()=>child.kill(),20000)
    try {
      const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()])
      expect(code,err).toBe(0)
      expect(out).toContain('STARTUP_OBSERVATION_PASS')
      expect(sourceRequests).toBe(3)
      expect(saved).toBe('{"fontSize":17,"cameraCenter":100}')
    } finally {clearTimeout(timer)}
  } finally {await capability.close();fixture.stop(true);await rm(workspace,{recursive:true,force:true})}
},30000)

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('unchanged Node probe resolves each new turn, rejects revoked or foreign-workspace access', async () => {
  const workspace=await mkdtemp(join(tmpdir(),'bgs-preview-reuse-'))
  const other=await mkdtemp(join(tmpdir(),'bgs-preview-foreign-'))
  let value='first', capability:ReturnType<typeof openPreviewTestAccess>|undefined, revoke:(()=>Promise<void>)|undefined
  const fixture=Bun.serve({hostname:'127.0.0.1',port:0,fetch:()=>new Response('<button>'+value+'</button>',{headers:{'content-type':'text/html'}})})
  try {
    const access=await projectExecutionAccess({workspacePath:workspace,sessionId:'same-native-chat',environment:{}})
    const script=join(workspace,'inspect.mjs')
    await writeFile(script, `
      import assert from 'node:assert/strict';
      const {withPreviewPage}=await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
      const observed=await withPreviewPage({mode:'production'},async({gameFrame})=>{
        await gameFrame.getByRole('button').waitFor();
        return gameFrame.evaluate(()=>document.querySelector('button').textContent);
      });
      assert.equal(observed,process.argv[2]);console.log(observed);
    `)
    const probe=async(cwd=workspace)=>{
      const child=Bun.spawn([Bun.which('node')!,script,value],{cwd,env:{PATH:process.env.PATH,...access.environment},stdout:'pipe',stderr:'pipe'})
      const timer=setTimeout(()=>child.kill(),15000)
      try {const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);return {code,out,err}}
      finally {clearTimeout(timer)}
    }
    const open=()=>openPreviewTestAccess({start:async()=>({status:'running',url:fixture.url.href}),
      status:()=>({status:'running',url:fixture.url.href}),stop(){}})
    capability=open();const firstUrl=capability.baseUrl
    revoke=await publishProjectPreviewCapability(workspace,'same-native-chat',firstUrl)
    const first=await probe();expect(first.code,first.err).toBe(0);expect(first.out.trim()).toBe('first')
    await revoke();revoke=undefined;await capability.close();capability=undefined
    const expired=await probe();expect(expired.code).not.toBe(0);expect(expired.err).toContain('PREVIEW_CAPABILITY_EXPIRED')
    value='second';capability=open();expect(capability.baseUrl).not.toBe(firstUrl)
    revoke=await publishProjectPreviewCapability(workspace,'same-native-chat',capability.baseUrl)
    const next=await probe();expect(next.code,next.err).toBe(0);expect(next.out.trim()).toBe('second')
    const foreign=await probe(other);expect(foreign.code).not.toBe(0);expect(foreign.err).toContain('PREVIEW_CAPABILITY_MISMATCH')
    await expect(fetch(firstUrl+'/status')).rejects.toThrow()
  } finally {await revoke?.();await capability?.close();fixture.stop(true);await rm(workspace,{recursive:true,force:true});await rm(other,{recursive:true,force:true})}
},45000)

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('shared Node Playwright connects, clicks, resizes and captures an owned browser', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-playwright-fixture-'))
  const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('<html><body><button onclick="this.textContent=\'Clicked\'">Click</button></body></html>', { headers: { 'content-type': 'text/html' } }) })
  const browser = createPreviewTestBrowser()
  const capability = openPreviewTestAccess({ start: async () => ({ status: 'running', url: fixture.url.href }), status: () => ({ status: 'running', url: fixture.url.href }), stop() {}, browser })
  let endpoint: string | undefined
  try {
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'fixture', environment: {} })
    const response = await fetch(capability.baseUrl + '/browser', { method: 'POST' })
    const result = await response.json() as { endpoint?: string; error?: string }
    expect(response.status, result.error).toBe(200)
    endpoint = result.endpoint!
    const script = `
      const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);
      const browser=await chromium.connectOverCDP(process.env.FIXTURE_CDP);
      let context;
      try {
        context=await browser.newContext({viewport:{width:800,height:600}});
        const page=await context.newPage();
        await page.goto(process.env.FIXTURE_URL);
        await page.getByRole('button').click();
        if(await page.getByRole('button').textContent()!=='Clicked') throw Error('click failed');
        await page.setViewportSize({width:390,height:844});
        if(await page.evaluate(()=>innerWidth)!==390) throw Error('resize failed');
        const png=await page.screenshot();
        if(png.length<100) throw Error('capture failed');
        console.log('SHARED_PLAYWRIGHT_PASS');
      } finally { await context?.close(); await browser.close(); }
    `
    const node = Bun.which('node')
    expect(node).not.toBeNull()
    const child = Bun.spawn([node!, '--input-type=module', '-e', script], { cwd: workspace,
      env: { ...process.env, ...access.environment, FIXTURE_CDP: endpoint, FIXTURE_URL: fixture.url.href }, stdout: 'pipe', stderr: 'pipe' })
    const timeout = setTimeout(() => child.kill(), 20000)
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(code, err).toBe(0)
      expect(out).toContain('SHARED_PLAYWRIGHT_PASS')
    } finally { clearTimeout(timeout) }
  } finally {
    await capability.close()
    fixture.stop(true)
    await rm(workspace, { recursive: true, force: true })
  }
  expect(browser.status().status).toBe('closed')
  const ws = new URL(endpoint!)
  await expect(fetch(`http://${ws.host}/json/version`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow()
}, 40000)

test.skipIf(process.env.BEEGAME_TEST_REAL_BROWSER !== '1')('optional preview helper exits after success and callback failure, leaving the owned browser alive', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'bgs-preview-client-fixture-'))
  const fixture = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: () => new Response('<button onclick="this.textContent=\'Clicked\'">Click</button><script>window.lastKey=null; window.addEventListener("keydown",e=>{window.lastKey=e.key})</script>', { headers: { 'content-type': 'text/html' } }) })
  const browser = createPreviewTestBrowser()
  const capability = openPreviewTestAccess({ start: async () => ({ status: 'running', url: fixture.url.href }),
    status: () => ({ status: 'running', url: fixture.url.href }), stop() {}, browser })
  try {
    const access = await projectExecutionAccess({ workspacePath: workspace, sessionId: 'fixture', environment: {} })
    const script = `
      const { withPreviewPage } = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
      const options = { apiUrl: process.env.FIXTURE_API, mode:'production', contextOptions:{viewport:{width:640,height:360},hasTouch:true} };
      await withPreviewPage(options, async ({page,frame,gameFrame,environment}) => {
        if(environment.origin!=='opaque') throw Error('environment was lost');
        await page.keyboard.press('ArrowUp');
        if(await gameFrame.evaluate(()=>window.lastKey)!=='ArrowUp') throw Error('keyboard missed the game iframe');
        const storage=await gameFrame.evaluate(()=>{try{localStorage.getItem('fixture');return 'available'}catch(e){return e.name}});
        if(storage!=='SecurityError') throw Error('preview isolation changed');
        await frame.getByRole('button').click();
        if(await frame.getByRole('button').textContent()!=='Clicked') throw Error('click failed');
        if((await page.screenshot()).length<100) throw Error('screenshot failed');
      });
      let rejected=false;
      try { await withPreviewPage(options, async () => { throw Error('expected assertion failure'); }); }
      catch(error) { if(error.message!=='expected assertion failure') throw error; rejected=true; }
      if(!rejected) throw Error('callback failure was swallowed');
      const response=await fetch(options.apiUrl+'/browser',{method:'POST'});
      const live=await response.json();
      if(!response.ok || !live.reused) throw Error('helper shut down the capability browser');
      const {chromium}=await import(process.env.BEEGAME_PLAYWRIGHT_MODULE);
      const connection=await chromium.connectOverCDP(live.endpoint);
      try {
        if(connection.contexts().flatMap(c=>c.pages()).some(p=>p.url().includes('/host'))) throw Error('inspection pages leaked');
        const context=await connection.newContext();
        const page=await context.newPage();
        const cdp=await context.newCDPSession(page);
        const {targetInfo}=await cdp.send('Target.getTargetInfo');
        const begin=await fetch(options.apiUrl+'/recordings',{method:'POST',body:JSON.stringify({
          targetId:targetInfo.targetId,label:'restart-fixture',conditions:'Synthetic empty page; no gameplay verdict',
        })});
        if(begin.status!==201) throw Error('recording did not start');
        const record=await begin.json();
        const restarted=await fetch(options.apiUrl+'/browser/restart',{method:'POST'});
        const next=await restarted.json();
        if(!restarted.ok || next.endpoint===live.endpoint) throw Error('browser did not restart');
        const archived=await (await fetch(options.apiUrl+'/recordings/'+record.id)).json();
        if(archived.status!=='finished' || archived.endReason!=='browser-restarted' || archived.gameplayVerdict!=='not-evaluated')
          throw Error('restart did not preserve the finished observation');
      } finally { await connection.close(); }
      console.log('HELPER_SUCCESS_AND_FAILURE_CLEANUP_PASS');
    `
    const child = Bun.spawn([Bun.which('node')!, '--input-type=module', '-e', script], { cwd: workspace,
      env: { ...process.env, ...access.environment, FIXTURE_API: capability.baseUrl }, stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => child.kill(), 20000)
    try {
      const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      expect(code, err).toBe(0)
      expect(out).toContain('HELPER_SUCCESS_AND_FAILURE_CLEANUP_PASS')
    } finally { clearTimeout(timer) }
  } finally { await capability.close(); fixture.stop(true); await rm(workspace, { recursive: true, force: true }) }
}, 40000)
