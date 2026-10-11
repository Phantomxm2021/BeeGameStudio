// Isolated test Chromium, not user Chrome. The model is a loopback fake but all
// debug mutations, native tools, checks and version rejection are real.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
const {endpoint,origin,task}=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const browser=await chromium.connectOverCDP(endpoint);
try {
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/debug/workflow-v3');
  const click=async(id,confirmed=false)=>{if(confirmed)page.once('dialog',d=>d.accept());await page.locator('#'+id).click();await page.waitForFunction(id=>!document.getElementById(id).disabled,id);};
  const result=async()=>JSON.parse(await page.locator('#result').innerText());
  const current=async()=>JSON.parse(await page.locator('#run').innerText()).run;
  await page.locator('#project').fill('native-debug');await page.locator('#token').fill('synthetic-owner');
  await click('restore-chat');assert.equal((await result()).dispatched,false);await click('prepare-run');
  const draft=JSON.parse(await page.locator('#proposal').inputValue());
  draft.requirements={text:'Synthetic transport test: ask for height 80 or 96; consume saved UI, preserve notes, no dependencies',constraints:{},ids:['req.height']};
  await page.locator('#proposal').fill(JSON.stringify(draft));await click('create-run',true);
  assert.equal((await current()).attempts.length,0);await click('prepare-plan');
  const plan=JSON.parse(await page.locator('#proposal').inputValue());plan.tasks=[task];
  await page.locator('#proposal').fill(JSON.stringify(plan));await click('plan',true);
  const api=async suffix=>{const r=await fetch(origin+'/api/projects/native-debug/'+suffix,{headers:{Authorization:'Bearer synthetic-owner'}});assert.equal(r.status,200);return r.json();};
  const execute=async answer=>{
    await page.locator('#task').selectOption('game');await click('new-key');await click('execute',true);
    const deadline=Date.now()+30000;
    while(true){const q=await api('workflow-v3/questions');if(q.questions.some(q=>q.canAnswer))break;
      assert.ok(Date.now()<deadline,'actual native question never arrived');await new Promise(r=>setTimeout(r,100));}
    // Read the actual running writer, not the pre-execute candidate view.
    await click('load');await click('questions');
    assert.match(await page.locator('#question-detail').innerText(),/Choose native fixture height/);
    assert.deepEqual(JSON.parse(await page.locator('#answers').inputValue()),{'Choose native fixture height?':''});
    await page.locator('#answers').fill(JSON.stringify({'Choose native fixture height?':answer}));await click('answer',true);
    assert.equal((await result()).resolved,true);
    // Other actual native file permissions are explicitly approved ONLY in
    // this fixture. Use the existing project permission API, not policy bypass.
    while(true){const data=await api('workflow-v3');if(!data.run.writer)break;
      assert.ok(Date.now()<deadline,'native/check settlement did not finish');
      const permissions=await api('runtime-state');
      for(const p of permissions.pending_permissions??[]){
        assert.ok(['Read','Write','Skill'].includes(p.tool_name),'unexpected native tool');
        const response=await fetch(origin+'/api/projects/native-debug/permissions/'+encodeURIComponent(p.id),{method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify({decision:'allow',scope:'once'})});
        assert.equal(response.status,200);
      }
      await new Promise(r=>setTimeout(r,100));
    }
    await click('load');const run=await current();assert.equal(run.tasks.game.status,'succeeded',JSON.stringify(run.attempts.at(-1)));
    await click('preview');await page.frameLocator('#preview-frame').locator('#play[style*="height: '+answer+'px"]').waitFor();
    await page.frameLocator('#preview-frame').locator('#play').click();assert.equal(await page.frameLocator('#preview-frame').locator('#feedback').innerText(),'Clicked');
    const url=(await result()).preview.url;
    await click('project-export');assert.equal((await result()).kind,'project');assert.ok((await result()).bytes>0);
    return {run,url};
  };
  const initial=await execute('80');await click('prepare-change');
  const change=JSON.parse(await page.locator('#proposal').inputValue());change.requirements.text='New confirmed height 96; preserve independent notes. Rebuild and remeasure the changed source.';
  await page.locator('#proposal').fill(JSON.stringify(change));await click('requirements',true);
  assert.equal((await result()).dispatched,false);assert.equal((await current()).tasks.game.status,'pending');assert.equal((await current()).tasks.game.attemptId,undefined);
  const stale=await browser.newPage();assert.equal((await stale.goto(initial.url)).status(),409);await stale.close();
  const revised=await execute('96');assert.notEqual(revised.run.requirements.revision,initial.run.requirements.revision);
  assert.notEqual(revised.run.tasks.game.attemptId,initial.run.tasks.game.attemptId);assert.notEqual(revised.url,initial.url);
  await click('stop');const paused=await current();assert.ok(paused.paused);
  await page.reload();await page.locator('#project').fill('native-debug');await page.locator('#token').fill('synthetic-owner');await click('load');
  assert.equal((await current()).version,paused.version);assert.deepEqual((await current()).paused,paused.paused);assert.equal((await current()).writer,undefined);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,coverage:['debug-bootstrap','actual-native-question-answer','native-skill-read-write','ui-position-size-restoration','source-copy-build','measured-project-export','new-requirements-invalidate-old-preview','fresh-native-session-and-measurement','pause-reload'],limits:['local-store','deterministic-loopback-model','representative-DOM-only','not-game-quality']}));
} finally {await browser.close();}
