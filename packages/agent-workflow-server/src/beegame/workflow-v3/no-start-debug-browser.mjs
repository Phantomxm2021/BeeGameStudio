// Dedicated synthetic browser, not the user's Chrome or game projects.
import assert from 'node:assert/strict';
import {answerDebugConfirmation} from './debug-confirm-browser-helper.mjs';
const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
const {endpoint,origin,recoverAfterRestart}=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const browser=await chromium.connectOverCDP(endpoint);
try {
  const page=await browser.newPage();await page.goto(origin+'/debug/workflow-v3');
  await page.locator('#project').fill('no-start-debug');await page.locator('#token').fill('synthetic-owner');
  const action=async(id,confirm=false,success=true)=>{
    await page.locator('#'+id).click(); if (confirm) await answerDebugConfirmation(page);
    await page.waitForFunction(()=>!document.getElementById('status').textContent.startsWith('执行 '));
    if(success)assert.match(await page.locator('#status').innerText(),/^完成 /);
  };
  const readRun=async()=>{await action('load');return JSON.parse(await page.locator('#run').innerText());};
  await action('restore-chat');await action('prepare-goal');
  await page.locator('#goal-brief').fill(JSON.stringify({kind:'confirmed_build_brief',idea:'Synthetic request fault acceptance only. Preserve notes; not a game.',
    selected_option:{title:'Synthetic no-start and recovery transport'},settings:{},document_language:'en',game_user_visible_language:'en',
    agent_response_language:'en',resource_library_usage:'optional'}));
  await action('submit-goal',true,false);assert.match(await page.locator('#status').innerText(),/HTTP 500/);
  let state=await readRun();const initial=state.run;
  assert.equal(initial.agentTurns[0].notStarted,true);assert.equal(initial.agentTurns[0].nativeSessionId,undefined);
  await action('submit-goal',true);state=await readRun();assert.equal(state.run.agentTurns.length,1);
  await action('stop');await action('resume');state=await readRun();assert.equal(state.run.agentTurns.length,1);
  const reconstructed=await fetch(origin+'/fixture/reconstruct',{method:'POST',headers:{Authorization:'Bearer synthetic-owner'}});
  assert.equal(reconstructed.status,200);await action('load');await action('restore-chat');
  await page.locator('#message-intent').selectOption('work');
  await page.locator('#message-text').fill('Explicit synthetic new work: use the current confirmed requirements, ask before proceeding, preserve notes. This is a new authorization, not replay of the failed request.');
  await action('prepare-message');await action('submit-message',true);
  let answered=false;const deadline=Date.now()+40000;
  while(true) {
    state=await readRun();assert.ok(Date.now()<deadline,'Original host exit observation was not reached');
    if(state.recoveryEvidence==='original-host' && state.writerLiveness==='unknown')break;
    const r=await fetch(origin+'/api/projects/no-start-debug/runtime-state',{headers:{Authorization:'Bearer synthetic-owner'}});
    assert.equal(r.status,200);const runtime=await r.json();
    for(const p of runtime.pending_permissions??[]) {
      if(p.tool_name==='AskUserQuestion') {
        assert.equal(answered,false);await action('questions');
        assert.match(await page.locator('#question-detail').innerText(),/Proceed with this synthetic new request/);
        await page.locator('#answers').fill(JSON.stringify({'Proceed with this synthetic new request?':'Proceed'}));
        await action('answer',true);answered=true;
      }else{
        assert.ok(['Skill','Write'].includes(p.tool_name));
        const allowed=await fetch(origin+'/api/projects/no-start-debug/permissions/'+encodeURIComponent(p.id),{
          method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify({decision:'allow',scope:'once'})});
        assert.equal(allowed.status,200);
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(answered);assert.equal(state.run.agentTurns[1].quiescedAt,undefined);
  if(recoverAfterRestart) {
    const restarted=await fetch(origin+'/fixture/reconstruct',{method:'POST',headers:{Authorization:'Bearer synthetic-owner'}});
    assert.equal(restarted.status,200);state=await readRun();
    assert.equal(state.recoveryEvidence,'host-receipt');assert.equal(state.hostExitReceiptsConfigured,true);
    assert.ok(state.run.writer);assert.equal(state.run.agentTurns[1].quiescedAt,undefined);
  }
  await action('recover-writer',true);state=await readRun();
  assert.equal(state.run.writer,undefined);assert.equal(state.run.agentTurns[1].status,'interrupted');
  assert.ok(state.run.agentTurns[1].quiescedAt);assert.equal(state.run.agentTurns.length,2);
  assert.equal(state.run.requirements.revision,initial.requirements.revision);assert.equal(state.run.deliveryEligible,false);
  assert.deepEqual(state.run.tasks,{});assert.equal(state.recoveryEvidence,'unavailable');
  await page.locator('#load').scrollIntoViewIfNeeded();await page.screenshot({path:recoverAfterRestart?'/private/tmp/bgs-v3-178-debug-controlled.png':'/private/tmp/bgs-v3-177-debug-controlled.png'});
  console.log(JSON.stringify({passed:true,answered,limitations:'Controlled native transport only; not game quality or a real remote database'}));
}finally{await browser.close();}
