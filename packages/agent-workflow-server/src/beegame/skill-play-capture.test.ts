import { expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { openPreviewTestAccess } from './preview-test-access'
import { sharedPlaywright } from './shared-playwright'
import { sharedContentChecker } from './content-checker-runtime'

const source = fileURLToPath(new URL('../../../../.beegame/skills/bgs-game-skills/game-playtest-performance/scripts/capture-play.mjs', import.meta.url))

test('copied capture helper has a read-only CLI and rejects missing active access', async () => {
  const root = await mkdtemp(join(tmpdir(), 'bgs-play-skill-cli-'))
  try {
    const script = join(root, 'capture.mjs'); await cp(source, script)
    const child = Bun.spawn(['node', script, '--help'], { cwd: root, stdout: 'pipe', stderr: 'pipe' })
    expect(await child.exited).toBe(0)
    expect(await new Response(child.stdout).text()).toContain('No chosen node means explicitly unverified audio')
    expect((await readdir(root)).sort()).toEqual(['capture.mjs'])
    const check = Bun.spawn(['node', '--input-type=module', '-e',
      `const {withPlayCapture}=await import(${JSON.stringify(pathToFileURL(script).href)}); await withPlayCapture({},async()=>{});`],
      { cwd: root, env: { PATH: process.env.PATH, BEEGAME_PREVIEW_TEST_MODULE: '' }, stdout: 'pipe', stderr: 'pipe' })
    expect(await check.exited).not.toBe(0)
    expect(await new Response(check.stderr).text()).toContain('No current supplied Preview helper')
    expect((await readdir(root)).sort()).toEqual(['capture.mjs'])
  } finally { await rm(root, { recursive: true, force: true }) }
})

/** Free local fixture: no model, generated game workspace or personal browser. */
test.skipIf(process.env.BGS_PLAY_CAPTURE_BROWSER !== '1')('actual Preview path retains video, selected-node audio, limits and failed-driver evidence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-play-skill-browser-')))
  const fixture = `<!doctype html><body><button id="start">Start</button><button id="hit">Hit</button><button id="quiet">Quiet</button><button id="mute">Mute</button><div id="dot" style="width:32px;height:32px;background:green;transition:transform .2s"></div><script>
  window.gameAudio = new AudioContext(); window.master = gameAudio.createGain(); master.gain.value=.2; master.connect(gameAudio.destination);
  window.originalConnect=AudioNode.prototype.connect;
  document.querySelector('#start').onclick=async()=>{await gameAudio.resume();const source=gameAudio.createOscillator();source.connect(master);source.start();source.stop(gameAudio.currentTime+1);document.querySelector('#dot').style.transform='translateX(120px)'};
  document.querySelector('#hit').onclick=()=>{const source=gameAudio.createOscillator();source.frequency.value=700;source.connect(master);source.start();source.stop(gameAudio.currentTime+.07)};
  document.querySelector('#quiet').onclick=()=>master.gain.value=.04;
  document.querySelector('#mute').onclick=()=>master.gain.value=0;
  </script>`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: () => new Response(fixture, { headers: { 'Content-Type': 'text/html' } }) })
  const snapshot = { status: 'running', mode: 'production', url: server.url.href }
  const access = openPreviewTestAccess({ start: async () => snapshot, status: () => snapshot, stop() {} })
  try {
    await mkdir(join(root, 'evidence'))
    await cp(source, join(root, 'capture.mjs'))
    await writeFile(join(root, 'capability.json'), JSON.stringify({ version: 1, workspace: root,
      sessionId: 'offline-test', executionId: 'offline-test', apiUrl: access.baseUrl }))
    await writeFile(join(root, 'driver.mjs'), `
      const mode=process.argv[2];
      const {withPlayCapture}=await import(mode==='legacy' ? './capture.mjs' : process.env.BEEGAME_PREVIEW_TEST_MODULE);
      let metrics;
      const report=await withPlayCapture({mode:'production',viewport:{width:480,height:320},outputParent:'evidence',audio:true,audioLimitMs:mode==='limit'?350:30000}, async ({page,gameFrame,mark,captureFrame})=>{
        await gameFrame.waitForSelector('#start');
        if(mode!=='no-tap')await gameFrame.evaluate(()=>__bgsPlayAudioTap.start(master,'fixture master after game gain'));
        await captureFrame('before start');
        await gameFrame.locator('#start').click(); mark('start input');
        await page.waitForTimeout(150);
        if(mode==='fail'){
          // Fail only after the audio clock has advanced; wall-clock delay
          // alone can end a cold recorder before it has produced any bytes.
          await gameFrame.waitForFunction(()=>gameAudio.currentTime>=.4);
          await gameFrame.evaluate(()=>console.error('retained fixture diagnostic token=synthetic-secret'));
          await page.waitForTimeout(50);
          throw Error('deliberate fixture assertion failed');
        }
        await gameFrame.locator('#hit').click(); await page.waitForTimeout(100);
        await gameFrame.locator('#quiet').click(); await page.waitForTimeout(200);
        await gameFrame.locator('#mute').click(); await page.waitForTimeout(250);
        await captureFrame('muted resulting state');
        if(mode!=='no-tap')metrics=await gameFrame.evaluate(async()=>{
          const result=await __bgsPlayAudioTap.stop();
          const recording=result.recordings[0];
          const bytes=Uint8Array.from(atob(recording.base64),c=>c.charCodeAt(0));
          const decoder=new OfflineAudioContext(2,1,48000);
          const decoded=await decoder.decodeAudioData(bytes.buffer), data=decoded.getChannelData(0);
          const rms=(start,end)=>{let sum=0;for(let i=start;i<end;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(end-start))};
          return {duration:decoded.duration,overallRms:rms(0,data.length),tailRms:rms(Math.floor(data.length*.85),data.length),
            nativeConnectUnchanged:AudioNode.prototype.connect===originalConnect,contextState:gameAudio.state,
            observedX:document.querySelector('#dot').getBoundingClientRect().x};
        });
      });
      console.log(JSON.stringify({report,metrics}));
    `)
    const runtime = await sharedContentChecker()
    const run = async (mode: string) => {
      const child = Bun.spawn(['node', join(root, 'driver.mjs'), mode], { cwd: root, stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, BEEGAME_PREVIEW_CAPABILITY_FILE: join(root, 'capability.json'),
          BEEGAME_PREVIEW_TEST_MODULE: new URL('./preview-test-client.mjs', runtime.moduleUrl).href,
          BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl } })
      const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, out, error }
    }
    const normal = await run('normal')
    if (normal.code !== 0) throw Error(normal.error)
    const { report, metrics } = JSON.parse(normal.out)
    expect(report.audio.recordings[0]).toMatchObject({ status: 'recorded', initialContextState: 'suspended',
      label: 'fixture master after game gain', quality: 'unverified' })
    expect(metrics.nativeConnectUnchanged).toBe(true)
    expect(metrics.contextState).toBe('running')
    expect(metrics.observedX).toBeGreaterThan(100)
    expect(metrics.overallRms).toBeGreaterThan(.01)
    expect(metrics.tailRms).toBeLessThan(metrics.overallRms / 10)
    expect((await readFile(join(root, report.video))).length).toBeGreaterThan(1000)
    expect((await readFile(join(root, report.audio.recordings[0].path))).length).toBeGreaterThan(200)
    expect(report.runtimeErrors.pageErrors).toBe(0)
    expect(report.frames).toHaveLength(2)
    expect(await readFile(join(root, report.frames[0].path))).not.toEqual(await readFile(join(root, report.frames[1].path)))
    const legacy = await run('legacy')
    expect(legacy.code).toBe(0)
    expect(JSON.parse(legacy.out).report.quality).toBe('unverified')
    const limited = await run('limit')
    if (limited.code !== 0) throw Error(limited.error)
    const limitedRecording = JSON.parse(limited.out).report.audio.recordings[0]
    expect(limitedRecording.endReason).toBe('window-limit')
    expect(limitedRecording.coverage).toBe('limited-or-interrupted-window')
    expect(limitedRecording.durationMs).toBeLessThan(750)
    const noTap = await run('no-tap')
    expect(noTap.code).toBe(0)
    expect(JSON.parse(noTap.out).report.audio).toMatchObject({ status: 'unverified', recordings: [] })
    const failure = await run('fail')
    expect(failure.code).not.toBe(0)
    expect(failure.error).toContain('retained evidence/play-capture-')
    const reports = await Promise.all((await readdir(join(root, 'evidence')))
      .map(async name => JSON.parse(await readFile(join(root, 'evidence', name, 'observation.json'), 'utf8'))))
    expect(reports).toHaveLength(5)
    expect(reports.find(item => item.driverError)?.video).toBeTruthy()
    expect(reports.find(item => item.driverError)?.audio.recordings[0]?.status).toBe('recorded')
    const failedReport = reports.find(item => item.driverError)
    expect(failedReport.runtimeErrors.consoleErrors).toBe(1)
    expect(failedReport.runtimeErrorDetails.consoleErrors[0].message).toContain('retained fixture diagnostic')
    expect(JSON.stringify(failedReport.runtimeErrorDetails)).not.toContain('synthetic-secret')
  } finally { await access.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 45_000)

