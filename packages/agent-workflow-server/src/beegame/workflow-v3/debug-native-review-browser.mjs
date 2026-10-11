// Owned test Chromium only; never attaches to user Chrome or a paid model.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
const {endpoint,origin,task,notesTask}=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const browser=await chromium.connectOverCDP(endpoint);
try{
  const page=await browser.newPage(),errors=[],permissionTools=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/debug/workflow-v3');
  const click=async(id,confirmed=false)=>{if(confirmed)page.once('dialog',d=>d.accept());await page.locator('#'+id).click();await page.waitForFunction(id=>!document.getElementById(id).disabled,id);};
  const result=async()=>JSON.parse(await page.locator('#result').innerText()),current=async()=>JSON.parse(await page.locator('#run').innerText()).run;
  const api=async suffix=>{const r=await fetch(origin+'/api/projects/native-debug/'+suffix,{headers:{Authorization:'Bearer synthetic-owner'}});assert.equal(r.status,200);return r.json();};
  await page.locator('#project').fill('native-debug');await page.locator('#token').fill('synthetic-owner');await click('restore-chat');await click('prepare-run');
  const draft=JSON.parse(await page.locator('#proposal').inputValue());draft.requirements={text:'Synthetic native protocol fixture: user chooses 80 or 96 height during repair; actual UI consumption, preserved notes, no new dependencies',constraints:{},ids:['req.height']};
  await page.locator('#proposal').fill(JSON.stringify(draft));await click('create-run',true);assert.equal((await current()).attempts.length,0);
  await click('prepare-plan');const plan=JSON.parse(await page.locator('#proposal').inputValue());plan.tasks=[task,notesTask];await page.locator('#proposal').fill(JSON.stringify(plan));await click('plan',true);
  const execute=async(id,answer)=>{
    await page.locator('#task').selectOption(id);await click('new-key');await click('execute',true);
    const deadline=Date.now()+35000;let answered=false;
    while(true){const data=await api('workflow-v3');if(!data.run.writer)break;assert.ok(Date.now()<deadline,'actual native task did not settle');
      if(answer&&!answered){const questions=await api('workflow-v3/questions');if(questions.questions.some(q=>q.canAnswer)){
        await click('load');await click('questions');assert.match(await page.locator('#question-detail').innerText(),/F1/);
        const answers=JSON.parse(await page.locator('#answers').inputValue());assert.deepEqual(Object.values(answers),['']);
        answers[Object.keys(answers)[0]]=answer;await page.locator('#answers').fill(JSON.stringify(answers));await click('answer',true);assert.equal((await result()).resolved,true);answered=true;
      }}
      const runtime=await api('runtime-state');
      for(const p of runtime.pending_permissions??[]){if(p.tool_name==='AskUserQuestion')continue;
        assert.equal(p.session_id,data.run.writer.sessionId);assert.ok(['Skill','Read','Write'].includes(p.tool_name));permissionTools.push(p.tool_name);
        const response=await fetch(origin+'/api/projects/native-debug/permissions/'+encodeURIComponent(p.id),{method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify({decision:'allow',scope:'once'})});assert.equal(response.status,200);
      }
      await new Promise(r=>setTimeout(r,100));
    }
    if(answer)assert.ok(answered,'no actual user question was answered');await click('load');return current();
  };
  await execute('game');const baseline=await execute('notes');assert.equal(baseline.tasks.game.status,'succeeded');assert.equal(baseline.tasks.notes.status,'succeeded');
  const notes=structuredClone(baseline.tasks.notes);await page.locator('#task').selectOption('game');await click('preview');
  const oldUrl=(await result()).preview.url;await page.frameLocator('#preview-frame').locator('#play[style*="height: 52px"]').waitFor();
  await click('prepare-observation');const observation=JSON.parse(await page.locator('#observation-json').inputValue());
  Object.assign(observation,{requirementIds:['req.height'],steps:'Open measured Preview and inspect button',expected:'User-selected 80 or 96 pixels',observed:'Initial saved and rendered height is 52 pixels'});
  await page.locator('#observation-json').fill(JSON.stringify(observation));await click('submit-observation',true);const issue=(await result()).issue;assert.equal((await result()).dispatched,false);
  await click('issue-review',true);assert.equal((await result()).dispatched,false);const reviewId='preview-review.'+issue.id;
  const reviewed=await execute(reviewId),initial=reviewed.attempts.find(a=>a.attemptId===reviewed.tasks[reviewId].attemptId);
  assert.equal(reviewed.tasks[reviewId].status,'failed',JSON.stringify(initial));assert.equal(initial.review.findings[0].ownerTaskId,'game');
  await page.locator('#review-attempt').selectOption(initial.attemptId);await page.locator('#finding-ids').fill('["F1"]');await click('issue-repair',true);
  assert.equal((await result()).dispatched,false);assert.deepEqual((await current()).tasks.notes,notes);
  const stale=await browser.newPage();assert.equal((await stale.goto(oldUrl)).status(),409);await stale.close();
  const repaired=await execute('game','80'),repair=repaired.attempts.find(a=>a.attemptId===repaired.tasks.game.attemptId);
  assert.equal(repaired.tasks.game.status,'succeeded',JSON.stringify(repair));assert.equal(repair.checks.find(c=>c.id==='repair-verification').status,'passed');
  assert.equal(repaired.tasks[reviewId].status,'pending','repair cannot close review by itself');assert.deepEqual(repaired.tasks.notes,notes);
  await page.locator('#task').selectOption('game');await click('preview');await page.frameLocator('#preview-frame').locator('#play[style*="height: 80px"]').waitFor();
  await page.frameLocator('#preview-frame').locator('#play').click();assert.equal(await page.frameLocator('#preview-frame').locator('#feedback').innerText(),'Clicked');
  const closed=await execute(reviewId);assert.equal(closed.tasks[reviewId].status,'succeeded',JSON.stringify(closed.attempts.at(-1)));
  assert.equal(closed.attempts.at(-1).review.closed[0].repairAttemptId,repair.attemptId);assert.deepEqual(closed.tasks.notes,notes);
  assert.equal(closed.attempts.find(a=>a.attemptId===initial.attemptId).review.findings.length,1);
  await page.locator('#task').selectOption('game');await click('project-export');assert.equal((await result()).kind,'project');assert.ok((await result()).bytes>0);
  await click('stop');const paused=await current();assert.ok(paused.paused);assert.equal(paused.deliveryEligible,false);
  await page.reload();await page.locator('#project').fill('native-debug');await page.locator('#token').fill('synthetic-owner');await click('load');assert.equal((await current()).version,paused.version);assert.deepEqual((await current()).paused,paused.paused);assert.equal((await current()).writer,undefined);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,permissionTools,coverage:['actual-native-source-backed-review','source-bound-question-answer','original-owner-repair','fresh-rule-build-UI-consumption','directed-followup','original-report-and-notes-preserved','export-and-pause-reload'],limits:['local-store','offline-model-not-semantic-quality']}));
}finally{await browser.close();}
