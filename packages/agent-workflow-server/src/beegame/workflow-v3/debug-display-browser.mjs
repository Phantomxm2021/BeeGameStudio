// Dedicated synthetic browser only: never controls the user's Chrome/project.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.BGS_PLAYWRIGHT_MODULE);
const {endpoint,origin,delayedFulfillment}=JSON.parse(await new Promise(resolve=>{
  let text='';process.stdin.on('data',bytes=>text+=bytes);process.stdin.on('end',()=>resolve(text));
}));
const browser=await chromium.connectOverCDP(endpoint);
try {
  const context=await browser.newContext(),page=await context.newPage();
  if(delayedFulfillment)await page.addInitScript(()=>{
    // Synthetic transport race: a completed read is delivered late even after
    // UI cancellation. No real project/model or production browser is used.
    const original=window.fetch;let reads=0;
    window.fetch=async(input,options)=>{
      if(String(input).endsWith('/workflow-v3') && ++reads===2) {
        const response=await original(input,{...options,signal:undefined});
        await new Promise(resolve=>{window.releaseLateRead=resolve;});return response;
      }
      return original(input,options);
    };
  });
  await page.goto(origin+'/debug/workflow-v3');
  await page.locator('#project').fill('p');await page.locator('#token').fill('synthetic-owner');
  const click=async id=>{await page.locator('#'+id).click();await page.waitForFunction(id=>document.getElementById('status').textContent==='完成 '+id,id);};
  await click('load');const initialVersion=JSON.parse(await page.locator('#run').innerText()).run.version;
  assert.equal(await page.locator('#measurement').inputValue(),'latest-failure','Do not default to an older successful measurement');
  assert.match(await page.locator('#measurement option').first().innerText(),/latest-failure.*Synthetic latest failure/);
  await page.locator('#measurement').selectOption('older-success');
  assert.equal(await page.locator('#measurement').inputValue(),'older-success','Historical receipts remain explicitly selectable');
  await click('questions');assert.equal(await page.locator('#question').inputValue(),'synthetic-question');
  await click('events');
  let result=JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.events.length,100);assert.equal(result.events[0].id,89900);
  assert.ok((await page.locator('#result').innerText()).length<40000);
  await click('events-earlier');result=JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.events.length,100);assert.equal(result.events[0].id,89800);
  await page.locator('#load').click();
  await page.waitForFunction(()=>document.getElementById('status').textContent==='执行 load');
  if(delayedFulfillment)await page.waitForFunction(()=>typeof window.releaseLateRead==='function');
  assert.equal(await page.locator('#stop').isEnabled(),true,'Pause cannot be locked behind a diagnostic read');
  const pauseStarted=Date.now();await click('stop');
  assert.ok(Date.now()-pauseStarted<5000,'Pause must not wait for the 15-second diagnostic timeout');
  assert.equal(JSON.parse(await page.locator('#run').innerText()).run.version,initialVersion+1);
  assert.ok(JSON.parse(await page.locator('#run').innerText()).run.paused);
  if(delayedFulfillment)await page.evaluate(()=>window.releaseLateRead());
  else await fetch(origin+'/fixture/release',{method:'POST'});
  await page.waitForFunction(()=>!document.getElementById('load').disabled);
  const run=JSON.parse(await page.locator('#run').innerText()).run;
  assert.equal(run.version,initialVersion+1);assert.ok(run.paused);
  assert.equal(await page.locator('#status').innerText(),'完成 stop','Late read must not replace stop status');
  assert.equal(await page.locator('#question option').count(),0,'Paused/stale questions cannot remain displayed as answerable');
  // Preview observations prepare an ordinary message draft without dispatching.
  await page.locator('#measurement').selectOption('older-success');await click('preview');
  await page.locator('#preview-frame').contentFrame().locator('#synthetic-preview').waitFor();
  await click('prepare-observation');
  const observation=JSON.parse(await page.locator('#observation-json').inputValue());
  assert.equal(observation.measurementId,'older-success');
  assert.equal(observation.requirementsRevision,run.requirements.revision);
  assert.equal(observation.artifactSha256,'a'.repeat(64));
  Object.assign(observation,{steps:'Open the preview',expected:'Synthetic preview',observed:'Synthetic preview is displayed'});
  await page.locator('#observation-json').fill(JSON.stringify(observation));
  await page.locator('#message-intent').selectOption('change');await click('observation-message');
  result=JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.dispatched,false);
  assert.equal(await page.locator('#message-intent').inputValue(),'message');
  const draft=await page.locator('#message-text').inputValue();
  assert.match(draft,/older-success/);
  assert.equal(result.source.artifactSha256,observation.artifactSha256);
  observation.artifactSha256='changed';await page.locator('#observation-json').fill(JSON.stringify(observation));
  await page.locator('#observation-message').click();
  await page.waitForFunction(()=>!document.getElementById('observation-message').disabled);
  assert.match(await page.locator('#status').innerText(),/来源已改变/);
  assert.equal(await page.locator('#message-text').inputValue(),draft,'Rejected source changes must preserve the original draft');
  // Evidence stays read-only and a failed read clears the prior displayed result.
  await page.locator('#evidence-path').fill('README.md');await click('read-evidence');
  result=JSON.parse(await page.locator('#result').innerText());
  assert.equal(result.requirements.revision,run.requirements.revision);
  assert.equal(result.source.content,'Synthetic saved evidence');
  assert.match(result.source.utf8ContentSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.acceptance,'unverified');assert.equal(result.recordedTurns.length,run.agentTurns.length);
  await page.locator('#evidence-path').fill('missing-report.md');await page.locator('#read-evidence').click();
  await page.waitForFunction(()=>!document.getElementById('read-evidence').disabled);
  assert.match(await page.locator('#status').innerText(),/HTTP 404/);
  assert.equal(await page.locator('#result').innerText(),'','Failed reads must not leave old evidence displayed');
  assert.deepEqual(JSON.parse(await page.locator('#run').innerText()).run,run);
  console.log(JSON.stringify({passed:true,finalVersion:run.version,paused:Boolean(run.paused)}));
  await context.close();
}finally{await browser.close();}