/** A tiny source-driven player path: the same state assertion must pass for
 * the healthy fixture and fail when the fixture intentionally omits victory.
 * This observes tool sensitivity and retained evidence, not Skill or game
 * quality. */
test.skipIf(process.env.BGS_PLAY_CAPTURE_BROWSER !== '1')('source-driven 2D path checks pause, retry and retained assertion evidence', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'bgs-play-path-browser-')))
  let fault = false
  const fixture = `<!doctype html><meta charset="utf-8"><style>
    html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111;color:#fff;font:16px sans-serif}
    #hud{padding:12px;display:flex;gap:16px}#game{display:block;width:320px;height:180px;image-rendering:pixelated}
  </style><body><div id="hud"><span id="status">Ready</span><span id="score">0</span><span id="hint">Enter to start</span></div>
  <canvas id="game" width="160" height="90"></canvas><script>
    // Rules: Enter starts; each unpaused ArrowRight is one core action;
    // score 2 becomes Won; ArrowLeft becomes Lost; P pauses and blocks actions;
    // R retries from Won or Lost.
    const fault = new URL(location.href).searchParams.get('fault') === '1';
    const status = document.querySelector('#status'), scoreText = document.querySelector('#score'), hint = document.querySelector('#hint');
    const canvas = document.querySelector('#game'), ctx = canvas.getContext('2d');
    let phase = 'ready', score = 0, paused = false;
    const paint = () => {
      const color = paused ? '#a06000' : phase === 'ready' ? '#444444' : phase === 'playing' ? '#2040a0' : phase === 'won' ? '#208040' : '#a02020';
      ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height);
      status.textContent = paused ? 'Paused' : phase === 'ready' ? 'Ready' : phase === 'playing' ? 'Playing' : phase === 'won' ? 'Won' : 'Lost';
      scoreText.textContent = String(score);
      hint.textContent = phase === 'ready' ? 'Enter to start' : phase === 'playing' ? 'ArrowRight action / P pause' : 'R retry';
    };
    addEventListener('keydown', event => {
      if (['Enter', 'ArrowRight', 'ArrowLeft', 'p', 'P', 'r', 'R'].includes(event.key)) event.preventDefault();
      if (event.key === 'Enter' && phase === 'ready') { phase = 'playing'; paint(); return; }
      if ((event.key === 'p' || event.key === 'P') && phase === 'playing') { paused = !paused; paint(); return; }
      if ((event.key === 'r' || event.key === 'R') && (phase === 'won' || phase === 'lost')) { phase = 'playing'; score = 0; paused = false; paint(); return; }
      if (event.key === 'ArrowLeft' && phase === 'playing' && !paused) { phase = 'lost'; paint(); return; }
      if (event.key === 'ArrowRight' && phase === 'playing' && !paused) {
        score += 1;
        if (score >= 2) {
          if (fault) console.error('controlled fixture: victory state not set');
          else phase = 'won';
        }
        paint();
      }
    });
    paint();
  </script></body>`
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0,
    fetch: () => new Response(fixture, { headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' } }) })
  const snapshot = () => ({ status: 'running', mode: 'production', url: server.url.href + (fault ? '?fault=1' : '') })
  const access = openPreviewTestAccess({ start: async () => snapshot(), status: snapshot, stop() {} })
  try {
    await mkdir(join(root, 'evidence'))
    await writeFile(join(root, 'capability.json'), JSON.stringify({ version: 1, workspace: root,
      sessionId: 'offline-play-path', executionId: 'offline-play-path', apiUrl: access.baseUrl }))
    await writeFile(join(root, 'driver.mjs'), `
      import assert from 'node:assert/strict';
      const { withPlayCapture } = await import(process.env.BEEGAME_PREVIEW_TEST_MODULE);
      const report = await withPlayCapture({ mode: 'production', viewport: { width: 320, height: 240 }, outputParent: 'evidence' }, async ({ page, gameFrame, mark, captureFrame }) => {
        await gameFrame.waitForSelector('#status');
        const readState = () => gameFrame.evaluate(() => ({ status: document.querySelector('#status').textContent,
          score: Number(document.querySelector('#score').textContent),
          pixel: [...document.querySelector('#game').getContext('2d').getImageData(8, 8, 1, 1).data] }));
        const assertState = async expected => assert.deepStrictEqual(await readState(), expected);
        await assertState({ status: 'Ready', score: 0, pixel: [68, 68, 68, 255] });
        await captureFrame('ready');
        await page.keyboard.press('Enter'); mark('start');
        await assertState({ status: 'Playing', score: 0, pixel: [32, 64, 160, 255] });
        await captureFrame('started');
        await page.keyboard.press('ArrowRight'); mark('core-action-1');
        await assertState({ status: 'Playing', score: 1, pixel: [32, 64, 160, 255] });
        await page.keyboard.press('p'); mark('pause');
        await assertState({ status: 'Paused', score: 1, pixel: [160, 96, 0, 255] });
        await captureFrame('paused');
        await page.keyboard.press('ArrowRight'); mark('paused-action');
        await assertState({ status: 'Paused', score: 1, pixel: [160, 96, 0, 255] });
        await page.keyboard.press('p'); mark('resume');
        await page.keyboard.press('ArrowRight'); mark('core-action-2');
        await captureFrame('terminal');
        // The same source-derived assertion is used in healthy and faulty runs.
        await assertState({ status: 'Won', score: 2, pixel: [32, 128, 64, 255] });
        await page.keyboard.press('r'); mark('retry');
        await assertState({ status: 'Playing', score: 0, pixel: [32, 64, 160, 255] });
        await page.keyboard.press('ArrowRight'); mark('retry-action');
        await assertState({ status: 'Playing', score: 1, pixel: [32, 64, 160, 255] });
        await page.keyboard.press('ArrowLeft'); mark('failure');
        await assertState({ status: 'Lost', score: 1, pixel: [160, 32, 32, 255] });
        await captureFrame('lost');
        await page.keyboard.press('r'); mark('retry-after-loss');
        await assertState({ status: 'Playing', score: 0, pixel: [32, 64, 160, 255] });
        await page.keyboard.press('ArrowRight'); mark('retry-after-loss-action');
        await assertState({ status: 'Playing', score: 1, pixel: [32, 64, 160, 255] });
        await captureFrame('retry-after-loss-continued');
        return await readState();
      });
      console.log(JSON.stringify({ report }));
    `)
    const runtime = await sharedContentChecker()
    const run = async (mode: 'normal' | 'fault') => {
      fault = mode === 'fault'
      const child = Bun.spawn(['node', join(root, 'driver.mjs')], { cwd: root, stdout: 'pipe', stderr: 'pipe',
        env: { ...process.env, BEEGAME_PREVIEW_CAPABILITY_FILE: join(root, 'capability.json'),
          BEEGAME_PREVIEW_TEST_MODULE: new URL('./preview-test-client.mjs', runtime.moduleUrl).href,
          BEEGAME_PLAYWRIGHT_MODULE: sharedPlaywright().moduleUrl } })
      const [code, out, error] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()])
      return { code, out, error }
    }
    const normal = await run('normal')
    expect(normal.code, normal.error).toBe(0)
    const normalReport = JSON.parse(normal.out).report
    expect(normalReport.quality).toBe('unverified')
    expect(normalReport.runtimeErrors).toEqual({ pageErrors: 0, consoleErrors: 0, failedRequests: 0, httpErrors: 0 })
    expect(normalReport.frames).toHaveLength(6)
    expect((await readFile(join(root, normalReport.video))).length).toBeGreaterThan(1000)
    for (const frame of normalReport.frames) expect((await readFile(join(root, frame.path))).length).toBeGreaterThan(100)
    const faultRun = await run('fault')
    expect(faultRun.code).not.toBe(0)
    expect(faultRun.error).toContain('retained evidence/play-capture-')
    const reports = await Promise.all((await readdir(join(root, 'evidence')))
      .map(async name => JSON.parse(await readFile(join(root, 'evidence', name, 'observation.json'), 'utf8'))))
    expect(reports).toHaveLength(2)
    const failedReport = reports.find(item => item.driverError)
    expect(failedReport?.driverError).toContain('Expected values to be strictly deep-equal')
    expect(failedReport?.runtimeErrors).toMatchObject({ consoleErrors: 1 })
    expect(failedReport?.runtimeErrorDetails.consoleErrors[0].message).toContain('controlled fixture: victory state not set')
    expect(failedReport?.video).toBeTruthy()
    expect(failedReport?.frames).toHaveLength(4)
    expect((await readFile(join(root, failedReport.video))).length).toBeGreaterThan(1000)
    for (const frame of failedReport.frames) expect((await readFile(join(root, frame.path))).length).toBeGreaterThan(100)
  } finally { await access.close(); server.stop(true); await rm(root, { recursive: true, force: true }) }
}, 45_000)
