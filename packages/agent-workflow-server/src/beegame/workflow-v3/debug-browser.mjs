// Dedicated synthetic browser regression; never attaches to the user's Chrome.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.BGS_PLAYWRIGHT_MODULE);
const { endpoint, origin } = JSON.parse(await new Promise(resolve => {
  let text = ''; process.stdin.on('data', bytes => text += bytes); process.stdin.on('end', () => resolve(text));
}));
const browser = await chromium.connectOverCDP(endpoint);
try {
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  let apiCalls = 0, lastAuthHeader; page.on('request', r => { if (r.url().includes('/api/')) { apiCalls++; lastAuthHeader=Boolean(r.headers().authorization); } });
  await page.goto(origin + '/debug/workflow-v3');
  assert.equal(apiCalls, 0, 'opening the shell must not read or mutate a project');
  const click = async id => { await page.locator('#' + id).click(); await page.locator('#' + id).waitFor({ state: 'visible' });
    await page.waitForFunction(id => !document.getElementById(id).disabled, id); };
  const result = async () => JSON.parse(await page.locator('#result').innerText());
  const run = async () => (JSON.parse(await page.locator('#run').innerText())).run;
  await page.locator('#project').fill('p'); await page.locator('#token').fill('invalid');
  await click('load'); assert.match(await page.locator('#status').innerText(), /HTTP 401/);
  await page.locator('#auth-mode').selectOption('session');await click('load');
  assert.match(await page.locator('#status').innerText(),/HTTP 401/);assert.equal(lastAuthHeader,false,'Cookie mode must not send the ignored token');
  // Controlled session only in this dedicated test browser, not user Chrome.
  await page.context().addCookies([{name:'debug_fixture_session',value:'synthetic-owner',url:origin,httpOnly:true,sameSite:'Strict'}]);
  await click('load');assert.equal((await run()).tasks.notes.status,'succeeded');await click('content');
  assert.equal(await page.locator('#token').inputValue(),'invalid','Cookie credential is never copied into the token field');
  await page.locator('#auth-mode').selectOption('bearer');assert.equal(await page.locator('#run').innerText(),'');assert.equal(await page.locator('#document-json').inputValue(),'');
  await page.context().clearCookies();
  await page.locator('#token').fill('synthetic-owner'); await click('load');
  assert.equal((await run()).tasks.notes.status, 'succeeded');
  const existingRun = await run();
  await click('restore-chat'); assert.equal((await result()).dispatched,false);
  const prepareRunCalls=apiCalls;await click('prepare-run');assert.equal(apiCalls,prepareRunCalls);
  const bootstrap=JSON.parse(await page.locator('#proposal').inputValue());
  assert.equal(bootstrap.chatSessionId,'chat');assert.equal(bootstrap.requirements.text,'');assert.deepEqual(bootstrap.requirements.ids,[]);
  bootstrap.requirements={text:'Synthetic request',constraints:{},ids:['req.play']};
  await page.locator('#proposal').fill(JSON.stringify(bootstrap));
  page.once('dialog',d=>d.dismiss());const declinedRunCalls=apiCalls;await click('create-run');assert.equal(apiCalls,declinedRunCalls);
  page.once('dialog',d=>d.accept());await click('create-run');assert.match(await page.locator('#status').innerText(),/HTTP 409.*run-exists/);
  assert.deepEqual(await run(),existingRun,'new Run action cannot overwrite existing history');
  bootstrap.chatSessionId='invented';await page.locator('#proposal').fill(JSON.stringify(bootstrap));
  const invalidChatCalls=apiCalls;await click('create-run');assert.equal(apiCalls,invalidChatCalls);
  assert.match(await page.locator('#status').innerText(),/实际恢复的 Chat/);
  const partialBody=page.waitForResponse(r=>r.url().endsWith('/session/ensure'));
  const delayedRestore=click('restore-chat');await partialBody;await page.locator('#project').fill('other');await delayedRestore;
  assert.match(await page.locator('#status').innerText(),/请求期间项目或身份改变/);
  const staleChatCalls=apiCalls;await click('prepare-run');assert.equal(apiCalls,staleChatCalls);assert.match(await page.locator('#status').innerText(),/先恢复/);
  await page.locator('#project').fill('p');await click('load');
  await click('content');
  assert.equal(await page.locator('#result').innerText().then(t => t.includes('synthetic-owner')), false, 'credential must never be rendered');
  const before = await run(), oldAttempt = before.tasks.game.attemptId;
  const doc = JSON.parse(await page.locator('#document-json').inputValue()); doc.data.nodes[1].layout.size[1] = 64;
  await page.locator('#document-json').fill(JSON.stringify(doc)); await click('save');
  assert.equal((await result()).unmeasured, true);
  const saved = await run(); assert.equal(saved.tasks.game.status, 'pending');
  assert.ok(saved.attempts.at(-1).sourceEdit); assert.ok(saved.attempts.at(-1).quiescedAt, 'source replacement drains before settlement');
  assert.deepEqual(saved.tasks.notes, before.tasks.notes);
  // A candidate without a NEW successful attempt cannot reuse the old package.
  await page.locator('#task').selectOption('game'); await click('static');
  assert.match(await page.locator('#status').innerText(), /实际 Attempt/);
  assert.equal(await page.locator('#downloads a').count(), 0);
  // Force an external version change through the same authorized API, then
  // prove a draft's original version survives refresh and fails, not retries.
  const paused = await page.evaluate(async () => (await fetch('/api/projects/p/workflow-v3/stop', {method:'POST',headers:{Authorization:'Bearer synthetic-owner'}})).json());
  assert.equal(paused.run.paused !== undefined, true);
  doc.data.nodes[1].layout.size[1] = 70;
  await page.locator('#document-json').fill(JSON.stringify(doc)); await click('load');
  const requestsBefore = apiCalls; await click('save');
  assert.match(await page.locator('#status').innerText(), /HTTP 409.*run-paused/);
  assert.equal(apiCalls, requestsBefore + 1, 'failed save must not retry or silently reload');
  assert.equal(JSON.parse(await page.locator('#document-json').inputValue()).data.nodes[1].layout.size[1], 70);
  await click('resume');assert.equal((await result()).dispatched,false);
  await click('save');assert.match(await page.locator('#status').innerText(),/HTTP 409.*revision-conflict/);
  assert.equal(JSON.parse(await page.locator('#document-json').inputValue()).data.nodes[1].layout.size[1],70);
  await click('content');
  assert.equal(JSON.parse(await page.locator('#document-json').inputValue()).data.nodes[1].layout.size[1], 64);
  await click('resume'); assert.equal((await result()).dispatched, false);
  await page.locator('#task').selectOption('game'); await click('new-key');
  const key = await page.locator('#request-key').inputValue();
  // Declining execution spends nothing, accepting is a single invocation.
  page.once('dialog', d => d.dismiss()); const noCall = apiCalls; await click('execute');
  assert.equal(apiCalls, noCall); assert.equal((await result()).cancelled, true);
  page.once('dialog', d => d.accept()); await click('execute');
  assert.equal((await result()).attempt.requestKey, key);
  // Explicit read-only test observation, not polling/retry in the client.
  const deadline = Date.now() + 30000;
  while (true) {
    const data = await (await fetch(origin + '/api/projects/p/workflow-v3', {headers:{Authorization:'Bearer synthetic-owner'}})).json();
    if (!data.run.writer) break;
    assert.ok(Date.now() < deadline, 'synthetic native checks did not settle');
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  await click('load');
  const measured = await run(); assert.equal(measured.tasks.game.status, 'succeeded', JSON.stringify(measured.attempts.at(-1)));
  assert.notEqual(measured.tasks.game.attemptId, oldAttempt); assert.deepEqual(measured.tasks.notes, before.tasks.notes);
  await page.locator('#task').selectOption('game'); await click('static');
  assert.equal((await result()).kind, 'static'); assert.ok((await result()).bytes > 0);
  await click('project-export'); assert.equal(await page.locator('#status').innerText(), '完成 project-export');
  assert.equal((await result()).kind, 'project'); assert.ok((await result()).bytes > 0);
  await click('preview'); assert.equal(await page.locator('#status').innerText(), '完成 preview');
  let oldPreview = (await result()).preview.url;
  assert.notEqual(new URL(oldPreview).origin, origin);
  assert.equal(await page.locator('#preview-frame').getAttribute('sandbox'), 'allow-scripts');
  await page.frameLocator('#preview-frame').locator('#play[style*="height: 64px"]').waitFor();
  await page.frameLocator('#preview-frame').locator('#play').evaluate(element => {
    if (element.style.height !== '64px') throw Error('Preview did not consume newly rebuilt JSON');
  });
  // Observations are user evidence, not an automatic quality decision or dispatch.
  const prepareCalls = apiCalls; await click('prepare-observation'); assert.equal(apiCalls, prepareCalls);
  const observation = JSON.parse(await page.locator('#observation-json').inputValue());
  assert.deepEqual(observation.requirementIds, []); assert.equal(observation.observed, '');
  observation.requirementIds=['req.play']; observation.steps='Open Preview and inspect the play button';
  observation.expected='Confirmed height is 80px'; observation.observed='Rendered height is 64px';
  await page.locator('#observation-json').fill(JSON.stringify(observation));
  page.once('dialog',d=>d.dismiss()); const cancelIssue=apiCalls;await click('submit-observation');assert.equal(apiCalls,cancelIssue);
  page.once('dialog',d=>d.accept());await click('submit-observation');
  const issue=(await result()).issue;assert.equal((await result()).dispatched,false);
  page.once('dialog',d=>d.accept());await click('submit-observation');assert.equal((await result()).issue.id,issue.id);
  observation.observed='Different observation with the same request key';
  await page.locator('#observation-json').fill(JSON.stringify(observation));page.once('dialog',d=>d.accept());await click('submit-observation');
  assert.match(await page.locator('#status').innerText(),/HTTP 409.*duplicate-request/);
  observation.observed='Rendered height is 64px';await page.locator('#observation-json').fill(JSON.stringify(observation));
  page.once('dialog',d=>d.accept());await click('issue-review');assert.equal((await result()).dispatched,false);
  assert.equal((await run()).tasks.game.status,'succeeded');assert.deepEqual((await run()).tasks.notes,before.tasks.notes);
  const reviewTask='preview-review.'+issue.id;
  const executeTask=async id=>{
    await page.locator('#task').selectOption(id);await click('new-key');page.once('dialog',d=>d.accept());await click('execute');
    const deadline=Date.now()+30000;
    while(true){const data=await(await fetch(origin+'/api/projects/p/workflow-v3',{headers:{Authorization:'Bearer synthetic-owner'}})).json();
      if(!data.run.writer)break;assert.ok(Date.now()<deadline,'synthetic task did not settle');await new Promise(resolve=>setTimeout(resolve,150));}
    await click('load');
  };
  await executeTask(reviewTask);
  const reviewed=await run(), firstReview=reviewed.attempts.find(a=>a.attemptId===reviewed.tasks[reviewTask].attemptId);
  assert.equal(firstReview.status,'failed',JSON.stringify(firstReview));assert.equal(firstReview.review.findings[0].ownerTaskId,'game');
  await page.locator('#review-attempt').selectOption(firstReview.attemptId);
  assert.match(await page.locator('#review-detail').innerText(),/64px/);
  await page.locator('#finding-ids').fill('[]');page.once('dialog',d=>d.accept());await click('issue-repair');
  assert.match(await page.locator('#status').innerText(),/HTTP 400.*invalid-repair/);assert.equal((await run()).planRevision,reviewed.planRevision);
  await page.locator('#finding-ids').fill('["F1"]');page.once('dialog',d=>d.accept());await click('issue-repair');
  assert.equal((await result()).dispatched,false);const repairPlan=await run();assert.equal(repairPlan.tasks.game.status,'pending');
  assert.deepEqual(repairPlan.tasks.game.spec.writablePaths,before.tasks.game.spec.writablePaths);assert.deepEqual(repairPlan.tasks.notes,before.tasks.notes);
  const rejectedPreview=await browser.newPage();assert.equal((await rejectedPreview.goto(oldPreview)).status(),409);await rejectedPreview.close();
  // Refresh must not silently bind an old draft to this new plan or build.
  const staleObservation={...observation,requestKey:crypto.randomUUID()};
  await page.locator('#observation-json').fill(JSON.stringify(staleObservation));page.once('dialog',d=>d.accept());const staleIssueCalls=apiCalls;await click('submit-observation');
  assert.match(await page.locator('#status').innerText(),/HTTP 409/);assert.equal(apiCalls,staleIssueCalls+1);
  assert.deepEqual(JSON.parse(await page.locator('#observation-json').inputValue()),staleObservation);
  await executeTask('game');const repaired=await run(),repairAttempt=repaired.attempts.find(a=>a.attemptId===repaired.tasks.game.attemptId);
  assert.equal(repaired.tasks.game.status,'succeeded',JSON.stringify(repairAttempt));
  assert.equal(repairAttempt.checks.find(c=>c.id==='rule-tests').status,'passed');
  assert.equal(repaired.tasks[reviewTask].status,'pending','repair alone cannot close review');
  assert.equal(repaired.attempts.find(a=>a.attemptId===firstReview.attemptId).review.findings.length,1);
  await page.locator('#task').selectOption('game');await click('preview');
  await page.frameLocator('#preview-frame').locator('#play[style*="height: 80px"]').waitFor();
  assert.notEqual((await result()).preview.url,oldPreview);
  await executeTask(reviewTask);const closed=await run(),follow=closed.attempts.find(a=>a.attemptId===closed.tasks[reviewTask].attemptId);
  assert.equal(follow.status,'succeeded',JSON.stringify(follow));assert.equal(follow.review.closed[0].repairAttemptId,repairAttempt.attemptId);
  assert.deepEqual(closed.tasks.notes,before.tasks.notes);assert.equal(closed.previewIssues.length,1);
  assert.equal(closed.attempts.find(a=>a.attemptId===firstReview.attemptId).review.findings.length,1);
  await page.locator('#task').selectOption('game');await click('static');assert.equal((await result()).kind,'static');
  await click('project-export');assert.equal((await result()).kind,'project');await click('preview');oldPreview=(await result()).preview.url;
  await page.frameLocator('#preview-frame').locator('#play[style*="height: 80px"]').waitFor();
  await click('prepare-change');
  const proposal = JSON.parse(await page.locator('#proposal').inputValue()); proposal.requirements.text = 'Changed synthetic goal';
  await page.locator('#proposal').fill(JSON.stringify(proposal));
  page.once('dialog', d => d.accept()); await click('requirements');
  assert.match(await page.locator('#status').innerText(),/HTTP 400 historical-review-scope/);
  assert.equal((await run()).requirements.revision,closed.requirements.revision);
  assert.deepEqual(JSON.parse(await page.locator('#proposal').inputValue()),proposal,'invalid authority draft must not be automatically cleaned');
  // Explicitly authorize the original normal tasks for the new requirements,
  // rather than carrying forward old findings, repair goals or review checks.
  proposal.tasks=Object.values(before.tasks).map(t=>t.spec);
  await page.locator('#proposal').fill(JSON.stringify(proposal));
  page.once('dialog',d=>d.accept());await click('requirements');
  assert.equal(await page.locator('#status').innerText(),'完成 requirements');
  assert.equal((await result()).dispatched, false); assert.equal((await result()).requiresRebuild, true);
  const changed = await run();
  assert.notEqual(changed.requirements.revision, before.requirements.revision);
  assert.equal(changed.tasks.game.status, 'pending'); assert.equal(changed.requirementChanges.length, 1);
  assert.equal(await page.locator('#preview-frame').isVisible(), false);
  const stalePage = await browser.newPage();
  assert.equal((await stalePage.goto(oldPreview)).status(), 409, 'old measured Preview must reject the new requirement version');
  await stalePage.close();
  // Explicit stale proposal is rejected, kept intact, never auto re-versioned.
  proposal.requirements.text = 'Stale synthetic goal'; proposal.requestKey = crypto.randomUUID();
  await page.locator('#proposal').fill(JSON.stringify(proposal));
  page.once('dialog', d => d.accept()); const beforeConflict = apiCalls; await click('requirements');
  assert.match(await page.locator('#status').innerText(), /HTTP 409/); assert.equal(apiCalls, beforeConflict + 1);
  await click('stop'); await page.reload();
  assert.equal(await page.locator('#token').inputValue(), '');
  await page.locator('#project').fill('p'); await page.locator('#token').fill('synthetic-owner'); await click('load');
  assert.ok((await run()).paused, 'reopening must not resume or dispatch');
  await page.locator('#project').fill('other');
  assert.equal(await page.locator('#document-json').inputValue(), ''); assert.equal(await page.locator('#downloads a').count(), 0);
  assert.equal(await page.locator('#run').innerText(), '');
  assert.equal(await page.locator('#observation-json').inputValue(),'');assert.equal(await page.locator('#review-detail').innerText(),'');
  await click('save'); assert.match(await page.locator('#status').innerText(), /先读取/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({passed:true, coverage:['no-auto-call','normal-auth','source-edit','stale-draft','local-invalidation','fresh-build-and-measure','export','measured-sandbox-preview','stale-preview-rejected','observation-idempotency','explicit-review-plan','original-owner-repair','actual-rule-build-runtime','source-backed-followup','unrelated-task-preserved','requirement-change','pause-reload','no-auto-retry','credential-isolation'], limits:['synthetic native provider and semantic report','no game quality or real model cost']}));
} finally { await browser.close(); }
