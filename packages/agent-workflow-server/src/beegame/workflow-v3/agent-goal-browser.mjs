// Controlled test browser, not user Chrome; all mutations use real debug/API.
import assert from 'node:assert/strict';
import {answerDebugConfirmation} from './debug-confirm-browser-helper.mjs';
const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
const {endpoint,origin,brief,focusedContinuation=false}=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const browser=await chromium.connectOverCDP(endpoint);
try {
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/debug/workflow-v3');
  const click=async(id,confirm=false)=>{
    await page.locator('#'+id).click(); if (confirm) await answerDebugConfirmation(page);
    await page.waitForFunction(id=>!document.getElementById(id).disabled,id);
    assert.ok((await page.locator('#status').innerText()).startsWith('完成'),await page.locator('#status').innerText());
  };
  const result=async()=>JSON.parse(await page.locator('#result').innerText());
  const api=async suffix=>{
    const r=await fetch(origin+'/api/projects/agent-debug/'+suffix,{headers:{Authorization:'Bearer synthetic-owner'}});
    assert.equal(r.status,200);return r.json();
  };
  await page.locator('#project').fill('agent-debug');await page.locator('#token').fill('synthetic-owner');
  await click('restore-chat');await click('prepare-goal');
  await page.locator('#goal-brief').fill(JSON.stringify(brief));await click('submit-goal',true);
  const dispatched=await result();assert.equal(dispatched.turn.status,'running');
  // Duplicate click reuses the same intake, including when the turn is active.
  await click('submit-goal',true);assert.equal((await result()).turn.attemptId,dispatched.turn.attemptId);
  let answered=false;const tools=new Set(),deadline=Date.now()+40000;
  while(true) {
    const state=await api('workflow-v3');
    if(!state.run.writer)break;
    assert.ok(Date.now()<deadline,'goal did not settle');
    const runtime=await api('runtime-state');
    for(const p of runtime.pending_permissions??[]) {
      tools.add(p.tool_name);
      if(p.tool_name==='AskUserQuestion') {
        assert.equal(answered,false);await click('load');await click('questions');
        assert.match(await page.locator('#question-detail').innerText(),/Choose synthetic color/);
        await page.locator('#answers').fill(JSON.stringify({'Choose synthetic color?':'Blue'}));
        await click('answer',true);assert.equal((await result()).resolved,true);answered=true;
      } else {
        assert.ok(['TodoWrite','Skill','Write','Read','Edit','Bash'].includes(p.tool_name),'unexpected permission '+p.tool_name);
        const r=await fetch(origin+'/api/projects/agent-debug/permissions/'+encodeURIComponent(p.id),{
          method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},
          body:JSON.stringify({decision:'allow',scope:'once'})});
        assert.equal(r.status,200);
      }
    }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await click('load');const run=JSON.parse(await page.locator('#run').innerText()).run;
  assert.equal(run.planRevision,0);assert.equal(['plans','tasks','attempts'].some(key=>key in run),false);
  assert.equal(run.agentTurns.length,1);assert.equal(run.agentTurns[0].status,'ended',JSON.stringify(run.agentTurns[0]));
  assert.equal(run.deliveryEligible,false);assert.ok(answered);
  await click('read-measurement');const firstMeasurement=await result();
  assert.equal(firstMeasurement.freshness.current,true,JSON.stringify(firstMeasurement));
  assert.equal(firstMeasurement.quality,'unverified');
  assert.equal(firstMeasurement.execution.attemptId,run.agentTurns[0].attemptId);
  await click('project-export');assert.ok((await result()).bytes>0);
  await click('preview');assert.equal((await result()).preview.measurementId,firstMeasurement.id);
  await page.locator('#preview-frame').contentFrame().locator('#target').waitFor();
  assert.equal(await page.locator('#preview-frame').contentFrame().locator('#target').innerText(),'3');
  await click('prepare-observation');
  const observation=JSON.parse(await page.locator('#observation-json').inputValue());
  observation.steps='Open the measured page';observation.expected='Target 3 for the original request';observation.observed='Target 3 is displayed';
  await page.locator('#observation-json').fill(JSON.stringify(observation));await click('observation-message');
  assert.equal((await result()).dispatched,false);
  assert.equal(await page.locator('#message-intent').inputValue(),'message');
  assert.match(await page.locator('#message-text').inputValue(),new RegExp(firstMeasurement.id));
  assert.equal((await api('workflow-v3')).run.agentTurns.length,1,'observation drafts must not dispatch or publish Tasks');
  observation.artifactSha256='changed';await page.locator('#observation-json').fill(JSON.stringify(observation));
  await page.locator('#observation-message').click();
  await page.waitForFunction(()=>!document.getElementById('observation-message').disabled);
  assert.match(await page.locator('#status').innerText(),/来源已改变/);
  await click('close-preview');
  await click('artifact-index');
  await page.locator('#evidence-path').fill('README.md');await click('read-evidence');
  const evidence=await result();
  assert.equal(evidence.requirements.revision,run.requirements.revision);
  assert.match(evidence.source.content,/Synthetic merged design record/);
  assert.match(evidence.source.utf8ContentSha256,/^[a-f0-9]{64}$/);
  assert.equal(evidence.acceptance,'unverified');assert.equal(evidence.recordedTurns.length,1);
  await page.locator('#evidence-path').fill('missing-report.md');
  await page.locator('#read-evidence').click();
  await page.waitForFunction(()=>!document.getElementById('read-evidence').disabled);
  assert.match(await page.locator('#status').innerText(),/HTTP 404/);
  assert.equal(await page.locator('#result').innerText(),'','failed reads must not leave old evidence displayed');
  assert.equal((await api('workflow-v3')).run.agentTurns.length,1,'reading evidence must not execute a model');
  await click('events');
  const events=(await result()).events;
  assert.ok(events.some(e=>e.type==='tool.started'&&e.payload.toolName==='TodoWrite'));
  assert.ok(events.some(e=>e.type==='tool.failed'&&e.payload.toolName==='Bash'));
  assert.ok(events.some(e=>e.type==='tool.completed'&&e.payload.toolName==='Bash'));
  await click('questions');
  assert.ok((await result()).decisions.some(d=>d.type==='permission.resolved'&&d.payload.input.answers['Choose synthetic color?']==='Blue'));
  await click('submit-goal',true);assert.equal((await result()).turn.attemptId,dispatched.turn.attemptId);
  await click('stop');await click('resume');assert.equal((await result()).dispatched,false);
  const waitTurn=async count=>{
    const limit=Date.now()+30000;
    while(true) {
      const state=(await api('workflow-v3')).run;
      assert.ok(Date.now()<limit,'message did not settle');
      if(!state.writer && state.agentTurns.length===count) {await click('load');return state;}
      const runtime=await api('runtime-state');
      for(const p of runtime.pending_permissions??[]) {
        assert.notEqual(p.tool_name,'AskUserQuestion','unexpected new question');
        const r=await fetch(origin+'/api/projects/agent-debug/permissions/'+encodeURIComponent(p.id),{
          method:'POST',headers:{Authorization:'Bearer synthetic-owner','content-type':'application/json'},body:JSON.stringify({decision:'allow',scope:'once'})});
        assert.equal(r.status,200);
      }
      await new Promise(resolve=>setTimeout(resolve,100));
    }
  };
  const prepareMessage=async(intent,text)=>{
    await click('load');await click('restore-chat');
    await page.locator('#message-intent').selectOption(intent);await page.locator('#message-text').fill(text);
    await click('prepare-message');
  };
  await prepareMessage('message','Explain the existing target; do not modify the project');
  await click('submit-message',true);const discussion=await result();
  const discussed=await waitTurn(2);
  assert.notEqual(discussed.requirements.revision,run.requirements.revision);
  assert.equal(discussed.agentTurns[1].message.intent,'message');
  await click('submit-message',true);assert.equal((await result()).turn.attemptId,discussion.turn.attemptId);
  await click('content');const editable=await result();assert.equal(editable.readOnly,false);assert.equal(editable.editing.planRevision,discussed.planRevision);
  await page.locator('#document').selectOption('ui/menu.json');
  const ui=JSON.parse(await page.locator('#document-json').inputValue());ui.data.nodes[1].layout.size[1]=64;
  await page.locator('#document-json').fill(JSON.stringify(ui));await click('save');
  assert.equal((await result()).unmeasured,true);
  await click('read-measurement');const sourceChanged=await result();
  assert.equal(sourceChanged.freshness.current,false,'saving source must invalidate old measurement before any model call');
  assert.equal(sourceChanged.freshness.changes.artifact,false);
  assert.equal(sourceChanged.freshness.evidence.artifactMatches,true);
  assert.equal(sourceChanged.freshness.evidence.exportableSourcesMatch,false);
  assert.ok(sourceChanged.freshness.changes.sources.includes('content/ui/menu.json'));
  assert.ok(sourceChanged.freshness.changes.checkInputs.includes('build'));
  assert.equal(sourceChanged.freshness.evidence.checks.find(c=>c.id==='runtime-smoke').inputsMatch,true);
  for(const id of ['project-export','preview']) {
    await page.locator('#'+id).click();await page.waitForFunction(id=>!document.getElementById(id).disabled,id);
    assert.ok(!(await page.locator('#status').innerText()).startsWith('完成'),'changed sources cannot export/open as current');
  }
  await page.locator('#document').selectOption('scenes/level.json');
  const scene=JSON.parse(await page.locator('#document-json').inputValue());scene.data.nodes[1].transform.position[0]=30;
  await page.locator('#document-json').fill(JSON.stringify(scene));await click('save');
  const edited=(await api('workflow-v3')).run;
  assert.equal(edited.agentTurns.length,2,'editor does not dispatch a model');assert.equal(['plans','tasks','attempts'].some(key=>key in edited),false);
  assert.equal(edited.sourceEdits.length,2);assert.equal(edited.requirements.revision,discussed.requirements.revision,'source save does not silently rewrite requirements');
  await prepareMessage('change','Change target from three to four; preserve the explicitly saved UI height 64 and scene x=30, update the rule check, rebuild and measure, preserving notes');
  await click('submit-message',true);const changed=await waitTurn(3);
  await page.locator('#evidence-path').fill('README.md');await click('read-evidence');
  const changedEvidence=await result();
  assert.equal(changedEvidence.requirements.revision,changed.requirements.revision);
  assert.notEqual(changedEvidence.requirements.revision,evidence.requirements.revision);
  assert.equal(changedEvidence.source.utf8ContentSha256,evidence.source.utf8ContentSha256,'unrelated record preserved');
  assert.equal(changedEvidence.acceptance,'unverified','unchanged report is not acceptance of new requirements');
  assert.notEqual(changed.requirements.revision,discussed.requirements.revision);assert.equal(changed.requirementChanges.length,2);
  const previousMeasurement=await api('workflow-v3/agent/measurements/'+firstMeasurement.id);
  assert.equal(previousMeasurement.freshness.current,false);
  assert.ok(changed.agentTurns[2].measurements?.length,JSON.stringify((await api('workflow-v3/events')).events.filter(e=>e.type==='tool.completed'||e.type==='tool.failed').slice(-6)));
  const newMeasurement=changed.agentTurns[2].measurements.at(-1);
  await page.locator('#measurement').selectOption(newMeasurement.id);await click('read-measurement');
  assert.equal((await result()).freshness.current,true,JSON.stringify(await result()));
  await click('preview');
  await page.locator('#preview-frame').contentFrame().locator('#editable-play').waitFor();
  await page.locator('#preview-frame').contentFrame().locator('#editable-play[style*="height: 64px"]').waitFor();
  await page.locator('#preview-frame').contentFrame().locator('#scene-x:text-is("30")').waitFor();
  assert.equal(await page.locator('#preview-frame').contentFrame().locator('#scene-x').innerText(),'30');
  await click('project-export');assert.ok((await result()).bytes>0);await click('close-preview');
  await click('submit-message',true);assert.equal((await result()).turn.attemptId,changed.agentTurns[2].attemptId);
  await click('submit-goal',true);assert.equal((await result()).turn.attemptId,dispatched.turn.attemptId);
  await prepareMessage('change','Save a partial progress checkpoint and ask before proceeding; do not change other work');
  await click('submit-message',true);
  const pauseLimit=Date.now()+20000;
  while(true) {
    assert.ok(Date.now()<pauseLimit,'interruption checkpoint unavailable');
    const runtime=await api('runtime-state');
    if(runtime.pending_permissions?.some(p=>p.tool_name==='AskUserQuestion'))break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await click('stop');const stopped=await waitTurn(4);
  assert.ok(stopped.paused);assert.equal(stopped.agentTurns[3].status,'interrupted');
  await click('questions');assert.equal((await result()).questions.length,0);
  await click('resume');assert.equal((await result()).dispatched,false);
  await prepareMessage('continue','Inspect the partial progress checkpoint, complete it, and verify the changed target without replaying earlier work');
  if(focusedContinuation) {
    await page.locator('#message-context').selectOption('focused');await click('prepare-message');
  }
  await click('submit-message',true);const continued=await waitTurn(5);
  assert.equal(continued.requirements.revision,stopped.requirements.revision);
  assert.equal(new Set(continued.agentTurns.map(t=>t.nativeSessionId)).size,focusedContinuation?2:1);
  assert.equal(continued.agentTurns[4].message.contextMode??'resume',focusedContinuation?'focused':'resume');
  assert.equal(continued.deliveryEligible,false);assert.equal(['plans','tasks','attempts'].some(key=>key in continued),false);
  await page.locator('#measurement').selectOption(continued.agentTurns[4].measurements.at(-1).id);
  await click('read-measurement');assert.equal((await result()).freshness.current,true);
  await click('project-export');assert.ok((await result()).bytes>0);
  await click('submit-message',true);assert.equal((await result()).turn.attemptId,continued.agentTurns[4].attemptId);
  await prepareMessage('work','Check the current confirmed target and existing evidence, without changing the requirements');
  await page.locator('#message-context').selectOption('focused');await click('prepare-message');
  await click('submit-message',true);const maintained=await waitTurn(6);
  assert.deepEqual(maintained.requirements,continued.requirements);
  assert.equal(maintained.requirementChanges.length,continued.requirementChanges.length);
  assert.equal(maintained.planRevision,continued.planRevision);
  assert.equal(maintained.agentTurns[5].message.intent,'work');
  assert.equal(maintained.agentTurns[5].message.contextMode,'focused');
  assert.notEqual(maintained.agentTurns[5].nativeSessionId,continued.agentTurns[4].nativeSessionId);
  assert.equal(maintained.agentTurns[5].measurements,undefined,'No automatic remeasure for unchanged work');
  await page.locator('#measurement').selectOption(continued.agentTurns[4].measurements.at(-1).id);
  await click('read-measurement');assert.equal((await result()).freshness.current,true);
  await click('submit-message',true);assert.equal((await result()).turn.attemptId,maintained.agentTurns[5].attemptId);
  await page.locator('#message-context').selectOption('resume');
  await prepareMessage('message','Explain the maintained project without changing anything');
  await click('submit-message',true);const focusedDiscussion=await waitTurn(7);
  assert.equal(focusedDiscussion.agentTurns[6].nativeSessionId,maintained.agentTurns[5].nativeSessionId);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,answered,focusedContinuation,permissionTools:[...tools],
    coverage:['whole-confirmed-goal','real-native-plan-skill-question','native-write-failed-check-repair-recheck',
      'idempotent-goal-intake','no-host-Task','no-stage-auto-continuation','pause-resume-no-dispatch',
      'same-native-history-discussion','authorized-change-actual-edit-and-retest','partial-work-interruption-explicit-continuation',
      focusedContinuation?'fresh-native-UUID-on-explicit-focused-continuation':'same-native-UUID-on-continuation','focused-native-context-no-old-tool-history','resume-focused-context','old-version-not-accepted','same-message-no-second-execution','existing-goal-work-preserves-requirements-and-receipt',
      'debug-source-vs-artifact-check-input-classification','stale-source-preview-export-refused',
      'read-only-merged-design-record','missing-report-not-stale-result','changed-requirements-not-old-evidence',
      'native-measurement-without-Task','debug-measured-Preview-and-project-export','changed-and-continued-build-remeasured',
      'autonomous-ui-scene-editor','source-save-invalidates-old-measurement','no-editor-model-dispatch','rebuilt-json-consumed-by-browser'],
    limits:['local-store','controlled-loopback-model','synthetic-only','not-game-quality']}));
} finally {await browser.close();}
